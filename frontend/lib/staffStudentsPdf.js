import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

let fontPromise;
export async function buildStaffStudentsPdf(report) {
  if (!report.students?.length) throw new Error("No matching students to export.");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  // Use the same bundled font as student receipts for names and wrapped text.
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
  const f = report.filters;
  doc.setFontSize(18).setTextColor(29, 78, 216).text("Flowlytiks - Staff Student Report", 14, 16);
  doc.setFontSize(10).setTextColor(51, 65, 85);
  const lines = doc.splitTextToSize(`Generated: ${new Date(report.generatedAt).toLocaleString("en-IN")} | Matching records: ${report.count}\nSearch: ${f.search || "All"} | Class: ${f.class} | Batch: ${f.batch}\nFee month: ${f.month} | Academic session: ${f.academicYear}-${f.academicYear + 1} | Payment status: ${f.status}`, 269);
  doc.text(lines, 14, 25);
  autoTable(doc, {
    startY: 29 + lines.length * 5, margin: { left: 14, right: 14, bottom: 16 },
    head: [["Student ID", "Name", "Class", "Batch", "Contact", "Payment Status"]],
    body: report.students.map(row => [row.id, row.name, row.class, "Not available", row.phone || "-", row.paymentStatus]),
    styles: { font: "NotoSans", fontSize: 9, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: [29, 78, 216] }, alternateRowStyles: { fillColor: [239, 246, 255] },
    showHead: "everyPage", rowPageBreak: "avoid",
    columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 75 }, 2: { cellWidth: 26 }, 3: { cellWidth: 35 }, 4: { cellWidth: 65 }, 5: { cellWidth: 44 } },
    didDrawPage: data => { doc.setFontSize(8).text(`Flowlytiks | Page ${data.pageNumber}`, 14, doc.internal.pageSize.getHeight() - 8); },
  });
  return doc;
}
