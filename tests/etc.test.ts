import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcHoursLeft,
  suggestNewEtc,
  round2,
  isMonthLocked,
  prevMonth,
  nextMonth,
  isValidMonth,
  hasPublishedHistory,
  groupStandardFeesRows,
  isSafeForLiveEtcSync,
} from "../src/lib/etc";

test("calcHoursLeft: prior minus worked, may go negative", () => {
  assert.equal(calcHoursLeft(100, 40), 60);
  assert.equal(calcHoursLeft(10, 25), -15);
  assert.equal(calcHoursLeft(0, 0), 0);
});

test("suggestNewEtc: carry-forward rule when no hours worked", () => {
  // Dan's rule: no hours worked ⇒ no progress ⇒ New ETC = Prior ETC.
  assert.equal(suggestNewEtc(80, 0), 80);
  assert.equal(suggestNewEtc(0, 0), 0);
});

test("suggestNewEtc: subtracts worked hours, clamped at zero", () => {
  assert.equal(suggestNewEtc(100, 30), 70);
  assert.equal(suggestNewEtc(20, 50), 0); // overrun never suggests negative
});

test("round2: rounds to cents/hundredths", () => {
  assert.equal(round2(1.005 * 100), 100.5);
  assert.equal(round2(3.14159), 3.14);
  assert.equal(round2(2.675), 2.68); // 2.675 * 100 = 267.50000000000003 → 268
});

test("prevMonth/nextMonth: adjacent months incl. year rollover", () => {
  assert.equal(prevMonth("2026-06"), "2026-05");
  assert.equal(prevMonth("2026-01"), "2025-12");
  assert.equal(nextMonth("2026-06"), "2026-07");
  assert.equal(nextMonth("2026-12"), "2027-01");
  assert.equal(nextMonth(prevMonth("2026-01")), "2026-01"); // round-trip
});

test("isValidMonth: accepts YYYY-MM, rejects garbage", () => {
  assert.equal(isValidMonth("2026-06"), true);
  assert.equal(isValidMonth("2026-12"), true);
  assert.equal(isValidMonth("2026-13"), false);
  assert.equal(isValidMonth("2026-00"), false);
  assert.equal(isValidMonth("2026-6"), false);
  assert.equal(isValidMonth("banana"), false);
  assert.equal(isValidMonth(""), false);
});

test("isMonthLocked: locked only when non-empty and fully confirmed", () => {
  assert.equal(isMonthLocked([]), false); // never-started month is NOT locked
  assert.equal(isMonthLocked([{ needsReview: true }]), false);
  assert.equal(isMonthLocked([{ needsReview: false }, { needsReview: true }]), false);
  assert.equal(isMonthLocked([{ needsReview: false }, { needsReview: false }]), true);
});

// Regression coverage for the 2026-07-14 fix: a month locked in the app via a
// premature/live submission must not silently stay wrong forever once Power
// BI's real historical archive shows up for it (see sync-etc-history.ts).
test("hasPublishedHistory: true only when at least one row has a real (non-null) value", () => {
  assert.equal(hasPublishedHistory([]), false); // no period rows at all yet
  assert.equal(hasPublishedHistory([{ NewEtc: null }, { NewEtc: null }]), false); // period exists, still unarchived
  assert.equal(hasPublishedHistory([{ NewEtc: null }, { NewEtc: 100 }]), true); // archive has landed
  assert.equal(hasPublishedHistory([{ NewEtc: 0 }]), true); // a real zero still counts as published
});

test("groupStandardFeesRows: routes owned-month rows to ownedWithHistoryNow instead of rowsByMonth", () => {
  type Row = { key: number; month: string };
  const rows: Row[] = [
    { key: 1, month: "2026-04" }, // owned, archive present -> flagged
    { key: 2, month: "2026-04" },
    { key: 3, month: "2026-05" }, // not owned -> grouped normally
    { key: 4, month: "2026-06" }, // owned, archive present -> flagged (dedup across rows)
    { key: 5, month: "2026-06" },
  ];
  const { rowsByMonth, ownedWithHistoryNow, ownedRowsByMonth } = groupStandardFeesRows(rows, (r) => r.month, new Set(["2026-04", "2026-06"]));

  assert.deepEqual(ownedWithHistoryNow, ["2026-04", "2026-06"]); // deduped, one entry per owned month
  assert.deepEqual([...rowsByMonth.keys()], ["2026-05"]); // owned months never make it into rowsByMonth
  assert.equal(rowsByMonth.get("2026-05")?.length, 1);
  // owned rows aren't just flagged and discarded — they're preserved so the
  // caller can reconcile their non-decision fact fields against Power BI.
  assert.deepEqual([...ownedRowsByMonth.keys()].sort(), ["2026-04", "2026-06"]);
  assert.equal(ownedRowsByMonth.get("2026-04")?.length, 2);
  assert.equal(ownedRowsByMonth.get("2026-06")?.length, 2);
});

test("groupStandardFeesRows: an owned month with no Power BI rows at all is never flagged", () => {
  // Mirrors the real June 2026 case: the period doesn't exist in Power BI's
  // archive yet, so it must never falsely trigger the stale-data warning.
  type Row = { month: string };
  const rows: Row[] = [{ month: "2026-04" }];
  const { ownedWithHistoryNow } = groupStandardFeesRows(rows, (r) => r.month, new Set(["2026-04", "2026-06"]));
  assert.deepEqual(ownedWithHistoryNow, ["2026-04"]);
});

test("groupStandardFeesRows: rows with no resolvable month are dropped, not grouped under undefined", () => {
  type Row = { periodKey: number };
  const rows: Row[] = [{ periodKey: 999 }]; // unmapped period key
  const { rowsByMonth, ownedWithHistoryNow } = groupStandardFeesRows(rows, () => undefined, new Set());
  assert.equal(rowsByMonth.size, 0);
  assert.deepEqual(ownedWithHistoryNow, []);
});

// Regression coverage for the 2026-07-14 Run Report corruption bug: proven
// live by reopening a corrected historical month and running the real sync —
// 42 real entries were deleted, 62 wrong ones were injected. This is the
// pure decision logic behind the fix in etc-actions.ts's assertCurrentEtcMonth.
test("isSafeForLiveEtcSync: no month started yet — anything goes", () => {
  assert.equal(isSafeForLiveEtcSync("2026-07", null), true);
});

test("isSafeForLiveEtcSync: refreshing the existing latest month is safe", () => {
  assert.equal(isSafeForLiveEtcSync("2026-06", "2026-06"), true);
});

test("isSafeForLiveEtcSync: starting the very next month is safe (it has no entries yet, so was never 'latest')", () => {
  assert.equal(isSafeForLiveEtcSync("2026-07", "2026-06"), true);
});

test("isSafeForLiveEtcSync: any older month is unsafe, even the one right before latest", () => {
  assert.equal(isSafeForLiveEtcSync("2026-05", "2026-06"), false);
  assert.equal(isSafeForLiveEtcSync("2026-04", "2026-06"), false);
});

test("isSafeForLiveEtcSync: a month further in the future than 'next' is unsafe too", () => {
  assert.equal(isSafeForLiveEtcSync("2026-08", "2026-06"), false);
});
