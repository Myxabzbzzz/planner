import { useEffect, useState, type ReactNode } from "react";
import type { Api } from "../api";
import { fmtAmount, todayIso } from "../format";
import {
  buildNewEvent, buildNewHabit, buildNewNote, buildNewTask, buildNewTransaction,
} from "../newItem";
import type { NoteKind } from "../itemEdit";
import { saveError } from "../saveError";
import { hapticResult } from "../telegram";
import type { Categories } from "../types";
import { KINDS, TARGETS, targetLabel } from "./ItemSheets";
import { Sheet } from "./Sheet";

export type NewKind = "task" | "event" | "expense" | "income" | "note" | "habit";

const TITLES: Record<NewKind, string> = {
  task: "Новая задача",
  event: "Новая встреча",
  expense: "Новый расход",
  income: "Новый доход",
  note: "Новая заметка",
  habit: "Новая привычка",
};

const PICK: { key: NewKind; label: string }[] = [
  { key: "task", label: "Задача" },
  { key: "event", label: "Встреча" },
  { key: "expense", label: "Расход" },
  { key: "income", label: "Доход" },
  { key: "note", label: "Заметка" },
  { key: "habit", label: "Привычка" },
];

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="field"><span>{label}</span>{children}</label>
);

/**
 * Ручное добавление.
 *
 * Главная дыра старой версии: создать что-либо можно было только через ИИ-воркер
 * на ноутбуке владельца. Когда Mac спал, приложение превращалось в просмотрщик —
 * задача «позвонить врачу» просто повисала в очереди. Теперь запись уходит в базу
 * сразу, а композер с ИИ остаётся быстрым путём.
 */
