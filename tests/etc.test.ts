import { test } from "node:test";
import assert from "node:assert/strict";
import { calcHoursLeft, suggestNewEtc, round2, isMonthLocked, prevMonth, nextMonth, isValidMonth } from "../src/lib/etc";

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
