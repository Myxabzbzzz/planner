// Dev-only fake backend so every screen renders in a plain browser (outside Telegram).
// Imported only behind `import.meta.env.DEV`, so production builds drop it entirely.
import { todayIso } from "./format";

const TZ = "Europe/Moscow";
export const DEV_BASE = "https://dev-mock.local";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (isoDate: string, days: number) => iso(new Date(Date.parse(isoDate + "T00:00:00Z") + days * 86_400_000));

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function weekOf(today: string) {
  const d = new Date(today + "T00:00:00Z");
  const monday = shift(today, -((d.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => shift(monday, i));
}

function data() {
  const today = todayIso(TZ);
  const week = weekOf(today);
  const rnd = seeded(42);
  const habitDays = (rate: number, doneToday: boolean) =>
    Array.from({ length: 28 }, (_, i) => ({ date: shift(today, i - 27), done: i === 27 ? doneToday : rnd() < rate }));

  const events = [
    { id: "e1", title: "Созвон с Андреем по ремонту", time: "10:30", with_whom: "Андрей", done: true },
    { id: "e2", title: "Стоматолог, ул. Лесная 12", time: "15:00", with_whom: null, done: false },
    { id: "e3", title: "Ужин в «Пушкине»", time: "19:30", with_whom: "Катя", done: false },
  ];
  const tasks = [
    { id: "t1", title: "Оплатить интернет и коммуналку", due: shift(today, -1) + "T23:59:00", overdue: true, done_at: null },
    { id: "t2", title: "Отправить договор Игорю на подпись", due: today + "T14:00:00", overdue: false, done_at: null },
    { id: "t3", title: "Купить корм коту", due: today + "T23:59:00", overdue: false, done_at: null },
    { id: "t4", title: "Записаться на ТО машины", due: shift(today, 3) + "T23:59:00", overdue: false, done_at: null },
    { id: "t5", title: "Подарок маме на день рождения", due: shift(today, 9) + "T23:59:00", overdue: false, done_at: null },
    { id: "t6", title: "Разобрать фотографии с Алтая", due: null, overdue: false, done_at: null },
    { id: "t7", title: "Прочитать «Думай медленно… решай быстро»", due: null, overdue: false, done_at: null },
    { id: "t8", title: "Продлить страховку", due: shift(today, -2) + "T23:59:00", overdue: false, done_at: shift(today, -2) + "T18:10:00" },
  ];
  const habits = [
    { id: "h1", name: "Зарядка 15 минут", target_per_week: 7, days: habitDays(0.8, true), streak: 9, done_today: true },
    { id: "h2", name: "Чтение перед сном", target_per_week: 5, days: habitDays(0.6, false), streak: 3, done_today: false },
    { id: "h3", name: "Без сахара", target_per_week: 7, days: habitDays(0.7, true), streak: 14, done_today: true },
    { id: "h4", name: "10 000 шагов", target_per_week: 4, days: habitDays(0.45, false), streak: 0, done_today: false },
  ];
  return { today, week, events, tasks, habits };
}

function money(month: string) {
  const { today } = data();
  const rnd = seeded(month.split("-").reduce((a, b) => a * 31 + Number(b), 7));
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastDay = month === today.slice(0, 7) ? Number(today.slice(8, 10)) : daysInMonth;
  const by_day = Array.from({ length: lastDay }, (_, i) => ({
    date: `${month}-${String(i + 1).padStart(2, "0")}`,
    expense: rnd() < 0.15 ? 0 : Math.round(300 + rnd() * rnd() * 6400),
  })).filter((d) => d.expense > 0);
  const expense = by_day.reduce((s, d) => s + d.expense, 0);
  const shares = [["Продукты", 0.34], ["Кафе и рестораны", 0.19], ["Дом", 0.15], ["Транспорт", 0.12], ["Здоровье", 0.09], ["Подписки", 0.06], ["Подарки", 0.05]] as const;
  const by_category = shares.map(([name, s]) => ({ name, amount: Math.round(expense * s) }));
  const last = (k: number) => `${month}-${String(Math.max(1, lastDay - k)).padStart(2, "0")}`;
  const operations = [
    { id: "o1", date: last(0), type: "expense", title: "Кофе и круассан", amount: 460, category: "Кафе и рестораны", orig: null },
    { id: "o2", date: last(0), type: "expense", title: "Такси до офиса", amount: 612, category: "Транспорт", orig: null },
    { id: "o3", date: last(0), type: "expense", title: "Перекрёсток", amount: 1268, category: "Продукты", orig: null },
    { id: "o4", date: last(1), type: "income", title: "Зарплата", amount: 145000, category: "Зарплата", orig: null },
    { id: "o5", date: last(1), type: "expense", title: "Spotify", amount: 1086.4, category: "Подписки",
      orig: { amount: 11.99, currency: "USD", rate: 90.61, rate_date: last(1) } },
    { id: "o6", date: last(2), type: "expense", title: "Аптека", amount: 1840, category: "Здоровье", orig: null },
    { id: "o7", date: last(2), type: "expense", title: "", amount: 3200, category: "Дом", orig: null },
    { id: "o8", date: last(3), type: "expense", title: "Обед с командой", amount: 2750, category: "Кафе и рестораны", orig: null },
  ];
  return {
    base_currency: "RUB", month, expense, income: 145000 + 18500, limit: 90000,
    by_category, by_day, operations,
  };
}

function notes() {
  const { today } = data();
  return [
    { id: "n1", kind: "thought", text: "Сделать в планере недельный обзор по воскресеньям — что успел, что перенёс.", created_at: today + "T09:12:00" },
    { id: "n2", kind: "journal", text: "Хороший день. Утром пробежка вдоль набережной, потом долго говорили с Катей про переезд. Кажется, решились.", created_at: shift(today, -1) + "T22:40:00" },
    { id: "n3", kind: "thought", text: "Книга на осень: «Тонкое искусство пофигизма» — посоветовал Андрей.", created_at: shift(today, -2) + "T13:05:00" },
    { id: "n4", kind: "journal", text: "Устал, но доволен: закрыли проект и наконец-то выспался.\nЗавтра — без экранов до обеда.", created_at: shift(today, -4) + "T23:18:00" },
    { id: "n5", kind: "thought", text: "Идея подарка маме: сертификат в спа и цветы с доставкой к 9 утра.", created_at: shift(today, -6) + "T18:47:00" },
  ];
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
let polls = 0;

export const devFetch: typeof fetch = async (input, init) => {
  await new Promise((r) => setTimeout(r, 250));
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  const p = url.pathname;
  const d = data();
  if ((init?.method ?? "GET") === "POST") {
    if (p === "/inbox" || p === "/inbox/audio") { polls = 0; return json({ id: "dev1", worker_online: true }); }
    return json({});
  }
  // ?mock=noaccess previews the «Нет доступа» screen
  if (p === "/me" && location.search.includes("mock=noaccess")) return new Response("", { status: 403 });
  if (p === "/me") return json({ name: "Михаил", tz: TZ, base_currency: "RUB" });
  if (p === "/today") {
    return json({
      base_currency: "RUB",
      events: d.events.map((e) => ({ ...e, date: d.today })),
      tasks: d.tasks.slice(0, 3).map(({ id, title, due, overdue }) => ({ id, title, due, overdue })),
      tasks_more: 2, spent_today: 2340, month_spent: 61240, limit: 90000,
      habits: d.habits.map((h) => ({ id: h.id, name: h.name, done: h.done_today })),
    });
  }
  if (p === "/tasks") {
    const f = url.searchParams.get("filter");
    const open = d.tasks.filter((t) => !t.done_at);
    const list = f === "done" ? d.tasks.filter((t) => t.done_at)
      : f === "nodue" ? open.filter((t) => !t.due)
      : f === "upcoming" ? open.filter((t) => t.due && t.due.slice(0, 10) > d.today)
      : open.filter((t) => t.due && t.due.slice(0, 10) <= d.today);
    return json({ tasks: list });
  }
  if (p === "/events") {
    return json({ days: [
      { date: d.today, events: d.events },
      { date: d.week.find((x) => x !== d.today) ?? d.week[0], events: [{ id: "e4", title: "Планёрка", time: "09:30", with_whom: "команда", done: true }] },
      { date: d.week[5], events: [{ id: "e5", title: "Баня с друзьями", time: "17:00", with_whom: "Саша, Дима", done: false }] },
    ] });
  }
  if (p === "/money") return json(money(url.searchParams.get("month") ?? d.today.slice(0, 7)));
  if (p === "/habits") return json({ habits: d.habits });
  if (p === "/categories") return json({ expense: ["Продукты", "Кафе и рестораны", "Дом", "Транспорт", "Здоровье", "Подписки", "Подарки"], income: ["Зарплата", "Фриланс", "Подарки"] });
  if (p === "/notes") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    return json({ notes: notes().filter((n) => n.text.toLowerCase().includes(q)), next_before: null });
  }
  if (p.startsWith("/inbox/")) {
    polls += 1;
    return json(polls < 2 ? { status: "processing", reply: null } : { status: "done", reply: "✅ Записал расход: кофе 350 ₽ → Кафе и рестораны" });
  }
  return new Response("not found", { status: 404 });
};
