import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildWorkbook, type ExportData, exportFile, localClock, PALETTE, serial, withColors } from "./export_book.ts";
import type { Cell, Sheet } from "./xlsx.ts";
import { unzip } from "./zip_test_helper.ts";

const NOW = "2026-10-12T09:00:00Z";

function data(over: Partial<ExportData> = {}): ExportData {
  return {
    exported_at: NOW,
    profile: { name: "Муха", tz: "Asia/Tashkent", base_currency: "UZS", tg_username: "mukha", created_at: "2026-08-01T00:00:00Z" },
    categories: [], budgets: [], items: [], transactions: [], notes: [], habits: [],
    ...over,
  };
}
const tx = (category: string, amount: number, at = "2026-10-01T10:00:00+00:00", type: "expense" | "income" = "expense") => ({
  type, amount_base: amount, base_currency: "UZS", amount_orig: amount, currency_orig: "UZS",
  category, comment: null, occurred_at: at,
});
const sheet = (book: Sheet[], name: string) => book.find((s) => s.name === name)!;
const value = (c: Cell | undefined) => (c !== null && typeof c === "object" ? c.v : c);

Deno.test("пустой аккаунт — книга собирается, графики без данных не ломаются", async () => {
  const book = buildWorkbook(data(), NOW);
  assertEquals(book[0].name, "Графики");
  assertEquals(sheet(book, "Операции").rows.length, 1);
  assertEquals(sheet(book, "По месяцам").rows.length, 2, "только текущий месяц");
  assertEquals(book[0].charts!.map((c) => c.type), ["column", "column"], "без трат и привычек — только сводные");
  const files = await unzip((await exportFile(data(), "xlsx", NOW)).bytes);
  assertEquals([...files.keys()].filter((k) => k.startsWith("xl/charts/")).length, 2);
});

Deno.test("даты — в поясе человека и настоящими датами Excel", () => {
  const at = localClock("Asia/Tashkent")("2026-10-11T20:30:00Z");
  assertEquals(at, { y: 2026, m: 10, d: 12, hh: 1, mm: 30 });
  assertEquals(serial({ y: 1900, m: 3, d: 1, hh: 0, mm: 0 }), 61);
  assertEquals(localClock("Not/AZone")("2026-10-11T20:30:00Z").hh, 20, "неизвестный пояс — UTC, без падения");
  const book = buildWorkbook(data({ transactions: [tx("еда", 100, "2026-09-30T20:30:00Z")] }), NOW);
  const row = sheet(book, "Операции").rows[1];
  assertEquals(value(row[0]), serial({ y: 2026, m: 10, d: 1, hh: 1, mm: 30 }));
  assertEquals(value(row[3]), -100, "расход со знаком минус — колонку можно просто суммировать");
  // по поясу это уже октябрь
  assertEquals(sheet(book, "По месяцам").rows.slice(1).map((r) => [value(r[0]), value(r[2])]), [["окт 2026", 100]]);
});

Deno.test("цвет категории — как в приложении: свой, иначе свободная ступень по порядку", () => {
  const book = buildWorkbook(withColors(
    data({
      categories: [
        { name: "еда", type: "expense", is_default: true },
        { name: "такси", type: "expense", is_default: true },
      ],
      transactions: [tx("еда", 500), tx("такси", 300), tx("кафе", 100)],
    }),
    { expense: [{ name: "еда", color: null }, { name: "такси", color: "blue" }], income: [] },
  ), NOW);
  const bar = book[0].charts!.find((c) => c.type === "bar")!;
  assertEquals(bar.categories, ["еда", "такси", "кафе"]);
  // синий занят «такси» — «еда» получает следующий свободный
  assertEquals(bar.pointColors, [PALETTE.orange, PALETTE.blue, PALETTE.aqua]);
});

Deno.test("больше восьми категорий — хвост складывается в «Остальное»", () => {
  const names = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
  const book = buildWorkbook(data({ transactions: names.map((n, i) => tx(n, 1000 - i * 10)) }), NOW);
  const stacked = book[0].charts!.find((c) => c.type === "stacked")!;
  assertEquals(stacked.series.map((s) => s.name), ["a", "b", "c", "d", "e", "f", "g", "Остальное"]);
  const october = stacked.series.map((s) => s.values.at(-1));
  assertEquals(october.at(-1), 930 + 920 + 910);
  assertEquals(sheet(book, "Категории по месяцам").rows[0].length, 9);
});

Deno.test("ссылки графиков указывают на те же числа, что и в кэше", () => {
  const book = buildWorkbook(data({
    transactions: [tx("еда", 100, "2025-01-05T10:00:00Z"), tx("еда", 40), tx("зп", 900, "2026-10-02T10:00:00Z", "income")],
  }), NOW);
  const months = sheet(book, "По месяцам");
  assertEquals(months.rows.length, 1 + 22, "с января 2025 по октябрь 2026");
  const chart = book[0].charts![0];
  assertEquals(chart.categories.length, 12, "на графике — последние 12 месяцев");
  for (const s of chart.series) {
    const fromSheet = months.rows.slice(s.ref.from, s.ref.to + 1).map((r) => value(r[s.ref.col]));
    assertEquals(fromSheet, s.values, s.name);
  }
  assertEquals(chart.series.map((s) => s.values.at(-1)), [900, 40]);
});

Deno.test("привычки: отметки по неделям с понедельника, архивные не рисуются", () => {
  const book = buildWorkbook(data({
    habits: [
      { name: "Зарядка", target_per_week: 5, archived_at: null, created_at: NOW, logs: ["2026-10-05", "2026-10-11", "2026-10-12"] },
      { name: "Старая", target_per_week: 3, archived_at: "2026-01-01T00:00:00Z", created_at: NOW, logs: ["2025-12-01"] },
    ],
  }), NOW);
  const line = book[0].charts!.find((c) => c.type === "line")!;
  assertEquals(line.series.map((s) => s.name), ["Зарядка"]);
  assertEquals(line.categories.slice(-2), ["05.10", "12.10"]);
  assertEquals(line.series[0].values.slice(-2), [2, 1]);
  assertEquals(sheet(book, "Отметки привычек").rows.length, 1 + 4);
});

Deno.test("файл назван датой по поясу человека; JSON — та же выгрузка", async () => {
  const late = "2026-10-11T20:00:00Z"; // в Ташкенте уже 12-е
  assertEquals((await exportFile(data(), "xlsx", late)).name, "planner-2026-10-12.xlsx");
  const j = await exportFile(data({ notes: [{ kind: "thought", text: "идея", tags: null, created_at: NOW }] }), "json", late);
  assertEquals(j.name, "planner-2026-10-12.json");
  assertEquals(JSON.parse(new TextDecoder().decode(j.bytes)).notes[0].text, "идея");
  assert(j.mime.includes("json"));
});
