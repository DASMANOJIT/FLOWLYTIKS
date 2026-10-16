import * as XLSX from "xlsx";

const safe = value => typeof value === "string" && (/^[\s\u0000-\u001f]*[=+\-@]/u.test(value) || /^[\t\r\n]/.test(value)) ? "'" + value : value;
const sheet = rows => XLSX.utils.aoa_to_sheet(rows.map(row => row.map(safe)));

export function buildWorkLedgerWorkbook(report) {
  const matrix = report.matrix;
  if (!matrix) throw new Error("Weekly attendance matrix is unavailable. Refresh and retry.");
  const workbook = XLSX.utils.book_new();
  const attendance = sheet([
    [matrix.title], [`${report.weekStart} to ${report.weekEnd}`], [matrix.legend],
    ["Faculty ID", "Faculty Name", ...matrix.days.flatMap(day => [day.label, ""]), "Legacy / Unallocated (INR)", "Weekly Amount (INR)"],
    ["", "", ...matrix.days.flatMap(() => ["Morning", "Evening"]), "", ""],
    ...matrix.rows.map(row => [row.facultyCode, row.facultyName, ...row.days.flatMap(day => [day.MORNING.present ? "P" : "—", day.EVENING.present ? "P" : "—"]), row.legacyAmount, row.weeklyAmount]),
    ["", "Totals (INR)", ...matrix.totals.days.flatMap(day => [day.MORNING, day.EVENING]), matrix.totals.legacyAmount, matrix.totals.weeklyAmount],
  ]);
  attendance["!merges"] = [0, 1, 2].map(r => ({ s: { r, c: 0 }, e: { r, c: 17 } })).concat(matrix.days.map((_, i) => ({ s: { r: 3, c: 2 + i * 2 }, e: { r: 3, c: 3 + i * 2 } })));
  attendance["!cols"] = [{ wch: 16 }, { wch: 32 }, ...Array.from({ length: 14 }, () => ({ wch: 12 })), { wch: 22 }, { wch: 22 }];
  attendance["!rows"] = [{ hpt: 28 }, { hpt: 22 }, { hpt: 36 }, { hpt: 36 }, { hpt: 24 }];
  XLSX.utils.book_append_sheet(workbook, attendance, "Weekly Attendance");
  const details = [["Date", "Entry Type", "Faculty ID", "Faculty Name", "Attendance", "Amount", "Remarks", "Updated By", "Updated By Role", "Created At", "Updated At"], ...(report.entries || []).map(entry => [entry.date, entry.shift, entry.faculty?.facultyId || "", entry.faculty?.fullName || "", "Present", entry.amount, entry.remarks || "", entry.updatedByName || entry.updatedBy || "", entry.updatedByRole || "", entry.createdAt, entry.updatedAt])];
  XLSX.utils.book_append_sheet(workbook, sheet(details), "Work Ledger");
  XLSX.utils.book_append_sheet(workbook, sheet([["Faculty Name", "Attendance Entries", "Total Amount"], ...(report.summary?.facultyTotals || []).map(row => [row.facultyName, row.entries, row.totalAmount])]), "Faculty Totals");
  XLSX.utils.book_append_sheet(workbook, sheet([["Date", "Amount"], ["Week Start", report.weekStart], ["Week End", report.weekEnd], ...(report.days || []).map(day => [day.date, day.dailyTotal]), ["Weekly Total", report.summary?.totalAmount || 0]]), "Totals");
  return workbook;
}

// SheetJS CE writes the data/merges but not these custom fills. Amend only the
// generated first worksheet using its bundled ZIP API and browser XML parser.
export function styledAttendanceXlsx(workbook) {
  const archive = XLSX.CFB.read(new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" })), { type: "buffer" });
  const decoder = new TextDecoder(), encoder = new TextEncoder(), parser = new DOMParser();
  const readXml = path => {
    const entry = XLSX.CFB.find(archive, path);
    if (!entry) throw new Error("Attendance workbook layout could not be generated.");
    const xml = parser.parseFromString(decoder.decode(entry.content), "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("Attendance workbook XML is invalid.");
    return xml;
  };
  const styles = readXml("/xl/styles.xml"), data = readXml("/xl/worksheets/sheet1.xml");
  const ns = styles.documentElement.namespaceURI;
  const node = (name, attributes = {}) => { const element = styles.createElementNS(ns, name); for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value)); return element; };
  const fills = styles.getElementsByTagNameNS(ns, "fills")[0], formats = styles.getElementsByTagNameNS(ns, "cellXfs")[0];
  const indices = ["FFDBEAFE", "FFCFFAFE", null].map(colour => {
    const fillId = fills.children.length;
    if (colour) {
      const fill = node("fill"), pattern = node("patternFill", { patternType: "solid" });
      pattern.append(node("fgColor", { rgb: colour }), node("bgColor", { indexed: 64 })); fill.append(pattern); fills.append(fill);
    }
    const index = formats.children.length;
    const format = node("xf", { numFmtId: 2, fontId: 0, fillId: colour ? fillId : 0, borderId: 0, xfId: 0, applyFill: 1, applyAlignment: 1, applyNumberFormat: 1 });
    format.append(node("alignment", { horizontal: colour ? "center" : "left", vertical: "center", wrapText: 1 })); formats.append(format); return index;
  });
  fills.setAttribute("count", String(fills.children.length)); formats.setAttribute("count", String(formats.children.length));
  for (const cell of data.getElementsByTagNameNS(ns, "c")) {
    const address = XLSX.utils.decode_cell(cell.getAttribute("r"));
    cell.setAttribute("s", String(indices[address.r >= 3 && address.c >= 2 && address.c < 16 ? (address.c - 2) % 2 : 2]));
  }
  const serializer = new XMLSerializer();
  XLSX.CFB.utils.cfb_add(archive, "/xl/styles.xml", encoder.encode(serializer.serializeToString(styles)));
  XLSX.CFB.utils.cfb_add(archive, "/xl/worksheets/sheet1.xml", encoder.encode(serializer.serializeToString(data)));
  return new Uint8Array(XLSX.CFB.write(archive, { type: "array", fileType: "zip" }));
}
