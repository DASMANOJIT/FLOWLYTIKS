const key = value => new Date(value).toISOString().slice(0, 10);
const money = value => Math.round((value + Number.EPSILON) * 100) / 100;
export function buildWeeklyAttendanceMatrix(entries, roster, start, end) {
  const days = [];
  for (let date = new Date(start); date <= new Date(end); date.setUTCDate(date.getUTCDate() + 1)) {
    days.push({ date: key(date), label: date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }) });
  }
  const rows = new Map();
  const ensure = faculty => {
    if (!rows.has(faculty.id)) rows.set(faculty.id, { facultyId: faculty.id, facultyCode: faculty.facultyId || "", facultyName: faculty.fullName || "Faculty", days: days.map(() => ({ MORNING: { present: false, amount: 0 }, EVENING: { present: false, amount: 0 } })), legacyAmount: 0, weeklyAmount: 0 });
    return rows.get(faculty.id);
  };
  roster.forEach(ensure);
  for (const entry of entries) {
    const index = days.findIndex(day => day.date === key(entry.date));
    if (index < 0) continue;
    const row = ensure({ ...entry.faculty, id: entry.facultyId });
    const amount = Number(entry.amount || 0);
    if (["MORNING", "EVENING"].includes(entry.shift)) {
      const cell = row.days[index][entry.shift]; cell.present = true; cell.amount = money(cell.amount + amount);
    } else row.legacyAmount = money(row.legacyAmount + amount);
    row.weeklyAmount = money(row.weeklyAmount + amount);
  }
  const ordered = [...rows.values()].sort((a, b) => a.facultyName.localeCompare(b.facultyName) || a.facultyId.localeCompare(b.facultyId));
  const totals = { days: days.map((_, i) => Object.fromEntries(["MORNING", "EVENING"].map(shift => [shift, money(ordered.reduce((sum, row) => sum + row.days[i][shift].amount, 0))]))), legacyAmount: money(ordered.reduce((sum, row) => sum + row.legacyAmount, 0)), weeklyAmount: money(ordered.reduce((sum, row) => sum + row.weeklyAmount, 0)) };
  return { title: "Subho’s Computer Institute — Weekly Faculty Attendance", days, rows: ordered, totals, legend: "P = recorded attendance; — = no recorded shift attendance. Totals use recorded amounts (INR). Legacy amounts are not allocated to shifts." };
}
