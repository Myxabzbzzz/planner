import copy
import logging
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Callable
from zoneinfo import ZoneInfo

from .classifier import decide
from .format import KIND_LABELS, render_line, render_summary, review_message, summary_buttons, time_message
from .fx import FxApplied, FxError, RateTable, convert
from .llm import ExtractionError
from .rows import to_row
from .router import is_question
from .schemas import ExtractedItem, InboxRow, UserContext
from .validate import NO_TIME, check_item, localize

log = logging.getLogger(__name__)

FAILED_TEXT = "😵 Не получилось разобрать запись. Попробуй отправить ещё раз."
REPHRASE_TEXT = "😵 Не смог разобрать. Переформулируй, пожалуйста."
NOT_HEARD = "🙉 Не расслышал. Повтори, пожалуйста."
PREFIXES = {"shortcut": "📲 ", "miniapp": "📱 "}


def chat_text(row: InboxRow, text: str) -> str:
    return PREFIXES.get(row.source, "") + text

class Pipeline:
    def __init__(self, store, tg, stt, extractor, classifier, fetch_rates: Callable[[], RateTable],
                 threshold: float, tmp_dir: Path, answerer=None):
        self.store, self.tg, self.stt = store, tg, stt
        self.extractor, self.classifier = extractor, classifier
        self.fetch_rates, self.threshold, self.tmp_dir = fetch_rates, threshold, tmp_dir
        self.answerer = answerer

    # ---------- public ----------

    def process(self, row: InboxRow) -> None:
        ctx = self.store.load_context(row.user_id, datetime.now(timezone.utc))
        if row.result.get("pending_review"):
            self._process_review(row, ctx)
            return

        text = row.text
        if text is None:
            text = self._transcribe(row)
            if not text:
                self.store.finish(row.id, "failed", {"text": "", "reply": NOT_HEARD}, "empty_transcript", notified=True)
                reply(self.tg, row, chat_text(row, NOT_HEARD))
                return

        if self.answerer and is_question(text) and self._answer(row, text, ctx):
            return

        lines: list[str] = []
        review: list[dict] = []
        checked = self._extract_checked(text, ctx)
        self.store.clear_records(row.id)  # retried main pass must not duplicate records
        for it, errs in checked:
            if errs:
                reason = "time" if errs == [NO_TIME] else "; ".join(errs)
                review.append(self._review_entry(it, reason, None))
                continue
            cls = self.classifier.classify(it.source_text) if self.classifier else None
            if not decide(it, cls, self.threshold):
                review.append(self._review_entry(it, "laya", cls))
                continue
            try:
                lines.append(self._save(it, ctx, row.id))
            except FxError as e:
                review.append(self._review_entry(it, f"нет курса валюты: {e}", cls))

        status = "needs_review" if review else "done"
        summary = render_summary(lines, len(review))
        self.store.finish(row.id, status, {"text": text, "saved": len(lines), "pending_review": review,
                                           "reply": summary})
        self._best_effort(reply, self.tg, row, chat_text(row, summary),
                          summary_buttons(row.id) if lines else None)
        for idx, entry in enumerate(review):
            it = ExtractedItem.model_validate(entry["item"])
            msg, buttons = (time_message(row.id, idx, it, ctx) if entry["reason"] == "time"
                            else review_message(row.id, idx, it, entry["reason"]))
            self._best_effort(self.tg.send, row.reply_chat_id, msg, buttons)

    @staticmethod
    def _best_effort(fn, *args) -> None:
        try:
            fn(*args)
        except Exception as e:  # noqa: BLE001 — telegram after commit must not trigger a retry
            log.warning("telegram call failed after commit: %s", e)

    # ---------- steps ----------

    def _answer(self, row: InboxRow, text: str, ctx: UserContext) -> bool:
        answered = self.answerer.answer(text, ctx)
        if answered is None:
            return False
        answer, question = answered
        self.store.finish(row.id, "done", {"text": text, "question": question, "answered": True, "reply": answer})
        self._best_effort(reply, self.tg, row, chat_text(row, answer))
        return True

    def _transcribe(self, row: InboxRow) -> str:
        path = self.tg.download(row.audio_ref, self.tmp_dir)
        try:
            return self.stt.transcribe(path)
        finally:
            path.unlink(missing_ok=True)

    def _known_currencies(self, ctx: UserContext) -> set[str] | None:
        table = self.store.rates_on(ctx.now.date())
        return set(table.rates) if table else None

    def _extract_checked(self, text: str, ctx: UserContext, hint_kind: str | None = None, strict: bool = True):
        known = self._known_currencies(ctx)
        items = [localize(i, ctx, strict) for i in self.extractor.extract(text, ctx, hint_kind)]
        checked = [(i, check_item(i, ctx, known, strict)) for i in items]
        feedback = [f"«{i.source_text}»: {e}" for i, errs in checked for e in errs]
        if feedback:
            items = [localize(i, ctx, strict) for i in self.extractor.extract(text, ctx, hint_kind, feedback)]
            checked = [(i, check_item(i, ctx, known, strict)) for i in items]
        return checked

    def _fx(self, it: ExtractedItem, ctx: UserContext) -> FxApplied | None:
        if it.kind not in ("expense", "income") or not it.currency or it.currency == ctx.base_currency:
            return None
        table = self.store.rates_on(it.occurred_on)
        if table is None:
            try:
                table = self.fetch_rates()
            except FxError:
                raise
            except Exception as e:  # noqa: BLE001
                raise FxError(f"не удалось получить курс: {e}") from e
            self.store.save_rates(table)
        return convert(Decimal(str(it.amount)), it.currency, ctx.base_currency, table)

    def _save(self, it: ExtractedItem, ctx: UserContext, inbox_id: str) -> str:
        fx = self._fx(it, ctx)
        self.store.insert(*to_row(it, ctx, inbox_id, fx))
        return render_line(it, fx, ctx)

    @staticmethod
    def _review_entry(it: ExtractedItem, reason: str, cls) -> dict:
        laya = {"group": cls.group, "confidence": cls.confidence} if cls else None
        return {"item": it.model_dump(mode="json"), "reason": reason, "laya": laya}

    def _process_review(self, row: InboxRow, ctx: UserContext) -> None:
        pending = row.result["pending_review"]
        saved: list[str] = []
        warnings: list[str] = []
        for entry in pending:
            forced = entry.get("forced_kind")
            if not forced or entry.get("resolved"):
                continue
            try:
                self._review_entry_save(entry, forced, ctx, row.id, saved, warnings)
            except FxError as e:
                entry["failed"] = True
                warnings.append(f"⚠️ «{entry['item'].get('source_text')}»: нет курса валюты ({e}).")
            except Exception as e:  # noqa: BLE001
                log.warning("review entry failed for %s: %s", row.id, e)
                entry["failed"] = True
                warnings.append(f"⚠️ Не смог разобрать «{entry['item'].get('source_text')}» как "
                                f"{KIND_LABELS.get(forced, forced)}. Напиши подробнее отдельным сообщением.")
            entry["resolved"] = True

        status = "needs_review" if any(not e.get("resolved") for e in pending) else "done"
        self.store.finish(row.id, status, {**row.result, "pending_review": pending})
        parts = ([render_summary(saved, 0)] if saved else []) + warnings
        if parts:
            self._best_effort(self.tg.send, row.reply_chat_id, "\n\n".join(parts),
                              summary_buttons(row.id) if saved else None)

    @staticmethod
    def _apply_time_choice(entry: dict, forced: str, ctx: UserContext) -> ExtractedItem:
        tz = ZoneInfo(ctx.tz)
        it = localize(ExtractedItem.model_validate(entry["item"]), ctx, strict=False)
        day = it.starts_at.astimezone(tz).date() if it.starts_at else ctx.now.date()
        if forced == "event" and entry.get("forced_time"):
            hh, mm = map(int, entry["forced_time"].split(":"))
            return it.model_copy(update={"kind": "event", "starts_at": datetime(day.year, day.month, day.day, hh, mm, tzinfo=tz)})
        return it.model_copy(update={"kind": "task", "starts_at": None,
                                     "due_at": datetime(day.year, day.month, day.day, 23, 59, tzinfo=tz)})

    def _review_entry_save(self, entry: dict, forced: str, ctx: UserContext, inbox_id: str,
                           saved: list[str], warnings: list[str]) -> None:
        if forced == "drop":
            return
        if entry.get("reason") == "time" and forced in ("event", "task"):
            saved.append(self._save(self._apply_time_choice(entry, forced, ctx), ctx, inbox_id))
            return
        # пользователь сам выбрал тип — не переделываем встречу в задачу и не требуем времени
        it = localize(ExtractedItem.model_validate(entry["item"]).model_copy(update={"kind": forced}), ctx, strict=False)
        if check_item(it, ctx, self._known_currencies(ctx), strict=False):
            fixed = [i for i, errs in self._extract_checked(it.source_text, ctx, forced, strict=False)
                     if not errs and i.kind == forced]
            it = fixed[0] if fixed else None
        if it is None:
            entry["failed"] = True
            warnings.append(f"⚠️ Не смог разобрать «{entry['item']['source_text']}» как "
                            f"{KIND_LABELS[forced]}. Напиши подробнее отдельным сообщением.")
            return
        saved.append(self._save(it, ctx, inbox_id))


