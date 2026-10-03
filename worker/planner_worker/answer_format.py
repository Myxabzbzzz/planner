from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from .format import fmt_amount, fmt_number
from .periods import MONTHS_GEN, Period, month_period
from .prompts import SHORT_DAYS

UNKNOWN_TEXT = ("🤔 Не понял вопрос. Могу ответить про траты, доходы, лимит, задачи и встречи — "
                "например: «сколько потратил на такси в сентябре?»")
OPS = ("операция", "операции", "операций")
DAYS = ("день", "дня", "дней")
ONE = Decimal("1")


def plural(n: int, forms: tuple[str, str, str]) -> str:
    n = abs(n) % 100
    if 11 <= n <= 14:
        return forms[2]
    n %= 10
    return forms[0] if n == 1 else forms[1] if 2 <= n <= 4 else forms[2]


def _dec(v) -> Decimal:
    return Decimal(str(v or 0))


def _money(v, ctx) -> str:
    return fmt_amount(_dec(v), ctx.base_currency)


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def _pct(part: Decimal, whole: Decimal) -> Decimal:
    return (part * 100 / whole).quantize(ONE, ROUND_HALF_UP)


def _with(title: str, who: str | None) -> str:
    return f" ({who})" if who and who.lower() not in title.lower() else ""


def render_sum(intent: str, category: str | None, p: Period, data: dict, ctx) -> str:
    total, count = _dec(data["total"]), int(data["count"])
    icon = "💸" if intent == "spent" else "💰"
    if count == 0:
        if intent == "spent":
            return f"{icon} Трат{f' на «{category}»' if category else ''} {p.phrase} нет"
        return f"{icon} Доходов{f' «{category}»' if category else ''} {p.phrase} нет"
    head = _cap(category) if category else ("Потрачено" if intent == "spent" else "Доход")
    return f"{icon} {head} {p.phrase}: {_money(total, ctx)} ({count} {plural(count, OPS)})"


def render_top(p: Period, data: dict, ctx) -> str:
    total = _dec(data["total"])
    if total == 0:
        return f"📊 Трат {p.phrase} нет"
    rows = [(r["name"], _dec(r["amount"])) for r in data["items"]]
    if _dec(data["other"]) > 0:
        rows.append(("остальное", _dec(data["other"])))
    lines = [f"📊 Траты {p.phrase} — {_money(total, ctx)}:"]
    lines += [f"{_cap(name)} — {fmt_number(amount)} ({_pct(amount, total)}%)" for name, amount in rows]
    return "\n".join(lines)


def render_limit(category: str | None, data: dict, ctx) -> str:
    y, m = map(int, data["month"].split("-"))
    month = month_period(y, m, date(y, m, 1)).phrase
    on = f" на «{category}»" if category else ""
    spent = _dec(data["spent"])
    if data["limit"] is None:
        return f"🎯 Лимит{on} не задан. Потрачено{on} {month}: {_money(spent, ctx)}"
    limit = _dec(data["limit"])
    left = limit - spent
    if left < 0:
        return f"🎯 Лимит{on} превышен на {_money(-left, ctx)} ({fmt_number(spent)} из {_money(limit, ctx)})"
    days = max(int(data["days_left"]), 1)
    per_day = (left / days).quantize(ONE, ROUND_HALF_UP)
    return (f"🎯 До лимита{on}: {_money(left, ctx)} из {fmt_number(limit)} · ещё {days} {plural(days, DAYS)} "
            f"→ ~{fmt_number(per_day)} в день")


def render_compare(category: str | None, p1: Period, a: dict, p2: Period, b: dict, ctx) -> str:
    x, y = _dec(a["total"]), _dec(b["total"])
    on = f" на «{category}»" if category else ""
    line = f"📈 Траты{on}: {p1.short} {_money(x, ctx)} vs {p2.short} {_money(y, ctx)}"
    if y > 0:
        pct = _pct(x - y, y)
        line += f" · {'+' if pct > 0 else '−' if pct < 0 else ''}{abs(pct)}%"
    return line


def render_agenda(p: Period, data: dict) -> str:
    single = p.start is not None and p.end is not None and (p.end - p.start).days == 1
    heading = _cap(p.phrase)
    if single and p.phrase in ("сегодня", "вчера", "завтра"):
        heading += f", {p.start.day} {MONTHS_GEN[p.start.month - 1]}"
    events, tasks = data["events"], data["tasks"]
    if not events and not tasks:
        return f"📅 {heading}: ничего не запланировано 🎉"
    lines = [f"📅 {heading}:"]
    for e in events:
        d = date.fromisoformat(e["day"])
        when = e["time"] if single else f"{SHORT_DAYS[d.weekday()]} {d:%d.%m} {e['time']}"
        lines.append(f"{when} {e['title']}{_with(e['title'], e.get('with_whom'))}{' ✓' if e['done'] else ''}")
    lines += [f"{'✅' if t['done'] else '☑️'} {t['title']}" for t in tasks]
    return "\n".join(lines)


def render_open_tasks(data: dict) -> str:
    parts = [("просрочено", int(data["overdue"])), ("сегодня", int(data["today"])),
             ("позже", int(data["later"])), ("без срока", int(data["no_due"]))]
    total = sum(n for _, n in parts)
    if total == 0:
        return "☑️ Всё сделано 🎉"
    lines = [f"☑️ Не сделано: {total} (" + " · ".join(f"{k} {n}" for k, n in parts if n) + ")"]
    for it in data["items"]:
        due = f" — до {date.fromisoformat(it['due']):%d.%m}" if it.get("due") else ""
        if it["bucket"] == "overdue":
            lines.append(f"⚠️ {it['title']}{due}")
        elif it["bucket"] == "today":
            lines.append(f"• {it['title']} — сегодня")
        else:
            lines.append(f"• {it['title']}{due}")
    more = total - len(data["items"])
    if more > 0:
        lines.append(f"…и ещё {more}")
    return "\n".join(lines)


def _event_line(e: dict) -> str:
    d = date.fromisoformat(e["day"])
    return (f"{e['title']}{_with(e['title'], e.get('with_whom'))} — "
            f"{SHORT_DAYS[d.weekday()]}, {d.day} {MONTHS_GEN[d.month - 1]}, {e['time']}")


def render_find_event(query: str, data: dict) -> str:
    if data["future"]:
        return "\n".join(f"🔎 {_event_line(e)}" for e in data["future"])
    if data["past"]:
        return "🔎 Впереди таких встреч нет. Последние:\n" + "\n".join(_event_line(e) for e in data["past"])
    return f"🔎 Не нашёл встреч с «{query}» за последний и ближайший месяц"


def render_no_category(name: str, cats: dict[str, str]) -> str:
    return f"🤔 Нет категории «{name}». Есть: {', '.join(cats)}"
