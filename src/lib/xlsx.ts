/**
 * Minimal .xlsx writer (one sheet, typed cells, a few number formats) with no dependency:
 * an OOXML package in an uncompressed zip. Opens in Excel, Numbers, LibreOffice and Google Sheets.
 */
export type XStyle = 'text' | 'title' | 'muted' | 'header' | 'money' | 'number' | 'pct' | 'hours' | 'days' | 'date' | 'totalText' | 'totalMoney' | 'totalNumber' | 'totalPct' | 'totalHours' | 'totalDays';
export interface XCell {
  /** Numbers are written as numbers (dates as Excel serials with the 'date' style). */
  v: string | number | null;
  style?: XStyle;
}

const STYLES: XStyle[] = ['text', 'title', 'muted', 'header', 'money', 'number', 'pct', 'hours', 'days', 'date', 'totalText', 'totalMoney', 'totalNumber', 'totalPct', 'totalHours', 'totalDays'];

// Indian digit grouping (1,00,00,000) for ₹ using the two-condition cascade Excel allows.
const FMT = {
  money: '[>=10000000]"₹"##\\,##\\,##\\,##0;[>=100000]"₹"##\\,##\\,##0;"₹"##,##0',
  pct: '0.0%',
  hours: '0.0" h"',
  days: '0.0" d"',
  date: 'dd mmm yyyy',
};
const NUMFMT_ID = { money: 164, pct: 165, hours: 166, days: 167, date: 168 } as const;

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!).split('').filter((ch) => { const c = ch.charCodeAt(0); return c >= 32 || c === 9 || c === 10 || c === 13; }).join('');

const stylesXml = () => {
  // fonts: 0 normal, 1 bold, 2 bold 14, 3 grey
  const xf = (numFmtId: number, fontId: number, fillId = 0) => `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${fillId === 2 ? 1 : 0}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>`;
  const byStyle: Record<XStyle, string> = {
    text: xf(0, 0),
    title: xf(0, 2),
    muted: xf(0, 3),
    header: xf(0, 1, 2),
    money: xf(NUMFMT_ID.money, 0),
    number: xf(0, 0),
    pct: xf(NUMFMT_ID.pct, 0),
    hours: xf(NUMFMT_ID.hours, 0),
    days: xf(NUMFMT_ID.days, 0),
    date: xf(NUMFMT_ID.date, 0),
    totalText: xf(0, 1),
    totalMoney: xf(NUMFMT_ID.money, 1),
    totalNumber: xf(0, 1),
    totalPct: xf(NUMFMT_ID.pct, 1),
    totalHours: xf(NUMFMT_ID.hours, 1),
    totalDays: xf(NUMFMT_ID.days, 1),
  };
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="5">${(Object.keys(FMT) as (keyof typeof FMT)[]).map((k) => `<numFmt numFmtId="${NUMFMT_ID[k]}" formatCode="${esc(FMT[k])}"/>`).join('')}</numFmts><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FF6B7280"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F2F4"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFB8BCC4"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${STYLES.length}">${STYLES.map((s) => byStyle[s]).join('')}</cellXfs></styleSheet>`;
};

const colName = (i: number) => {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

function sheetXml(rows: XCell[][], widths: number[], freezeRow: number) {
  const body = rows
    .map((cells, r) => {
      const cs = cells
        .map((c, i) => {
          if (c.v === null || c.v === '') return c.style && c.style !== 'text' ? `<c r="${colName(i)}${r + 1}" s="${STYLES.indexOf(c.style)}"/>` : '';
          const s = STYLES.indexOf(c.style ?? 'text');
          return typeof c.v === 'number' && Number.isFinite(c.v)
            ? `<c r="${colName(i)}${r + 1}" s="${s}"><v>${c.v}</v></c>`
            : `<c r="${colName(i)}${r + 1}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(String(c.v))}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cs}</row>`;
    })
    .join('');
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const pane = freezeRow > 0 ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freezeRow}" topLeftCell="A${freezeRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${body}</sheetData></worksheet>`;
}

// ---------------------------------------------------------------- zip (stored, no compression)

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function zip(files: { name: string; data: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: DataView, o: number, x: number) => v.setUint16(o, x, true);
  const u32 = (v: DataView, o: number, x: number) => v.setUint32(o, x, true);
  files.forEach((f) => {
    const name = enc.encode(f.name);
    const data = enc.encode(f.data);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50);
    u16(lv, 4, 20);
    u16(lv, 6, 0x0800);
    u16(lv, 8, 0);
    u16(lv, 10, 0);
    u16(lv, 12, 0x21); // 1980-01-01
    u32(lv, 14, crc);
    u32(lv, 18, data.length);
    u32(lv, 22, data.length);
    u16(lv, 26, name.length);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    u32(cv, 0, 0x02014b50);
    u16(cv, 4, 20);
    u16(cv, 6, 20);
    u16(cv, 8, 0x0800);
    u16(cv, 14, 0x21);
    u32(cv, 16, crc);
    u32(cv, 20, data.length);
    u32(cv, 24, data.length);
    u16(cv, 28, name.length);
    u32(cv, 42, offset);
    cd.set(name, 46);
    parts.push(local, data);
    central.push(cd);
    offset += local.length + data.length;
  });
  const cdSize = central.reduce((t, c) => t + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 8, files.length);
  u16(ev, 10, files.length);
  u32(ev, 12, cdSize);
  u32(ev, 16, offset);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((t, p) => t + p.length, 0));
  let o = 0;
  all.forEach((p) => {
    out.set(p, o);
    o += p.length;
  });
  return out;
}

/** Excel serial day number for a "YYYY-MM-DD" date (1900 date system). */
export const excelSerial = (day: string) => {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
};

export function buildXlsx({ sheet, rows, widths = [], freezeRow = 0 }: { sheet: string; rows: XCell[][]; widths?: number[]; freezeRow?: number }): Uint8Array {
  const name = esc(sheet.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Report');
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: stylesXml() },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml(rows, widths, freezeRow) },
  ]);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
