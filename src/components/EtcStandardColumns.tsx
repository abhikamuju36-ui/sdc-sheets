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
export type StandardRates = { engrRate: number; shopRate: number; partsMarkup: number };

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

type Ctx = {
  getComputed: (jobId: number) => StandardComputed | undefined;
  getGrandTotals: () => StandardGrandTotals;
  editable: boolean;
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
  poolTotals,
  contingencyRate,
  frozenRows,
  editable = false,
  children,
}: {
  jobs: StandardJobBase[];
  rates: StandardRates;
  poolTotals: PoolTotals;
  contingencyRate: number;
  frozenRows?: FrozenStandardRow[];
  editable?: boolean;
  children: React.ReactNode;
}) {
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

  const ctx: Ctx = { getComputed: (jobId) => computedByJob.get(jobId), getGrandTotals: () => grandTotals, editable };
  return <StandardRatesCtx.Provider value={ctx}>{children}</StandardRatesCtx.Provider>;
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
