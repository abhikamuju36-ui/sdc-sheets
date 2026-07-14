"use client";

import { createContext, useContext, useMemo, useRef, useState } from "react";
import {
  calcTotalEtcDollars,
  calcPercentOfTotal,
  calcStandardFeeEngineering,
  calcStandardFeeShop,
  calcTotalStandardFees,
} from "@/lib/standard-fees";
import { saveExecutionRateField } from "@/lib/execution-rate-actions";

// Same weight/treatment as the Monthly ETC grid's other block dividers.
const STD_EDGE = "border-l-[33px]! border-l-[#808080]!";

function wholeNum(n: number): string {
  return Math.round(n).toString();
}
function currency(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function percent(n: number): string {
  return (n * 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "%";
}
function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

type RateField = "engrRate" | "shopRate" | "partsMarkup";

export type StandardJobBase = {
  jobId: number;
  jobName: string;
  etcEngineering: number;
  etcShop: number;
  etcParts: number;
  engrRate: number;
  shopRate: number;
  partsMarkup: number;
  contingencyAmount: number;
  notes: string;
};
export type PoolTotals = { engineeringPM: number; engineeringWarranty: number; shopManufacturing: number; shopWarranty: number };

type StandardComputed = {
  totalEtcDollars: number;
  percentOfTotal: number;
  standardFees: number;
  totalStandardFees: number;
};

type StandardGrandTotals = {
  totalEtcDollars: number;
  percentOfTotal: number;
  standardFees: number;
  contingencyAmount: number;
  totalStandardFees: number;
};

type Ctx = {
  getComputed: (jobId: number) => StandardComputed | undefined;
  getGrandTotals: () => StandardGrandTotals;
  getRateText: (jobId: number, field: RateField) => string;
  setRateText: (jobId: number, field: RateField, value: string) => void;
  disabled: boolean;
};

const StandardRatesCtx = createContext<Ctx | null>(null);

// The ETC grid's inline "Standard Sheet" columns mirror /standard-sheet's own
// rate/fee math (see StandardSheetLive.tsx for the primary tab's version of
// this same fix). Rate edits here used to autosave via ExecutionRateInput but
// never live-updated Total ETC $/% Total/Standard Fees/Total Standard Fees —
// same gap as everywhere else a rate feeds derived cells, and worse here
// since % Total depends on every job's rate at once, so all rows' rate state
// has to live in one shared provider, not per-row.
export function StandardRatesProvider({
  jobs,
  poolTotals,
  contingencyRate,
  disabled,
  children,
}: {
  jobs: StandardJobBase[];
  poolTotals: PoolTotals;
  contingencyRate: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const [rateText, setRateTextState] = useState<Record<number, Record<RateField, string>>>(() =>
    Object.fromEntries(
      jobs.map((j) => [j.jobId, { engrRate: String(j.engrRate), shopRate: String(j.shopRate), partsMarkup: String(j.partsMarkup) }])
    )
  );

  function setRateText(jobId: number, field: RateField, value: string) {
    setRateTextState((prev) => ({ ...prev, [jobId]: { ...prev[jobId], [field]: value } }));
  }
  function getRateText(jobId: number, field: RateField): string {
    return rateText[jobId]?.[field] ?? "0";
  }

  const computedByJob = useMemo(() => {
    const withTotals = jobs.map((j) => {
      const rt = rateText[j.jobId];
      const rate = {
        engrRate: num(rt?.engrRate ?? String(j.engrRate)),
        shopRate: num(rt?.shopRate ?? String(j.shopRate)),
        partsMarkup: num(rt?.partsMarkup ?? String(j.partsMarkup)),
      };
      const totalEtcDollars = calcTotalEtcDollars({ engineering: j.etcEngineering, shop: j.etcShop, parts: j.etcParts }, rate);
      return { ...j, totalEtcDollars };
    });
    const grandTotal = withTotals.reduce((sum, r) => sum + r.totalEtcDollars, 0);
    const map = new Map<number, StandardComputed>();
    for (const r of withTotals) {
      const percentOfTotal = calcPercentOfTotal(r.totalEtcDollars, grandTotal);
      const standardFeeEngineering = calcStandardFeeEngineering(percentOfTotal, poolTotals);
      const standardFeeShop = calcStandardFeeShop(percentOfTotal, poolTotals);
      const totalStandardFees = calcTotalStandardFees(
        r.totalEtcDollars,
        standardFeeEngineering,
        standardFeeShop,
        r.contingencyAmount,
        contingencyRate
      );
      map.set(r.jobId, {
        totalEtcDollars: r.totalEtcDollars,
        percentOfTotal,
        standardFees: standardFeeEngineering + standardFeeShop,
        totalStandardFees,
      });
    }
    return map;
  }, [jobs, rateText, poolTotals, contingencyRate]);

  const grandTotals = useMemo<StandardGrandTotals>(() => {
    const acc = { totalEtcDollars: 0, percentOfTotal: 0, standardFees: 0, contingencyAmount: 0, totalStandardFees: 0 };
    for (const j of jobs) {
      const c = computedByJob.get(j.jobId);
      if (!c) continue;
      acc.totalEtcDollars += c.totalEtcDollars;
      acc.percentOfTotal += c.percentOfTotal;
      acc.standardFees += c.standardFees;
      acc.contingencyAmount += j.contingencyAmount;
      acc.totalStandardFees += c.totalStandardFees;
    }
    return acc;
  }, [jobs, computedByJob]);

  const ctx: Ctx = { getComputed: (jobId) => computedByJob.get(jobId), getGrandTotals: () => grandTotals, getRateText, setRateText, disabled };
  return <StandardRatesCtx.Provider value={ctx}>{children}</StandardRatesCtx.Provider>;
}

function useStandardRates(): Ctx {
  const ctx = useContext(StandardRatesCtx);
  if (!ctx) throw new Error("EtcStandardCells must be rendered inside a StandardRatesProvider");
  return ctx;
}

function RateInput({ jobId, field, ariaLabel }: { jobId: number; field: RateField; ariaLabel: string }) {
  const { getRateText, setRateText, disabled } = useStandardRates();
  const text = getRateText(jobId, field);
  const lastSaved = useRef(text);

  async function handleBlur() {
    const raw = text.trim();
    if (raw === lastSaved.current) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    try {
      await saveExecutionRateField(jobId, field, parsed);
      lastSaved.current = raw;
    } catch {
      // Best-effort autosave, same as ExecutionRateInput — the typed value
      // stays on screen and retries as "changed" on the next blur.
    }
  }

  return (
    <input
      type="number"
      step="0.01"
      min="0"
      value={text}
      onChange={(e) => setRateText(jobId, field, e.target.value)}
      onBlur={handleBlur}
      disabled={disabled}
      aria-label={ariaLabel}
      className="w-full border-none bg-transparent text-right text-xs outline-none"
    />
  );
}

// Renders one job's Standard Sheet Fragment inside the Monthly ETC grid's
// row — same column order/styling as before, now reading live totals from
// StandardRatesProvider instead of a static server-computed prop.
export function EtcStandardCells({ job }: { job: StandardJobBase }) {
  const { getComputed } = useStandardRates();
  const std = getComputed(job.jobId);
  if (!std) return null;

  const cell = (edge: boolean) => `${edge ? STD_EDGE : "border-l border-sdc-border"} px-2 py-1 text-right text-xs text-sdc-navy`;

  return (
    <>
      <td className={cell(true)}>
        <RateInput jobId={job.jobId} field="engrRate" ariaLabel={`ENGR rate, ${job.jobName}`} />
      </td>
      <td className={cell(false)}>
        <RateInput jobId={job.jobId} field="shopRate" ariaLabel={`Shop rate, ${job.jobName}`} />
      </td>
      <td className={cell(false)}>
        <RateInput jobId={job.jobId} field="partsMarkup" ariaLabel={`Parts markup, ${job.jobName}`} />
      </td>
      <td className={`${cell(false)} bg-sdc-blue-light/10`}>{wholeNum(job.etcEngineering)}</td>
      <td className={`${cell(false)} bg-sdc-blue-light/10`}>{wholeNum(job.etcShop)}</td>
      <td className={`${cell(false)} bg-sdc-blue-light/10`}>{currency(job.etcParts)}</td>
      <td className={`${cell(false)} bg-sdc-gray-50`}>{currency(std.totalEtcDollars)}</td>
      <td className={`${cell(false)} bg-sdc-gray-50`}>{percent(std.percentOfTotal)}</td>
      <td className={`${cell(false)} bg-[#D6E4F0]/40`}>{currency(std.standardFees)}</td>
      <td className={cell(false)}>{job.contingencyAmount ? currency(job.contingencyAmount) : "—"}</td>
      <td className={`${cell(false)} bg-sdc-yellow-bg/60 font-medium`}>{currency(std.totalStandardFees)}</td>
      <td className="border-l border-sdc-border px-2 py-1 text-left text-xs text-sdc-gray-500 whitespace-nowrap" title={job.notes}>
        {job.notes || "—"}
      </td>
    </>
  );
}

// The grid's grand-total row for the Standard columns — same live totals
// (summed across every job) as the per-row cells above.
export function StandardGrandCells() {
  const { getGrandTotals } = useStandardRates();
  const grand = getGrandTotals();

  return (
    <>
      {/* Rates don't sum — the three rate columns stay blank in the total row. */}
      <td className={`${STD_EDGE} px-2 py-1`} />
      <td className="border-l border-sdc-border px-2 py-1" />
      <td className="border-l border-sdc-border px-2 py-1" />
      <td className="border-l border-sdc-border px-2 py-1" />
      <td className="border-l border-sdc-border px-2 py-1" />
      <td className="border-l border-sdc-border px-2 py-1" />
      <td className="border-l border-sdc-border px-2 py-1 text-right text-xs text-sdc-navy">{currency(grand.totalEtcDollars)}</td>
      <td className="border-l border-sdc-border px-2 py-1 text-right text-xs text-sdc-navy">{percent(grand.percentOfTotal)}</td>
      <td className="border-l border-sdc-border px-2 py-1 text-right text-xs text-sdc-navy">{currency(grand.standardFees)}</td>
      <td className="border-l border-sdc-border px-2 py-1 text-right text-xs text-sdc-navy">
        {grand.contingencyAmount ? currency(grand.contingencyAmount) : "—"}
      </td>
      <td className="border-l border-sdc-border px-2 py-1 text-right text-xs font-semibold text-sdc-navy">{currency(grand.totalStandardFees)}</td>
      <td className="border-l border-sdc-border px-2 py-1" />
    </>
  );
}
