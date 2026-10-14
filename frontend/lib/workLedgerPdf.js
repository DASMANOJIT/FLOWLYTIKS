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
  doc.setFontSize(18).setTextColor(29, 78, 216).text("Flowlytiks - Faculty Work Ledger", 14, 16);
  doc.setFontSize(10).setTextColor(51, 65, 85).text(`Week: ${report.weekStart} to ${report.weekEnd} | Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`, 14, 25);
  const entries = report.entries || [];
  autoTable(doc, {
    startY: 32, margin: { left: 14, right: 14, bottom: 16 },
    head: [["Date", "Faculty ID / Name", "Attendance / Entry", "Actual Amount (INR)", "Updated By / Role", "Updated At", "Remarks"]],
    body: [
      ...entries.map(entry => [entry.date, `${entry.faculty?.facultyId || "-"}\n${entry.faculty?.fullName || "-"}`, `Present\n${entry.shift === "DAILY" ? "Daily" : "Legacy " + entry.shift.toLowerCase()}`, Number(entry.amount || 0).toFixed(2), `${entry.updatedByName || entry.updatedBy || "-"}\n${entry.updatedByRole || "-"}`, entry.updatedAt ? new Date(entry.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "-", entry.remarks || "-"]),
      ...(report.days || []).map(day => [day.date, "Daily Total", "", Number(day.dailyTotal || 0).toFixed(2), "", "", ""]),
      ["", "Weekly Total", "", Number(report.summary?.totalAmount || 0).toFixed(2), "", "", ""],
    ],
    styles: { font: "NotoSans", fontSize: 8, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: [29, 78, 216] }, alternateRowStyles: { fillColor: [239, 246, 255] },
    showHead: "everyPage", rowPageBreak: "avoid",
    didDrawPage: data => { doc.setFontSize(8).text(`Flowlytiks | Page ${data.pageNumber}`, 14, doc.internal.pageSize.getHeight() - 8); },
  });
  return doc;
}
