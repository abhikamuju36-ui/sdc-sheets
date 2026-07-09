// Core ETC math, ported from "Managers Fill Out" as confirmed by Dan:
// - suggested hours left = prior ETC - hours worked this month
// - if zero hours worked, assume no progress: new ETC carries forward = prior ETC
// - otherwise the manager confirms/overrides the suggested value
export function calcHoursLeft(priorEtc: number, hoursWorked: number): number {
  return priorEtc - hoursWorked;
}

export function suggestNewEtc(priorEtc: number, hoursWorked: number): number {
  if (hoursWorked === 0) return priorEtc;
  return Math.max(calcHoursLeft(priorEtc, hoursWorked), 0);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// "YYYY-MM" month arithmetic, shared by seeding (carry-forward source), the
// in-order start guard, and the month picker's "next startable month" option.
export function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1); // m is 1-indexed; m-2 lands on the previous month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m, 1); // m is 1-indexed; index m is the next month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function isValidMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

// A month is locked once every entry in it has been submitted/confirmed.
// `length > 0` matters: `Array.every` on an empty array is vacuously true, which
// would make a month with no entries yet (never started) look "locked".
export function isMonthLocked(entries: { needsReview: boolean }[]): boolean {
  return entries.length > 0 && entries.every((e) => !e.needsReview);
}
