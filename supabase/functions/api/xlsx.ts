/**
 * Запись .xlsx с настоящими диаграммами Excel (DrawingML), без зависимостей.
 *
 * Диаграммы ссылаются на ячейки книги, поэтому в Excel/Numbers/Google Таблицах
 * они живые: правишь число — меняется столбик. Значения ещё и закэшированы
 * прямо в диаграмме: превью в Telegram и Quick Look ничего не пересчитывают.
 */
import { zip } from "./zip.ts";

export type Style =
  | "header" | "date" | "datetime" | "money" | "int" | "pct" | "title" | "muted" | "bold" | "boldMoney";
export type Cell = string | number | null | { v: string | number | null; s: Style };

/** Колонка и строки — с нуля, строки включительно. */
export type Range = { sheet: string; col: number; from: number; to: number };

export type Series = { name: string; values: number[]; ref: Range; color: string };

export type Chart = {
  type: "column" | "stacked" | "bar" | "line";
  title: string;
  categories: string[];
  catRef: Range;
  series: Series[];
  /** Своя заливка каждого столбика — для одного ряда, где цвет несёт категорию. */
  pointColors?: string[];
  /** Подписи значений на столбиках; ось значений тогда не нужна. */
  labels?: boolean;
  numFmt?: string;
  /** Верх оси значений — чтобы подпись у самого длинного столбика не обрезалась. */
  max?: number;
  /** Левый верхний угол (ячейка с нуля) и размер в пикселях. */
  at: { col: number; row: number; width: number; height: number };
};

export type Sheet = {
  name: string;
  rows: Cell[][];
  widths?: number[];
  /** Сколько верхних строк закрепить. */
  freeze?: number;
  /** Строка заголовка (с нуля), от которой включить фильтр. */
  filter?: number;
  gridlines?: boolean;
  charts?: Chart[];
};

const STYLE_ID: Record<Style, number> = {
  header: 1, date: 2, datetime: 3, money: 4, int: 5, pct: 6, title: 7, muted: 8, bold: 9, boldMoney: 10,
};

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const NS_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// Управляющие символы Excel не принимает вовсе — файл открывается «с ошибкой».
// deno-lint-ignore no-control-regex
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
export const esc = (s: string) =>
  s.replace(BAD_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`;
export const rangeRef = (r: Range) =>
  `${quoteSheet(r.sheet)}!$${colName(r.col)}$${r.from + 1}:$${colName(r.col)}$${r.to + 1}`;

/** В ячейке Excel не больше 32 767 символов. */
const MAX_CELL = 32_000;

function cellXml(ref: string, cell: Cell): string {
  if (cell === null) return "";
  const { v, s } = typeof cell === "object" ? cell : { v: cell, s: undefined };
  const sa = s ? ` s="${STYLE_ID[s]}"` : "";
  if (v === null) return s ? `<c r="${ref}"${sa}/>` : "";
  if (typeof v === "number") return Number.isFinite(v) ? `<c r="${ref}"${sa}><v>${v}</v></c>` : "";
  const text = v.length > MAX_CELL ? v.slice(0, MAX_CELL) + "…" : v;
  return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

function sheetXml(sh: Sheet, selected: boolean, hasDrawing: boolean): string {
  const width = Math.max(1, ...sh.rows.map((r) => r.length));
  const rows = sh.rows.map((r, i) => {
    const cells = r.map((c, j) => cellXml(`${colName(j)}${i + 1}`, c)).join("");
    return cells ? `<row r="${i + 1}">${cells}</row>` : "";
  }).join("");
  const pane = sh.freeze
    ? `<pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze + 1}" activePane="bottomLeft" state="frozen"/>` +
      `<selection pane="bottomLeft" activeCell="A${sh.freeze + 1}" sqref="A${sh.freeze + 1}"/>`
    : "";
  const view = `<sheetViews><sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ""}` +
    `${sh.gridlines === false ? ' showGridLines="0"' : ""}>${pane}</sheetView></sheetViews>`;
  const cols = sh.widths?.length
    ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const filter = sh.filter !== undefined ? `<autoFilter ref="${filterRef(sh)}"/>` : "";
  return HEAD + `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<dimension ref="A1:${colName(width - 1)}${Math.max(1, sh.rows.length)}"/>` +
    view + '<sheetFormatPr defaultRowHeight="15"/>' + cols +
    (rows ? `<sheetData>${rows}</sheetData>` : "<sheetData/>") + filter +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
    (hasDrawing ? '<drawing r:id="rId1"/>' : "") + "</worksheet>";
}

function filterRef(sh: Sheet): string {
  const h = sh.filter!;
  const width = Math.max(1, sh.rows[h]?.length ?? 1);
  return `A${h + 1}:${colName(width - 1)}${Math.max(h + 1, sh.rows.length)}`;
}

