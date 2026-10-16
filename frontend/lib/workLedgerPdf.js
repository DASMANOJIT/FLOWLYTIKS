import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

let fontPromise;
export async function buildWorkLedgerPdf(report) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  if (!fontPromise) fontPromise = fetch("/fonts/NotoSans-Regular.ttf").then(async response => {
    if (!response.ok) throw new Error("Unable to load the report font.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
  }).catch(error => { fontPromise = undefined; throw error; });
  doc.addFileToVFS("NotoSans-Regular.ttf", await fontPromise);
  doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
  doc.addFont("NotoSans-Regular.ttf", "NotoSans", "bold");
  doc.setFont("NotoSans", "normal");
  const matrix = report.matrix;
  if (!matrix) throw new Error("Weekly attendance matrix is unavailable. Refresh and retry.");
  doc.setFontSize(15).setTextColor(29, 78, 216).text(matrix.title, 10, 14);
  doc.setFontSize(10).setTextColor(51, 65, 85).text(`Week: ${report.weekStart} to ${report.weekEnd} | Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`, 14, 25);
  autoTable(doc, {
    startY: 32, margin: { left: 8, right: 8, bottom: 28 }, tableWidth: 281,
    head: [[{ content: "Faculty ID", rowSpan: 2 }, { content: "Faculty Name", rowSpan: 2 }, ...matrix.days.map(day => ({ content: day.label, colSpan: 2 })), { content: "Weekly INR", rowSpan: 2 }], matrix.days.flatMap(() => ["Morning", "Evening"])],
    body: matrix.rows.map(row => [row.facultyCode, row.facultyName, ...row.days.flatMap(day => [day.MORNING.present ? "P" : "—", day.EVENING.present ? "P" : "—"]), row.weeklyAmount.toFixed(2)]),
    foot: [["", "Totals (INR)", ...matrix.totals.days.flatMap(day => [day.MORNING.toFixed(2), day.EVENING.toFixed(2)]), matrix.totals.weeklyAmount.toFixed(2)]],
    styles: { font: "NotoSans", fontSize: 7, cellPadding: 1.5, halign: "center", overflow: "linebreak" },
    columnStyles: { 0: { cellWidth: 19 }, 1: { cellWidth: 45, halign: "left" }, ...Object.fromEntries(Array.from({ length: 14 }, (_, i) => [i + 2, { cellWidth: 14 }])), 16: { cellWidth: 21 } },
    headStyles: { fillColor: [29, 78, 216] }, footStyles: { fillColor: [239, 246, 255], textColor: [30, 64, 175] },
    showHead: "everyPage", showFoot: "lastPage", rowPageBreak: "avoid",
    didParseCell: data => {
      if (data.column.index >= 2 && data.column.index < 16 && !(data.section === "head" && data.row.index === 0)) {
        data.cell.styles.fillColor = data.column.index % 2 === 0 ? [219, 234, 254] : [207, 250, 254]; data.cell.styles.textColor = [30, 64, 100];
      }
    },
    didDrawPage: () => { doc.setFontSize(7).text("P = recorded attendance; — = no recorded shift attendance. Legacy amounts are unallocated. Totals use stored INR amounts.", 8, doc.internal.pageSize.getHeight() - 7); },
  });
  if (matrix.totals.legacyAmount) {
    doc.setFontSize(8).setTextColor(51, 65, 85).text(
      `Historical unallocated attendance: INR ${matrix.totals.legacyAmount.toFixed(2)} is included in weekly/grand totals, but not assigned to Morning or Evening.`,
      8, doc.lastAutoTable.finalY + 6, { maxWidth: 281 }
    );
  }
  return doc;
}
