"use client";

import { createContext, useContext, useMemo, useRef, useState } from "react";
import {
  calcTotalEtcDollars,
  calcPercentOfTotal,
  calcStandardFeeEngineering,
  calcStandardFeeShop,
  calcTotalStandardFees,
} from "@/lib/standard-fees";
import { saveContingencyAmount, saveJobNotes } from "@/lib/standard-sheet-actions";

// Same weight/treatment as the Monthly ETC grid's other block dividers.
const STD_EDGE = "border-l-[33px]! border-l-[#808080]!";

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
export type StandardRates = { engrRate: number; shopRate: number; partsMarkup: number };

// One department pool's inputs — the two manual cells (pulled/rate) plus the
// fixed Hours Available they derive against. The provider owns pulled/rate as
// live state so editing them in the pool panel recomputes every job's Standard
// Fee on the grid instantly (Excel's cross-linked D77/D79 → job-row formulas).
export type PoolRowInput = { category: string; hoursAvailable: number; hoursPulled: number; rate: number };

export type StandardJobBase = {
  jobId: number;
  jobName: string;
  etcEngineering: number;
  etcShop: number;
  etcParts: number;
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

// Frozen snapshot values for a submitted month — a plain array (serializable
// across the RSC boundary) the provider indexes by jobId. When present, the
// grid renders these instead of the live rate/pool math, so a later global-rate
// or pool edit can never mutate a locked month's numbers.
export type FrozenStandardRow = StandardComputed & { jobId: number };

type StandardGrandTotals = {
  totalEtcDollars: number;
  percentOfTotal: number;
  standardFees: number;
  contingencyAmount: number;
  totalStandardFees: number;
};

// Live per-category pool cell, exposed to the pool panel so it renders and
// edits the same state that drives the grid's job Standard Fees.
export type LivePoolCell = {
  pulled: string;
  rate: string;
  newEtcHours: number;
  standardFee: number;
  setPulled: (v: string) => void;
  setRate: (v: string) => void;
};

type Ctx = {
  getComputed: (jobId: number) => StandardComputed | undefined;
  getGrandTotals: () => StandardGrandTotals;
  editable: boolean;
  getPoolCell: (category: string) => LivePoolCell | undefined;
};

const StandardRatesCtx = createContext<Ctx | null>(null);

// The ETC grid's inline "Standard Sheet" columns mirror /standard-sheet's own
// rate/fee math. Rates are now a single global set (entered via the "ETC Rates"
// toolbar button, stored on StandardSheetSetting) applied to every job here, so
// there are no per-row rate inputs — a rate change reruns the whole block
// (% Total depends on every job's Total ETC $ at once) after the server
// revalidates this page.
export function StandardRatesProvider({
  jobs,
  rates,
  poolRows,
  contingencyRate,
  frozenRows,
  editable = false,
  children,
}: {
  jobs: StandardJobBase[];
  rates: StandardRates;
  poolRows: PoolRowInput[];
  contingencyRate: number;
  frozenRows?: FrozenStandardRow[];
  editable?: boolean;
  children: React.ReactNode;
}) {
  // The two manual pool cells live here (seeded once from server data) so the
  // pool panel and the grid's job Standard Fees read the same live values.
  const [pulled, setPulledState] = useState<Record<string, string>>(() =>
    Object.fromEntries(poolRows.map((p) => [p.category, String(p.hoursPulled)]))
  );
  const [rate, setRateState] = useState<Record<string, string>>(() =>
    Object.fromEntries(poolRows.map((p) => [p.category, String(p.rate)]))
  );

  // Standard Fee per category = (Hours Available − Pulled) × Rate (Excel D77/D79),
  // recomputed live — this is the % Total → job Standard Fee driver.
  const poolTotals = useMemo<PoolTotals>(() => {
    const fee = (category: string) => {
      const p = poolRows.find((x) => x.category === category);
      if (!p) return 0;
      const pulledVal = num(pulled[category] ?? String(p.hoursPulled));
      const rateVal = num(rate[category] ?? String(p.rate));
      return (p.hoursAvailable - pulledVal) * rateVal;
    };
    return {
      engineeringPM: fee("ENGINEERING_PM"),
      engineeringWarranty: fee("ENGINEERING_WARRANTY"),
      shopManufacturing: fee("SHOP_MANUFACTURING"),
      shopWarranty: fee("SHOP_WARRANTY"),
    };
  }, [poolRows, pulled, rate]);

  const computedByJob = useMemo(() => {
    // Submitted month: render exactly the frozen snapshot rows.
    if (frozenRows) {
      const m = new Map<number, StandardComputed>();
      for (const r of frozenRows) m.set(r.jobId, { totalEtcDollars: r.totalEtcDollars, percentOfTotal: r.percentOfTotal, standardFees: r.standardFees, totalStandardFees: r.totalStandardFees });
      return m;
    }
    const withTotals = jobs.map((j) => {
      const totalEtcDollars = calcTotalEtcDollars({ engineering: j.etcEngineering, shop: j.etcShop, parts: j.etcParts }, rates);
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
  }, [jobs, rates, poolTotals, contingencyRate, frozenRows]);

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

  function getPoolCell(category: string): LivePoolCell | undefined {
    const p = poolRows.find((x) => x.category === category);
    if (!p) return undefined;
    const pulledStr = pulled[category] ?? String(p.hoursPulled);
    const rateStr = rate[category] ?? String(p.rate);
    const newEtcHours = p.hoursAvailable - num(pulledStr);
    return {
      pulled: pulledStr,
      rate: rateStr,
      newEtcHours,
      standardFee: newEtcHours * num(rateStr),
      setPulled: (v: string) => setPulledState((prev) => ({ ...prev, [category]: v })),
      setRate: (v: string) => setRateState((prev) => ({ ...prev, [category]: v })),
    };
  }

  const ctx: Ctx = { getComputed: (jobId) => computedByJob.get(jobId), getGrandTotals: () => grandTotals, editable, getPoolCell };
  return <StandardRatesCtx.Provider value={ctx}>{children}</StandardRatesCtx.Provider>;
}

// Consumed by the pool panel to read/write the live pulled/rate cells.
export function useStandardPoolCell(category: string): LivePoolCell | undefined {
  const ctx = useContext(StandardRatesCtx);
  if (!ctx) throw new Error("useStandardPoolCell must be used inside a StandardRatesProvider");
  return ctx.getPoolCell(category);
}

function useStandardRates(): Ctx {
  const ctx = useContext(StandardRatesCtx);
  if (!ctx) throw new Error("EtcStandardCells must be rendered inside a StandardRatesProvider");
  return ctx;
}

// Renders one job's Standard Sheet Fragment inside the Monthly ETC grid's
// row — reads live totals from StandardRatesProvider (driven by the global
// ETC Rates). The per-job ENGR/Shop/Parts rate columns were removed; those
// rates are now set once via the "ETC Rates" toolbar button.
export function EtcStandardCells({ job }: { job: StandardJobBase }) {
  const { getComputed, editable } = useStandardRates();
  const std = getComputed(job.jobId);
  if (!std) return null;

  const cell = (edge: boolean) => `${edge ? STD_EDGE : "border-l border-sdc-border"} px-2 py-1 text-right text-xs text-sdc-navy`;

  return (
    <>
      {/* Heavy gray dividers between each Standard block, matching the sheet:
          [Total ETC · % Total] | [Standard Fees] | [Contingency] | [Total Std
          Fees] | [Notes]. % Total stays thin (same block as Total ETC). */}
      <td className={`${cell(true)} bg-sdc-gray-50`}>{currency(std.totalEtcDollars)}</td>
      <td className={`${cell(false)} bg-sdc-gray-50`}>{percent(std.percentOfTotal)}</td>
      <td className={`${cell(true)} bg-[#D6E4F0]/40`}>{currency(std.standardFees)}</td>
      <td className={cell(true)}>
        <ContingencyNotesInputs jobId={job.jobId} field="contingency" jobName={job.jobName} contingency={job.contingencyAmount} notes={job.notes} editable={editable} />
      </td>
      <td className={`${cell(true)} bg-sdc-yellow-bg/60 font-medium`}>{currency(std.totalStandardFees)}</td>
      <td className={`${STD_EDGE} px-2 py-1 text-left text-xs text-sdc-gray-500 whitespace-nowrap`} title={job.notes}>
        <ContingencyNotesInputs jobId={job.jobId} field="notes" jobName={job.jobName} contingency={job.contingencyAmount} notes={job.notes} editable={editable} />
      </td>
    </>
  );
}

// Contingency $ and Notes are the sheet's two per-job manual columns. Each is a
// single-field autosave input (on blur) when the month is unlocked; read-only
// text otherwise.
function ContingencyNotesInputs({
  jobId,
  field,
  jobName,
  contingency,
  notes,
  editable,
}: {
  jobId: number;
  field: "contingency" | "notes";
  jobName: string;
  contingency: number;
  notes: string;
  editable: boolean;
}) {
  const initial = field === "contingency" ? (contingency ? String(contingency) : "") : notes;
  const [value, setValue] = useState(initial);
  const lastSaved = useRef(initial);

  async function save() {
    if (value === lastSaved.current) return;
    try {
      if (field === "contingency") {
        const parsed = value.trim() === "" ? 0 : Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) return;
        await saveContingencyAmount(jobId, parsed);
      } else {
        await saveJobNotes(jobId, value);
      }
      lastSaved.current = value;
    } catch {
      // Best-effort autosave; typed value stays and retries on next blur.
    }
  }

  if (!editable) {
    if (field === "contingency") return <>{contingency ? currency(contingency) : "—"}</>;
    return <>{notes || "—"}</>;
  }

  return (
    <input
      type={field === "contingency" ? "number" : "text"}
      step={field === "contingency" ? "1" : undefined}
      min={field === "contingency" ? "0" : undefined}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      aria-label={`${field === "contingency" ? "Contingency amount" : "Notes"}, ${jobName}`}
      placeholder="—"
      className={`${field === "contingency" ? "w-20 text-right" : "w-28 text-left"} border-none bg-transparent text-xs outline-none focus:bg-white`}
    />
  );
}

// The grid's grand-total row for the Standard columns — same live totals
// (summed across every job) as the per-row cells above.
export function StandardGrandCells() {
  const { getGrandTotals } = useStandardRates();
  const grand = getGrandTotals();

  return (
    <>
      <td className={`${STD_EDGE} px-2 py-1 text-right text-xs text-sdc-navy`}>{currency(grand.totalEtcDollars)}</td>
      <td className="border-l border-sdc-border px-2 py-1 text-right text-xs text-sdc-navy">{percent(grand.percentOfTotal)}</td>
      <td className={`${STD_EDGE} px-2 py-1 text-right text-xs text-sdc-navy`}>{currency(grand.standardFees)}</td>
      <td className={`${STD_EDGE} px-2 py-1 text-right text-xs text-sdc-navy`}>
        {grand.contingencyAmount ? currency(grand.contingencyAmount) : "—"}
      </td>
      <td className={`${STD_EDGE} px-2 py-1 text-right text-xs font-semibold text-sdc-navy`}>{currency(grand.totalStandardFees)}</td>
      <td className={`${STD_EDGE} px-2 py-1`} />
    </>
  );
}
