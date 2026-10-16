export function groupAttendanceFaculty(entries) {
  const faculty = new Map();
  for (const entry of entries) {
    const id = entry.facultyId || entry.faculty?.id;
    const current = faculty.get(id) || { id, name: entry.facultyName || entry.faculty?.fullName || "Faculty", shifts: [] };
    if (!current.shifts.includes(entry.shift)) current.shifts.push(entry.shift);
    faculty.set(id, current);
  }
  return [...faculty.values()];
}