const STYLES = HEAD + `<styleSheet xmlns="${NS_MAIN}">` +
  '<numFmts count="3"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/>' +
  '<numFmt numFmtId="165" formatCode="dd.mm.yyyy hh:mm"/><numFmt numFmtId="166" formatCode="#,##0.00"/></numFmts>' +
  '<fonts count="4">' +
  '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="16"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><sz val="10"/><color rgb="FF6B6B6B"/><name val="Calibri"/><family val="2"/></font>' +
  "</fonts>" +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left/><right/><top/><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="11">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="166" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  "</cellXfs>" +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

// ---------- диаграммы ----------

const INK = "595959";
const GRID = "E5E5E5";
const fill = (hex: string) => `<a:solidFill><a:srgbClr val="${hex.replace("#", "").toUpperCase()}"/></a:solidFill>`;
const txPr = (sz: number, bold = false) =>
  `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}"${bold ? ' b="1"' : ""}>${fill(INK)}</a:defRPr></a:pPr>` +
  '<a:endParaRPr lang="ru-RU"/></a:p></c:txPr>';

const strCache = (vals: string[]) =>
  `<c:strCache><c:ptCount val="${vals.length}"/>` +
  vals.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join("") + "</c:strCache>";
const numCache = (vals: number[]) =>
  `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>` +
  vals.map((v, i) => `<c:pt idx="${i}"><c:v>${Number.isFinite(v) ? v : 0}</c:v></c:pt>`).join("") + "</c:numCache>";

function seriesXml(ch: Chart, s: Series, i: number): string {
  const isLine = ch.type === "line";
  const head = `<c:idx val="${i}"/><c:order val="${i}"/>` +
    `<c:tx><c:strRef><c:f>${esc(quoteSheet(s.ref.sheet))}!$${colName(s.ref.col)}$${s.ref.from}</c:f>` +
    `${strCache([s.name])}</c:strRef></c:tx>`;
  const cat = `<c:cat><c:strRef><c:f>${esc(rangeRef(ch.catRef))}</c:f>${strCache(ch.categories)}</c:strRef></c:cat>`;
  const val = `<c:val><c:numRef><c:f>${esc(rangeRef(s.ref))}</c:f>${numCache(s.values)}</c:numRef></c:val>`;
  if (isLine) {
    return `<c:ser>${head}<c:spPr><a:ln w="22225" cap="rnd">${fill(s.color)}<a:round/></a:ln></c:spPr>` +
      `<c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr>${fill(s.color)}<a:ln w="9525">${fill("FFFFFF")}</a:ln></c:spPr></c:marker>` +
      `${cat}${val}<c:smooth val="0"/></c:ser>`;
  }
  const points = (ch.pointColors ?? []).map((c, k) =>
    `<c:dPt><c:idx val="${k}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr>${fill(c)}</c:spPr></c:dPt>`
  ).join("");
  const labels = ch.labels
    ? `<c:dLbls><c:numFmt formatCode="${esc(ch.numFmt ?? "#,##0")}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>` +
      `${txPr(900)}<c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/>` +
      '<c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>'
    : "";
  return `<c:ser>${head}<c:spPr>${fill(s.color)}</c:spPr><c:invertIfNegative val="0"/>${points}${labels}${cat}${val}</c:ser>`;
}

