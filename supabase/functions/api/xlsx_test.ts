import { assert, assertEquals } from "jsr:@std/assert@1";
import { colName, esc, writeXlsx } from "./xlsx.ts";
import { crc32 } from "./zip.ts";
import { unzip } from "./zip_test_helper.ts";

Deno.test("crc32 совпадает с эталоном", () => {
  assertEquals(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

Deno.test("имена колонок и экранирование", () => {
  assertEquals([colName(0), colName(25), colName(26), colName(701), colName(702)], ["A", "Z", "AA", "ZZ", "AAA"]);
  assertEquals(esc(`a<b>&"c"\u0007`), "a&lt;b&gt;&amp;&quot;c&quot;");
});

Deno.test("книга: листы, ячейки, фильтр и диаграмма на своих местах", async () => {
  const files = await unzip(await writeXlsx([
    {
      name: "Сводка",
      rows: [[{ v: "Итог", s: "title" }]],
      charts: [{
        type: "column", title: "Траты", categories: ["янв", "фев"],
        catRef: { sheet: "Данные", col: 0, from: 1, to: 2 },
        series: [{ name: "Сумма", values: [10, 20], ref: { sheet: "Данные", col: 1, from: 1, to: 2 }, color: "#2A78D6" }],
        at: { col: 0, row: 2, width: 600, height: 300 },
      }],
    },
    { name: "Данные", freeze: 1, filter: 0, rows: [["Месяц", "Сумма"], ["янв", 10], ["фев", { v: 20.5, s: "money" }], [null, "x<y"]] },
  ]));
  assert(files.has("[Content_Types].xml"));
  assert(files.get("[Content_Types].xml")!.includes('PartName="/xl/charts/chart1.xml"'));
  const data = files.get("xl/worksheets/sheet2.xml")!;
  assert(data.includes('<c r="B3" s="4"><v>20.5</v></c>'));
  assert(data.includes("<t xml:space=\"preserve\">x&lt;y</t>"));
  assert(data.includes('<autoFilter ref="A1:B4"/>'));
  assert(data.includes('state="frozen"'));
  assert(!data.includes("<drawing"));
  assert(files.get("xl/worksheets/sheet1.xml")!.includes('<drawing r:id="rId1"/>'));
  const chart = files.get("xl/charts/chart1.xml")!;
  assert(chart.includes("<c:f>'Данные'!$B$2:$B$3</c:f>"));
  assert(chart.includes("<c:f>'Данные'!$B$1</c:f>"), "имя ряда — из заголовка над данными");
  assert(chart.includes('<a:srgbClr val="2A78D6"/>'));
  assert(files.get("xl/workbook.xml")!.includes("'Данные'!$A$1:$B$4"));
});
