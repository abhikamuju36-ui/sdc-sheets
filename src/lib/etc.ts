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

// Is `month` safe for Power BI's LIVE hours/parts sync (Run Report)? Only the
// single most-recently-started month qualifies — either it's already the
// latest (an ongoing refresh) or it's the very next one (starting a new
// month, which has no entries yet so can never itself be "latest"). `null`
// latestMonth means no month has ever been started — anything goes.
//
// Found 2026-07-14: reopening an OLDER month and running Run Report seeds/
// resyncs it against TODAY's active-job roster and TODAY's raw actuals —
// wrong on both counts for a month that's already closed. Proven by directly
// reopening a corrected historical month and running it: real entries for
// since-completed jobs were deleted, and entries for jobs that only became
// active later were injected. See sync-etc-history.ts's assertCurrentEtcMonth.
export function isSafeForLiveEtcSync(month: string, latestMonth: string | null): boolean {
  if (latestMonth === null) return true;
  return month === latestMonth || month === nextMonth(latestMonth);
}

// Has Power BI actually published a real (non-blank) historical value for
// this month? Power BI's SUMMARIZECOLUMNS returns a row per Job/measure combo
// whether or not the period has been archived yet — an unarchived period
// still yields rows, just with every measure BLANK (→ null here). Used by
// sync-etc-history.ts to detect when a month that's locked in the app (and
// therefore normally skipped) now has real Power BI data available, so a
// premature/stale submission doesn't silently stay wrong forever — see the
// June 2026 data-correction incident.
export function hasPublishedHistory(rows: { NewEtc: number | null }[]): boolean {
  return rows.some((r) => r.NewEtc != null);
}

// Same idea as hasPublishedHistory, but for the 'Standard Fees' archive
// table, which reports existence via rows (a month with no archive yet
// simply has no rows at all) rather than a nullable measure. Splits Power
// BI's flat row list into per-month buckets, routing rows for an app-owned
// month into `ownedWithHistoryNow` instead of `rowsByMonth` — so
// syncCategoryPoolHistory can both skip overwriting it AND flag that real
// data is now available, instead of silently doing neither.
export function groupStandardFeesRows<Row>(
  rows: Row[],
  monthForRow: (row: Row) => string | undefined,
  ownedMonths: Set<string>
): { rowsByMonth: Map<string, Row[]>; ownedWithHistoryNow: string[] } {
  const rowsByMonth = new Map<string, Row[]>();
  const ownedWithHistoryNow: string[] = [];
  for (const row of rows) {
    const month = monthForRow(row);
    if (!month) continue;
    if (ownedMonths.has(month)) {
      if (!ownedWithHistoryNow.includes(month)) ownedWithHistoryNow.push(month);
      continue;
    }
    if (!rowsByMonth.has(month)) rowsByMonth.set(month, []);
    rowsByMonth.get(month)!.push(row);
  }
  return { rowsByMonth, ownedWithHistoryNow };
}
