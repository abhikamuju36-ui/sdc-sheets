"use client";

import { useState, useEffect } from "react";
import {
  calcTotalEtcDollars,
  calcPercentOfTotal,
  calcStandardFeeEngineering,
  calcStandardFeeShop,
  calcTotalStandardFees,
} from "@/lib/standard-fees";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, TABLE_HEADER_ROW, TABLE_GRID } from "@/components/ui/classnames";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SelectOnFocusInput } from "@/components/SelectOnFocusInput";
import { MonthSelect } from "@/components/MonthSelect";

const RATE_INPUT_CLASS =
  "w-12 [appearance:textfield] border-none bg-transparent px-1 py-1 text-right text-xs outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none disabled:text-sdc-gray-400";

// Same weight/treatment as the Monthly ETC grid's phase dividers — see that
// page's own copy of this constant for why it needs `!` and the exact color.
const BLOCK_EDGE = "border-l-[33px]! border-l-[#808080]!";

function wholeHours(n: number): string {
  return Math.round(n).toString();
}
function currency(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function percent(n: number): string {
  return (n * 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "%";
}

type RateState = { engrRate: string; shopRate: string; partsMarkup: string; contingencyAmount: string };

function defaultRateState(r: RateRow): RateState {
  return {
    engrRate: String(r.engrRate),
    shopRate: String(r.shopRate),
    partsMarkup: String(r.partsMarkup),
    contingencyAmount: r.contingencyAmount ? String(r.contingencyAmount) : "",
  };
}
function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export type PoolCategory = "ENGINEERING_PM" | "ENGINEERING_WARRANTY" | "SHOP_MANUFACTURING" | "SHOP_WARRANTY";

export type RateRow = {
  jobId: number;
  jobIdLabel: string;
  jobName: string;
  status: string;
  etcEngineering: number;
  etcShop: number;
  etcParts: number;
  engrRate: number;
  shopRate: number;
  partsMarkup: number;
  contingencyAmount: number;
  notes: string;
};

export type PoolRow = {
  category: PoolCategory;
  group: "Engineering" | "Shop";
  dept: string;
  hint: string;
  data: null | {
    hoursAvailable: number;
    hoursPulledThisMonth: number;
    rate: number;
    previousMonthPulledHours: number;
    newHoursAddedThisMonth: number;
    hoursWorkedThisMonth: number;
  };
};

type FormAction = (formData: FormData) => void | Promise<void>;

// Client counterpart to the old fully server-rendered Standard Sheet: rate,
// contingency, and pulled-hours inputs used to be plain uncontrolled
// defaultValue inputs, so Total ETC $/% Total/Standard Fees/Total Standard
// Fees never visibly updated until the next Save Rates/Save Pools/Refresh
// round-trip — same gap as the Monthly ETC grid's Hours Worked column. This
// mirrors standard-fees.ts's math client-side (rates, the global contingency
// rate, and category-pool pulled hours are ALL cross-linked — a rate edit
// shifts the % Total denominator for every row, and a pulled-hours edit
// shifts every row's Standard Fee allocation — so all three live in one
// component's state) and recomputes every dependent cell live as you type.
// Submit still reads final DOM values by `name`, unchanged.
export function StandardSheetLive({
  month,
  q,
  allMonths,
  submittedMonths,
  isSubmitted,
  roleIsAdmin,
  submittedByName,
  submittedAtLabel,
  editable,
  poolsEditable,
  poolsCarriedFrom,
  initialContingencyRate,
  rows,
  poolRows,
  saveRatesAction,
  saveContingencyRateAction,
  savePoolsAction,
  submitMonthAction,
  reopenMonthAction,
  refreshPoolsAction,
}: {
  month: string;
  q?: string;
  allMonths: string[];
  submittedMonths: string[];
  isSubmitted: boolean;
  roleIsAdmin: boolean;
  submittedByName: string | null;
  submittedAtLabel: string | null;
  editable: boolean;
  poolsEditable: boolean;
  poolsCarriedFrom: string | null;
  initialContingencyRate: number;
  rows: RateRow[];
  poolRows: PoolRow[];
  saveRatesAction: FormAction;
  saveContingencyRateAction: FormAction;
  savePoolsAction: FormAction;
  submitMonthAction: FormAction;
  reopenMonthAction: FormAction;
  refreshPoolsAction: FormAction;
}) {
  const [contingencyRateText, setContingencyRateText] = useState(String(initialContingencyRate));
  const [rates, setRates] = useState<Record<number, RateState>>(() => Object.fromEntries(rows.map((r) => [r.jobId, defaultRateState(r)])));
  const [pulled, setPulled] = useState<Record<string, string>>(() =>
    Object.fromEntries(poolRows.filter((p) => p.data).map((p) => [p.category, String(p.data!.hoursPulledThisMonth)]))
  );

  // `rates`/`pulled` only seed from `rows`/`poolRows` at first mount — a month
  // switch or search-filter change swaps in a different job set (or subset)
  // without remounting this component, so any newly-appearing jobId was
  // missing from `rates` entirely and crashed every read of `rates[jobId]`
  // (found 2026-07-14 switching between April/May/June, which have different
  // job lists). Backfill missing entries whenever the row set changes,
  // without touching in-progress edits for jobs still present.
  useEffect(() => {
    setRates((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const r of rows) {
        if (!next[r.jobId]) {
          next[r.jobId] = defaultRateState(r);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [rows]);

  // Row lookup for updateRate, which only gets a jobId — needed so an edit on
  // a not-yet-backfilled row (the same render-timing gap the effect above
  // covers) merges onto real defaults instead of onto `undefined`.
  const rowById = new Map(rows.map((r) => [r.jobId, r]));

  function updateRate(jobId: number, field: "engrRate" | "shopRate" | "partsMarkup" | "contingencyAmount", value: string) {
    setRates((prev) => {
      const row = rowById.get(jobId);
      const base = prev[jobId] ?? (row ? defaultRateState(row) : { engrRate: "", shopRate: "", partsMarkup: "", contingencyAmount: "" });
      return { ...prev, [jobId]: { ...base, [field]: value } };
    });
  }

  // Pool math (sheet rows 77/79): New ETC Hours = Available − Pulled; Standard
  // Fee = New ETC Hours × Rate. `rate` isn't user-editable in this UI, so it's
  // carried through fixed from the server-loaded pool.
  const poolComputed = poolRows.map((p) => {
    if (!p.data) return { ...p, newEtcHours: 0, standardFee: 0, pulledValue: 0 };
    const pulledValue = num(pulled[p.category] ?? String(p.data.hoursPulledThisMonth));
    const newEtcHours = p.data.hoursAvailable - pulledValue;
    const standardFee = newEtcHours * p.data.rate;
    return { ...p, newEtcHours, standardFee, pulledValue };
  });
  const standardFeeByCategory = new Map(poolComputed.map((p) => [p.category, p.standardFee]));
  const poolTotals = {
    engineeringPM: standardFeeByCategory.get("ENGINEERING_PM") ?? 0,
    engineeringWarranty: standardFeeByCategory.get("ENGINEERING_WARRANTY") ?? 0,
    shopManufacturing: standardFeeByCategory.get("SHOP_MANUFACTURING") ?? 0,
    shopWarranty: standardFeeByCategory.get("SHOP_WARRANTY") ?? 0,
  };
  const engineeringTotal = poolTotals.engineeringPM + poolTotals.engineeringWarranty;
  const shopTotal = poolTotals.shopManufacturing + poolTotals.shopWarranty;

  const contingencyRate = num(contingencyRateText);
  const withTotals = rows.map((r) => {
    const rateState = rates[r.jobId] ?? defaultRateState(r);
    const rate = { engrRate: num(rateState.engrRate), shopRate: num(rateState.shopRate), partsMarkup: num(rateState.partsMarkup) };
    const contingencyAmount = num(rateState.contingencyAmount);
    const totalEtcDollars = calcTotalEtcDollars({ engineering: r.etcEngineering, shop: r.etcShop, parts: r.etcParts }, rate);
    return { ...r, rate, contingencyAmount, totalEtcDollars };
  });
  const grandTotalEtcDollars = withTotals.reduce((sum, r) => sum + r.totalEtcDollars, 0);
  const computedRows = withTotals.map((r) => {
    const percentOfTotal = calcPercentOfTotal(r.totalEtcDollars, grandTotalEtcDollars);
    const standardFeeEngineering = calcStandardFeeEngineering(percentOfTotal, poolTotals);
    const standardFeeShop = calcStandardFeeShop(percentOfTotal, poolTotals);
    const totalStandardFees = calcTotalStandardFees(
      r.totalEtcDollars,
      standardFeeEngineering,
      standardFeeShop,
      r.contingencyAmount,
      contingencyRate
    );
    return { ...r, percentOfTotal, standardFeeEngineering, standardFeeShop, totalStandardFees };
  });
  const grand = computedRows.reduce(
    (acc, r) => ({
      totalEtcDollars: acc.totalEtcDollars + r.totalEtcDollars,
      percentOfTotal: acc.percentOfTotal + r.percentOfTotal,
      standardFeeEngineering: acc.standardFeeEngineering + r.standardFeeEngineering,
      standardFeeShop: acc.standardFeeShop + r.standardFeeShop,
      contingencyAmount: acc.contingencyAmount + r.contingencyAmount,
      totalStandardFees: acc.totalStandardFees + r.totalStandardFees,
    }),
    { totalEtcDollars: 0, percentOfTotal: 0, standardFeeEngineering: 0, standardFeeShop: 0, contingencyAmount: 0, totalStandardFees: 0 }
  );

  const POOL_ROWS_META: Record<PoolCategory, { group: "Engineering" | "Shop"; dept: string; hint: string }> = {
    ENGINEERING_PM: { group: "Engineering", dept: "PM", hint: "Defaults to 450" },
    ENGINEERING_WARRANTY: { group: "Engineering", dept: "Warranty", hint: "Defaults to Hours Worked This Month" },
    SHOP_MANUFACTURING: { group: "Shop", dept: "Manufacturing", hint: "Defaults to Hours Worked This Month" },
    SHOP_WARRANTY: { group: "Shop", dept: "Warranty", hint: "Defaults to Hours Worked This Month" },
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <form className="flex w-full max-w-md gap-2">
          <input type="hidden" name="month" value={month} />
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search by Job Id or name…"
            className="w-full rounded-md border border-sdc-border px-3 py-2 text-sm focus:border-sdc-blue focus:outline-none"
          />
          <button type="submit" className="rounded-md bg-sdc-navy px-4 py-2 text-sm font-medium whitespace-nowrap text-white">
            Search
          </button>
        </form>

        <span className="text-xs font-medium text-sdc-gray-500">Month:</span>
        <MonthSelect months={allMonths} current={month} basePath="/standard-sheet" lockedMonths={submittedMonths} inProgressSuffix="" />

        <StatusBadge variant={isSubmitted ? "locked" : "needsReview"}>{isSubmitted ? "Submitted (frozen)" : "Live — not submitted"}</StatusBadge>
        {isSubmitted && submittedAtLabel && (
          <span className="text-xs text-sdc-gray-400">
            Submitted by {submittedByName ?? "—"} on {submittedAtLabel}
          </span>
        )}
        {!isSubmitted && rows.length > 0 && (
          <form action={submitMonthAction}>
            <button type="submit" className={BUTTON_PRIMARY}>
              Submit {month}
            </button>
          </form>
        )}
        {isSubmitted && roleIsAdmin && (
          <form action={reopenMonthAction}>
            <button type="submit" className={BUTTON_SECONDARY}>
              Reopen for editing
            </button>
          </form>
        )}

        {editable && (
          <form action={refreshPoolsAction}>
            <button type="submit" className={BUTTON_SECONDARY}>
              Refresh Pools (Power BI)
            </button>
          </form>
        )}

        {editable && (
          <form action={saveContingencyRateAction} className="flex items-center gap-2">
            <label className="text-xs font-medium text-sdc-gray-500">Global Contingency Rate</label>
            <SelectOnFocusInput
              type="number"
              step="0.01"
              name="contingencyRate"
              value={contingencyRateText}
              onChange={(e) => setContingencyRateText(e.target.value)}
              className="w-16 rounded-md border border-sdc-border px-1.5 py-2 text-right text-sm outline-none focus:border-sdc-blue"
            />
            <button type="submit" className={BUTTON_SECONDARY}>
              Save
            </button>
          </form>
        )}
      </div>

      <div className="flex flex-col items-start gap-6 xl:flex-row">
        <form action={saveRatesAction} className="min-w-0 flex-1">
          <h2 className="mb-2 font-heading text-base font-semibold tracking-tight text-sdc-navy">
            Execution Rates &amp; Standard Fees — {month}
          </h2>
          <div className="max-h-[calc(100vh-260px)] min-w-[480px] overflow-auto border border-sdc-border bg-white shadow-sm select-none styled-scrollbar">
            <table className={`w-full text-sm ${TABLE_GRID}`}>
              <thead className="sticky top-0 z-20 bg-white">
                <tr className={TABLE_HEADER_ROW}>
                  <th rowSpan={3} className="sticky left-0 z-10 w-10 min-w-10 bg-white px-2 py-3 text-center align-bottom">
                    #
                  </th>
                  <th rowSpan={3} className="sticky left-10 z-10 w-20 min-w-20 bg-white px-3 py-3 align-bottom">
                    Job Id
                  </th>
                  <th rowSpan={3} className="sticky left-[120px] z-10 bg-white px-3 py-3 align-bottom">
                    Job Name
                  </th>
                  <th rowSpan={3} className="border-l border-sdc-border px-3 py-3 align-bottom">
                    Job Status
                  </th>
                  <th colSpan={3} className={`${BLOCK_EDGE} px-3 py-2 text-center`}>
                    Execution Rates <span className="text-sdc-blue" title="Editable column">✎</span>
                  </th>
                  <th colSpan={3} className={`${BLOCK_EDGE} bg-sdc-blue-light/40 px-3 py-2 text-center text-sdc-blue-dark`}>
                    Execution ETC
                  </th>
                  <th colSpan={2} className={`${BLOCK_EDGE} bg-sdc-gray-100 px-3 py-2 text-center text-sdc-gray-700`}>
                    Total ETC
                  </th>
                  <th colSpan={2} className={`${BLOCK_EDGE} bg-[#D6E4F0] px-3 py-2 text-center text-sdc-blue-dark`}>
                    Standard Fees
                  </th>
                  <th rowSpan={3} className={`${BLOCK_EDGE} bg-[#F8D7DA] px-3 py-2 text-center text-red-800`}>
                    Contingency <span title="Editable column">✎</span>
                  </th>
                  <th rowSpan={3} className={`${BLOCK_EDGE} bg-sdc-yellow-bg px-3 py-3 text-center align-bottom`}>
                    Total Standard Fees
                  </th>
                  <th rowSpan={3} className={`${BLOCK_EDGE} px-3 py-3 align-bottom`}>
                    Notes <span className="text-sdc-blue" title="Editable column">✎</span>
                  </th>
                </tr>
                <tr className={TABLE_HEADER_ROW}>
                  <th className={`${BLOCK_EDGE} px-2 py-2 text-center`}>ENGR</th>
                  <th className="px-2 py-2 text-center">Shop</th>
                  <th className="px-2 py-2 text-center">Parts</th>
                  <th className={`${BLOCK_EDGE} bg-sdc-blue-light/40 px-2 py-2 text-center text-sdc-blue-dark`}>Engineering</th>
                  <th className="bg-sdc-blue-light/40 px-2 py-2 text-center text-sdc-blue-dark">Shop</th>
                  <th className="bg-sdc-blue-light/40 px-2 py-2 text-center text-sdc-blue-dark">Parts</th>
                  <th className={`${BLOCK_EDGE} bg-sdc-gray-100 px-2 py-2 text-center text-sdc-gray-700`}>Total ETC</th>
                  <th className="bg-sdc-gray-100 px-2 py-2 text-center text-sdc-gray-700">% Total</th>
                  <th className={`${BLOCK_EDGE} bg-[#D6E4F0] px-2 py-2 text-center text-sdc-blue-dark`}>Engineering</th>
                  <th className="bg-[#D6E4F0] px-2 py-2 text-center text-sdc-blue-dark">Shop</th>
                </tr>
                <tr className={TABLE_HEADER_ROW}>
                  <th className={`${BLOCK_EDGE} px-2 py-1.5 text-center text-[10px]`}>All</th>
                  <th className="px-2 py-1.5 text-center text-[10px]">All</th>
                  <th className="px-2 py-1.5 text-center text-[10px]">All</th>
                  <th className={`${BLOCK_EDGE} bg-sdc-blue-light/40 px-2 py-1.5 text-center text-[10px] text-sdc-blue-dark`}>New ETC</th>
                  <th className="bg-sdc-blue-light/40 px-2 py-1.5 text-center text-[10px] text-sdc-blue-dark">New ETC</th>
                  <th className="bg-sdc-blue-light/40 px-2 py-1.5 text-center text-[10px] text-sdc-blue-dark">New ETC</th>
                  <th className={`${BLOCK_EDGE} bg-sdc-gray-100 px-2 py-1.5 text-[10px]`}></th>
                  <th className="bg-sdc-gray-100 px-2 py-1.5 text-[10px]"></th>
                  <th className={`${BLOCK_EDGE} bg-[#D6E4F0] px-2 py-1.5 text-center text-[10px] text-sdc-blue-dark`}>PM/Warranty</th>
                  <th className="bg-[#D6E4F0] px-2 py-1.5 text-center text-[10px] text-sdc-blue-dark">MFG/Warranty</th>
                </tr>
              </thead>
              <tbody>
                {computedRows.map((r, i) => (
                  <tr key={r.jobId} className={`hover:bg-sdc-blue-light/40 ${i % 2 === 1 ? "bg-sdc-gray-50/60" : ""}`}>
                    <td className={`sticky left-0 z-10 w-10 min-w-10 px-2 py-2 text-center text-sdc-gray-400 ${i % 2 === 1 ? "bg-sdc-gray-50" : "bg-white"}`}>
                      {i + 1}
                    </td>
                    <td className={`sticky left-10 z-10 w-20 min-w-20 px-3 py-2 font-mono text-sdc-gray-400 ${i % 2 === 1 ? "bg-sdc-gray-50" : "bg-white"}`}>
                      {r.jobIdLabel}
                    </td>
                    <td
                      className={`sticky left-[120px] z-10 min-w-[240px] whitespace-nowrap px-3 py-2 font-medium text-sdc-navy ${i % 2 === 1 ? "bg-sdc-gray-50" : "bg-white"}`}
                      title={r.jobName}
                    >
                      {r.jobName}
                    </td>
                    <td className="border-l border-sdc-border px-3 py-2 text-sdc-gray-400">{r.status}</td>
                    <td className={`${BLOCK_EDGE} px-2 py-2`}>
                      {editable && <input type="hidden" name="jobId" value={r.jobId} />}
                      <SelectOnFocusInput
                        type="number"
                        step="0.01"
                        name={`engrRate__${r.jobId}`}
                        value={(rates[r.jobId] ?? defaultRateState(r)).engrRate}
                        onChange={(e) => updateRate(r.jobId, "engrRate", e.target.value)}
                        disabled={!editable}
                        aria-label={`ENGR rate, ${r.jobName}`}
                        className={RATE_INPUT_CLASS}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <SelectOnFocusInput
                        type="number"
                        step="0.01"
                        name={`shopRate__${r.jobId}`}
                        value={(rates[r.jobId] ?? defaultRateState(r)).shopRate}
                        onChange={(e) => updateRate(r.jobId, "shopRate", e.target.value)}
                        disabled={!editable}
                        aria-label={`Shop rate, ${r.jobName}`}
                        className={RATE_INPUT_CLASS}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <SelectOnFocusInput
                        type="number"
                        step="0.01"
                        name={`partsMarkup__${r.jobId}`}
                        value={(rates[r.jobId] ?? defaultRateState(r)).partsMarkup}
                        onChange={(e) => updateRate(r.jobId, "partsMarkup", e.target.value)}
                        disabled={!editable}
                        aria-label={`Parts markup, ${r.jobName}`}
                        className={RATE_INPUT_CLASS}
                      />
                    </td>
                    <td className={`${BLOCK_EDGE} bg-sdc-blue-light/10 px-1 py-2 text-right text-xs text-sdc-navy`}>{wholeHours(r.etcEngineering)}</td>
                    <td className="bg-sdc-blue-light/10 px-1 py-2 text-right text-xs text-sdc-navy">{wholeHours(r.etcShop)}</td>
                    <td className="bg-sdc-blue-light/10 px-1 py-2 text-right text-xs text-sdc-navy">{currency(r.etcParts)}</td>
                    <td className={`${BLOCK_EDGE} bg-sdc-gray-50 px-1 py-2 text-right text-xs text-sdc-navy`}>{currency(r.totalEtcDollars)}</td>
                    <td className="bg-sdc-gray-50 px-1 py-2 text-right text-xs text-sdc-navy">{percent(r.percentOfTotal)}</td>
                    <td className={`${BLOCK_EDGE} bg-[#D6E4F0]/40 px-1 py-2 text-right text-xs text-sdc-navy`}>{currency(r.standardFeeEngineering)}</td>
                    <td className="bg-[#D6E4F0]/40 px-1 py-2 text-right text-xs text-sdc-navy">{currency(r.standardFeeShop)}</td>
                    <td className={`${BLOCK_EDGE} bg-[#F8D7DA]/40 px-2 py-2`}>
                      {editable ? (
                        <SelectOnFocusInput
                          type="number"
                          step="0.01"
                          name={`contingencyAmount__${r.jobId}`}
                          value={(rates[r.jobId] ?? defaultRateState(r)).contingencyAmount}
                          onChange={(e) => updateRate(r.jobId, "contingencyAmount", e.target.value)}
                          placeholder="—"
                          aria-label={`Contingency amount, ${r.jobName}`}
                          className="w-20 [appearance:textfield] border-none bg-transparent px-1.5 py-1 text-right text-xs outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                      ) : (
                        <span className="block px-1.5 py-1 text-right text-xs text-sdc-gray-500">{r.contingencyAmount ? currency(r.contingencyAmount) : "—"}</span>
                      )}
                    </td>
                    <td className={`${BLOCK_EDGE} bg-sdc-yellow-bg/60 px-1 py-2 text-right text-xs font-medium text-sdc-navy`}>{currency(r.totalStandardFees)}</td>
                    <td className={`${BLOCK_EDGE} px-2 py-2`}>
                      {editable ? (
                        <SelectOnFocusInput
                          type="text"
                          name={`notes__${r.jobId}`}
                          defaultValue={r.notes}
                          aria-label={`Notes, ${r.jobName}`}
                          className="w-48 border-none bg-transparent px-1.5 py-1 text-xs outline-none"
                        />
                      ) : (
                        <span className="block min-w-48 whitespace-nowrap px-1.5 py-1 text-xs text-sdc-gray-500" title={r.notes}>
                          {r.notes || "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={17} className="px-4 py-5 text-sdc-gray-400">
                      No jobs found for {month}.
                    </td>
                  </tr>
                )}
                {rows.length > 0 && (
                  <tr className="border-t-2 border-sdc-navy bg-sdc-gray-100 font-medium">
                    <td className="sticky left-0 z-10 bg-sdc-gray-100 px-3 py-2" colSpan={4}>
                      Total
                    </td>
                    <td className={`${BLOCK_EDGE} px-2 py-2`} colSpan={3}></td>
                    <td className={`${BLOCK_EDGE} px-2 py-2`} colSpan={3}></td>
                    <td className={`${BLOCK_EDGE} px-1 py-2 text-right text-xs text-sdc-navy`}>{currency(grand.totalEtcDollars)}</td>
                    <td className="px-1 py-2 text-right text-xs text-sdc-navy">{percent(grand.percentOfTotal)}</td>
                    <td className={`${BLOCK_EDGE} px-1 py-2 text-right text-xs text-sdc-navy`}>{currency(grand.standardFeeEngineering)}</td>
                    <td className="px-1 py-2 text-right text-xs text-sdc-navy">{currency(grand.standardFeeShop)}</td>
                    <td className={`${BLOCK_EDGE} px-1 py-2 text-right text-xs text-sdc-navy`}>{grand.contingencyAmount ? currency(grand.contingencyAmount) : "—"}</td>
                    <td className={`${BLOCK_EDGE} px-1 py-2 text-right text-xs font-semibold text-sdc-navy`}>{currency(grand.totalStandardFees)}</td>
                    <td className={`${BLOCK_EDGE} px-2 py-2`}></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {editable && rows.length > 0 && (
            <div className="mt-4">
              <button type="submit" className={`${BUTTON_PRIMARY} px-5 py-2.5`}>
                Save Rates
              </button>
            </div>
          )}
        </form>

        <div className="w-fit max-w-full shrink-0">
          <h2 className="mb-2 font-heading text-base font-semibold tracking-tight text-sdc-navy">Standard Fees By Department — {month}</h2>
          {poolsCarriedFrom && (
            <p className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              No pool data has been pulled for {month} yet — showing {poolsCarriedFrom}&apos;s figures as an estimate (Standard Fees above are
              allocated from these). Click &quot;Refresh Pools (Power BI)&quot; above to pull {month}&apos;s exact numbers.
            </p>
          )}
          <form action={savePoolsAction}>
            <div className="max-h-[calc(100vh-260px)] w-fit max-w-full overflow-auto border border-sdc-border bg-white shadow-sm select-none styled-scrollbar">
              <table className={`text-sm ${TABLE_GRID}`}>
                <colgroup>
                  <col className="w-32" />
                  <col className="w-28" />
                  <col className="w-56" />
                  <col className="w-28" />
                </colgroup>
                <thead className="sticky top-0 z-20 bg-white">
                  <tr className={TABLE_HEADER_ROW}>
                    <th className="px-3 py-2">Billing Group</th>
                    <th className="px-3 py-2">Department</th>
                    <th className="px-3 py-2">Attribute</th>
                    <th className="px-3 py-2 text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {(["Engineering", "Shop"] as const).flatMap((group) => {
                    const band = group === "Engineering" ? "bg-[#D9E7F5]" : "bg-[#FBE2D5]";
                    const depts = poolComputed.filter((p) => POOL_ROWS_META[p.category].group === group);
                    const groupSpan = depts.reduce((n, d) => n + (d.data ? 7 : 1), 0);
                    let firstOfGroup = true;

                    return depts.flatMap((p) => {
                      const meta = POOL_ROWS_META[p.category];
                      const groupCell = (rowSpan: number) => (
                        <td rowSpan={rowSpan} className={`px-3 py-2 text-center font-medium text-sdc-navy ${band}`}>
                          {group}
                        </td>
                      );

                      if (!p.data) {
                        const row = (
                          <tr key={p.category} className="hover:bg-sdc-blue-light/40">
                            {firstOfGroup && groupCell(groupSpan)}
                            <td className="px-3 py-2 text-center text-sdc-gray-700">{meta.dept}</td>
                            <td colSpan={2} className="px-3 py-2 text-sdc-gray-400">
                              No pool data for {month} — use &quot;Refresh Pools (Power BI)&quot;.
                            </td>
                          </tr>
                        );
                        firstOfGroup = false;
                        return [row];
                      }

                      const hours = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
                      const attrs: { label: string; node: React.ReactNode; yellow?: boolean; bold?: boolean }[] = [
                        { label: "Previous Month Pulled Hours", node: hours(p.data.previousMonthPulledHours) },
                        { label: "New Hours Added this Month", node: hours(p.data.newHoursAddedThisMonth) },
                        { label: "Hours Available", node: hours(p.data.hoursAvailable), bold: true },
                        { label: "Hours Worked this Month", node: hours(p.data.hoursWorkedThisMonth) },
                        {
                          label: "Hours being pulled this month",
                          yellow: true,
                          node: poolsEditable ? (
                            <SelectOnFocusInput
                              type="number"
                              step="0.01"
                              name={`pulled__${p.category}`}
                              value={pulled[p.category] ?? String(p.data.hoursPulledThisMonth)}
                              onChange={(e) => setPulled((prev) => ({ ...prev, [p.category]: e.target.value }))}
                              title={meta.hint}
                              aria-label={`Hours being pulled this month, ${group} ${meta.dept}`}
                              className="w-24 [appearance:textfield] border-none bg-transparent px-1.5 py-1 text-right text-xs outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                          ) : (
                            <span className="text-xs text-sdc-gray-500">{hours(p.pulledValue)}</span>
                          ),
                        },
                        { label: "New ETC Hours", node: hours(p.newEtcHours), bold: true },
                        { label: "Standard Fee", node: currency(p.standardFee), bold: true },
                      ];

                      const rowsOut = attrs.map((a, ai) => (
                        <tr key={`${p.category}-${a.label}`} className="hover:bg-sdc-blue-light/40">
                          {firstOfGroup && ai === 0 && groupCell(groupSpan)}
                          {ai === 0 && (
                            <td rowSpan={attrs.length} className="px-3 py-2 text-center text-sdc-gray-700">
                              {meta.dept}
                            </td>
                          )}
                          <td className="px-3 py-1.5 text-sdc-gray-700">{a.label}</td>
                          <td className={`px-3 py-1.5 text-right text-xs text-sdc-navy ${a.yellow ? "bg-sdc-yellow-bg/60" : ""} ${a.bold ? "font-semibold" : ""}`}>
                            {a.node}
                          </td>
                        </tr>
                      ));
                      firstOfGroup = false;
                      return rowsOut;
                    });
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-sdc-navy bg-sdc-gray-100 text-xs font-medium">
                    <td colSpan={3} className="px-3 py-2 text-right">
                      <span className="mr-6 rounded bg-[#D9E7F5] px-2 py-0.5 text-sdc-navy">Engineering Total: {currency(engineeringTotal)}</span>
                      <span className="rounded bg-[#FBE2D5] px-2 py-0.5 text-sdc-navy">Shop Total: {currency(shopTotal)}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-sdc-navy">{currency(engineeringTotal + shopTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {poolsEditable && poolRows.some((p) => p.data) && (
              <div className="mt-2">
                <button type="submit" className={BUTTON_SECONDARY}>
                  Save Pools
                </button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