def reply(tg, row: InboxRow, text: str, buttons=None) -> None:
    # a review pass must not overwrite the main summary message
    if row.reply_message_id and not row.result.get("pending_review"):
        tg.edit(row.reply_chat_id, row.reply_message_id, text, buttons)
    else:
        tg.send(row.reply_chat_id, text, buttons)


def error_reply(tg, row: InboxRow, text: str) -> None:
    if row.source in PREFIXES:
        text = chat_text(row, text)
        if row.text:
            quote = row.text[:100] + ("…" if len(row.text) > 100 else "")
            text += f"\n«{quote}»"
    reply(tg, row, text)


def run_one(row: InboxRow, pipeline: Pipeline, store, tg) -> None:
    original = copy.deepcopy(row.result)
    try:
        pipeline.process(row)
    except ExtractionError as e:
        log.warning("extraction failed for %s: %s", row.id, e)
        store.finish(row.id, "failed", original, f"extraction: {e}", notified=True)
        error_reply(tg, row, REPHRASE_TEXT)
    except Exception as e:  # noqa: BLE001 — любая другая ошибка: ретрай до 3 попыток
        log.exception("processing failed for %s (attempt %s)", row.id, row.attempts)
        if row.attempts < 3:
            store.finish(row.id, "pending", original, str(e))
        else:
            store.finish(row.id, "failed", original, str(e), notified=True)
            error_reply(tg, row, FAILED_TEXT)


def notify_failed(store, tg) -> None:
    for row in store.failed_unnotified():
        try:
            error_reply(tg, row, FAILED_TEXT)
            store.mark_notified(row.id)
        except Exception as e:
            log.warning("notify_failed: row %s skipped: %s", row.id, e)