function chartXml(ch: Chart): string {
  const horizontal = ch.type === "bar";
  const series = ch.series.map((s, i) => seriesXml(ch, s, i)).join("");
  const axes = '<c:axId val="500000001"/><c:axId val="500000002"/>';
  const plot = ch.type === "line"
    ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/>${axes}</c:lineChart>`
    : `<c:barChart><c:barDir val="${horizontal ? "bar" : "col"}"/>` +
      `<c:grouping val="${ch.type === "stacked" ? "stacked" : "clustered"}"/><c:varyColors val="0"/>${series}` +
      `<c:gapWidth val="${horizontal ? 40 : 60}"/><c:overlap val="${ch.type === "stacked" ? 100 : -5}"/>${axes}</c:barChart>`;
  const noLine = "<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>";
  // Горизонтальные столбики — сверху самый большой: обратный порядок категорий,
  // а ось значений (если видна) пересекает их у последней, то есть внизу.
  const catAx = `<c:catAx><c:axId val="500000001"/><c:scaling><c:orientation val="${horizontal ? "maxMin" : "minMax"}"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="${horizontal ? "l" : "b"}"/><c:numFmt formatCode="General" sourceLinked="0"/>` +
    '<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' +
    `<c:spPr><a:ln w="9525">${fill("BFBFBF")}</a:ln></c:spPr>${txPr(900)}` +
    '<c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/>' +
    '<c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>';
  const valAx = `<c:valAx><c:axId val="500000002"/><c:scaling><c:orientation val="minMax"/>` +
    `${ch.max ? `<c:max val="${ch.max}"/><c:min val="0"/>` : ""}</c:scaling>` +
    `<c:delete val="${ch.labels ? 1 : 0}"/><c:axPos val="${horizontal ? "b" : "l"}"/>` +
    (ch.labels ? "" : `<c:majorGridlines><c:spPr><a:ln w="6350">${fill(GRID)}</a:ln></c:spPr></c:majorGridlines>`) +
    `<c:numFmt formatCode="${esc(ch.numFmt ?? "#,##0")}" sourceLinked="0"/>` +
    '<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' +
    `${noLine}${txPr(900)}<c:crossAx val="500000001"/><c:crosses val="${horizontal ? "max" : "autoZero"}"/>` +
    '<c:crossBetween val="between"/></c:valAx>';
  const legend = ch.series.length > 1
    ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${txPr(900)}</c:legend>`
    : "";
  const title = `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr>` +
    `<a:r><a:rPr lang="ru-RU" sz="1200" b="1">${fill("262626")}</a:rPr><a:t>${esc(ch.title)}</a:t></a:r></a:p></c:rich></c:tx>` +
    '<c:overlay val="0"/></c:title>';
  return HEAD + `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_REL}">` +
    '<c:roundedCorners val="0"/>' +
    `<c:chart>${title}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}${catAx}${valAx}</c:plotArea>` +
    `${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `<c:spPr>${fill("FFFFFF")}<a:ln><a:noFill/></a:ln></c:spPr>` +
    "</c:chartSpace>";
}

const EMU_PER_PX = 9525;

function drawingXml(charts: Chart[]): string {
  const anchors = charts.map((ch, i) => {
    const { col, row, width, height } = ch.at;
    return "<xdr:oneCellAnchor>" +
      `<xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
      `<xdr:ext cx="${width * EMU_PER_PX}" cy="${height * EMU_PER_PX}"/>` +
      `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="${esc(ch.title)}"/>` +
      "<xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>" +
      '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
      `<a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" r:id="rId${i + 1}"/></a:graphicData></a:graphic>` +
      "</xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>";
  }).join("");
  return HEAD + `<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}" xmlns:r="${NS_REL}">${anchors}</xdr:wsDr>`;
}

const rels = (items: [string, string][]) =>
  HEAD + `<Relationships xmlns="${NS_PKG}">` +
  items.map(([type, target], i) => `<Relationship Id="rId${i + 1}" Type="${REL}/${type}" Target="${target}"/>`).join("") +
  "</Relationships>";

export async function writeXlsx(sheets: Sheet[]): Promise<Uint8Array<ArrayBuffer>> {
  const files: { name: string; data: string }[] = [];
  const overrides: [string, string][] = [
    ["/xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"],
    ["/xl/styles.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"],
  ];
  let chartNo = 0;
  let drawingNo = 0;
  sheets.forEach((sh, i) => {
    const n = i + 1;
    const charts = sh.charts ?? [];
    files.push({ name: `xl/worksheets/sheet${n}.xml`, data: sheetXml(sh, i === 0, charts.length > 0) });
    overrides.push([`/xl/worksheets/sheet${n}.xml`, "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"]);
    if (charts.length === 0) return;
    const d = ++drawingNo;
    files.push({ name: `xl/worksheets/_rels/sheet${n}.xml.rels`, data: rels([["drawing", `../drawings/drawing${d}.xml`]]) });
    files.push({ name: `xl/drawings/drawing${d}.xml`, data: drawingXml(charts) });
    overrides.push([`/xl/drawings/drawing${d}.xml`, "application/vnd.openxmlformats-officedocument.drawing+xml"]);
    const targets: [string, string][] = [];
    for (const ch of charts) {
      const c = ++chartNo;
      files.push({ name: `xl/charts/chart${c}.xml`, data: chartXml(ch) });
      overrides.push([`/xl/charts/chart${c}.xml`, "application/vnd.openxmlformats-officedocument.drawingml.chart+xml"]);
      targets.push(["chart", `../charts/chart${c}.xml`]);
    }
    files.push({ name: `xl/drawings/_rels/drawing${d}.xml.rels`, data: rels(targets) });
  });

  const filters = sheets.map((sh, i) => sh.filter !== undefined
    ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">` +
      `${esc(quoteSheet(sh.name))}!${filterRef(sh).replace(/([A-Z]+)(\d+)/g, "$$$1$$$2")}</definedName>`
    : ""
  ).join("");
  const workbook = HEAD + `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    '<bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
    sheets.map((sh, i) => `<sheet name="${esc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
    "</sheets>" + (filters ? `<definedNames>${filters}</definedNames>` : "") + "</workbook>";
  const workbookRels = rels([
    ...sheets.map((_, i): [string, string] => ["worksheet", `worksheets/sheet${i + 1}.xml`]),
    ["styles", "styles.xml"],
  ]);
  const types = HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join("") + "</Types>";

  return await zip([
    { name: "[Content_Types].xml", data: types },
    { name: "_rels/.rels", data: rels([["officeDocument", "xl/workbook.xml"]]) },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRels },
    { name: "xl/styles.xml", data: STYLES },
    ...files,
  ]);
}