export function NewSheet({ api, tz, currency, kind, onClose, onSaved }: {
  api: Api;
  tz: string;
  currency: string;
  kind: NewKind | null;
  onClose: () => void;
  onSaved: (kind: NewKind) => void;
}) {
  const today = todayIso(tz);
  const [pick, setPick] = useState<NewKind>(kind ?? "task");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [withWhom, setWithWhom] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [text, setText] = useState("");
  const [noteKind, setNoteKind] = useState<NoteKind>("thought");
  const [target, setTarget] = useState(7);
  const [cats, setCats] = useState<Categories | null>(null);

  // Встреча без даты и времени невозможна — подставляем сегодня и ближайший час.
  useEffect(() => {
    if (pick === "event") {
      setDate((d) => d || today);
      setTime((t) => t || "12:00");
    }
  }, [pick, today]);

  useEffect(() => {
    if (pick !== "expense" && pick !== "income") return;
    let alive = true;
    api.categories().then((c) => alive && setCats(c)).catch(() => alive && setCats({ expense: [], income: [] }));
    return () => { alive = false; };
  }, [api, pick]);

  const body = pick === "task" ? buildNewTask({ title, date, time })
    : pick === "event" ? buildNewEvent({ title, date, time, withWhom })
    : pick === "note" ? buildNewNote({ text, kind: noteKind })
    : pick === "habit" ? buildNewHabit({ name: title, target })
    : buildNewTransaction({ type: pick === "income" ? "income" : "expense", amount, title, category, date });

  const dirty = title !== "" || text !== "" || amount !== "" || withWhom !== "";

  async function save() {
    if (body === null) return;
    setBusy(true);
    setError(null);
    try {
      if (pick === "task") await api.createTask(body as never);
      else if (pick === "event") await api.createEvent(body as never);
      else if (pick === "note") await api.createNote(body as never);
      else if (pick === "habit") await api.createHabit(body as never);
      else await api.createTransaction(body as never);
      hapticResult(true);
      onSaved(pick);
    } catch (e) {
      hapticResult(false);
      setError(saveError(e));
      setBusy(false);
    }
  }

  const options = cats ? cats[pick === "income" ? "income" : "expense"] : [];

  return (
    <Sheet title={TITLES[pick]} busy={busy} dirty={dirty} onClose={onClose} footer={
      <>
        {error && <div className="sub danger">{error}</div>}
        <button type="button" className="btn wide block" onClick={() => void save()} disabled={busy || body === null}>
          {busy ? "Сохраняю…" : "Добавить"}
        </button>
      </>
    }>
      <div className="field">
        <span>Что добавить</span>
        <div className="chips">
          {PICK.map((p) => (
            <button type="button" key={p.key} className={p.key === pick ? "pill on" : "pill"}
              aria-pressed={p.key === pick} onClick={() => setPick(p.key)} disabled={busy}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {(pick === "task" || pick === "habit") && (
        <Field label={pick === "habit" ? "Название привычки" : "Что сделать"}>
          <input value={title} maxLength={200} disabled={busy} autoFocus
            placeholder={pick === "habit" ? "Зарядка 15 минут" : "Позвонить врачу"}
            onChange={(e) => setTitle(e.target.value)} />
        </Field>
      )}

      {pick === "task" && (
        <div className="row-2">
          <Field label="Срок">
            <input type="date" value={date} disabled={busy}
              onChange={(e) => { setDate(e.target.value); if (!e.target.value) setTime(""); }} />
          </Field>
          {date !== "" && (
            <Field label="Время">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} />
            </Field>
          )}
        </div>
      )}

      {pick === "habit" && (
        <div className="field">
          <span>Сколько раз в неделю</span>
          <div className="chips">
            {TARGETS.map((n) => (
              <button type="button" key={n} className={n === target ? "pill on" : "pill"}
                aria-pressed={n === target} onClick={() => setTarget(n)} disabled={busy}>
                {targetLabel(n)}
              </button>
            ))}
          </div>
        </div>
      )}

      {pick === "event" && (
        <>
          <Field label="Название">
            <input value={title} maxLength={200} disabled={busy} autoFocus placeholder="Созвон с Андреем"
              onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="row-2">
            <Field label="Дата">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
            </Field>
            <Field label="Время">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} />
            </Field>
          </div>
          <Field label="С кем">
            <input value={withWhom} maxLength={200} placeholder="необязательно"
              onChange={(e) => setWithWhom(e.target.value)} disabled={busy} />
          </Field>
        </>
      )}

      {(pick === "expense" || pick === "income") && (
        <>
          <Field label={`Сумма, ${currency}`}>
            <input inputMode="decimal" value={amount} disabled={busy} autoFocus placeholder="0"
              onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Название">
            <input value={title} maxLength={200} placeholder="необязательно"
              onChange={(e) => setTitle(e.target.value)} disabled={busy} />
          </Field>
          <Field label="Дата">
            <input type="date" value={date || today} onChange={(e) => setDate(e.target.value)} disabled={busy} />
          </Field>
          <div className="field">
            <span>Категория</span>
            <div className="chips">
              {options.map((c) => (
                <button type="button" key={c} className={c === category ? "pill on" : "pill"}
                  aria-pressed={c === category} onClick={() => setCategory(c === category ? "" : c)} disabled={busy}>
                  {c}
                </button>
              ))}
            </div>
            <input value={category} maxLength={50} placeholder="или своя категория"
              onChange={(e) => setCategory(e.target.value)} disabled={busy} />
          </div>
          <div className="card-foot">
            Сумма в {currency}. Другую валюту лучше надиктовать боту — он пересчитает по курсу дня.
          </div>
        </>
      )}

      {pick === "note" && (
        <>
          <Field label="Текст">
            <textarea rows={6} value={text} maxLength={4000} disabled={busy} autoFocus
              onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="field">
            <span>Тип</span>
            <div className="chips">
              {KINDS.map((k) => (
                <button type="button" key={k.key} className={k.key === noteKind ? "pill on" : "pill"}
                  aria-pressed={k.key === noteKind} onClick={() => setNoteKind(k.key)} disabled={busy}>
                  {k.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {(pick === "expense" || pick === "income") && amount !== "" && body !== null && (
        <div className="card-foot">Запишу {fmtAmount((body as { amount: number }).amount, currency)}.</div>
      )}
    </Sheet>
  );
}
