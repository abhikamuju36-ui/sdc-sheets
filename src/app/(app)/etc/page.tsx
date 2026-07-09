import { Fragment } from "react";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { compareJobIds } from "@/lib/job-filters";
import { getEtcMonthJobWhere } from "@/lib/etc-month-jobs";
import { EtcDraftInput } from "@/components/EtcDraftInput";
import { ETC_SECTIONS, PARTS_COST_SECTION } from "@/lib/sections";
import { calcHoursLeft, suggestNewEtc, isMonthLocked, nextMonth } from "@/lib/etc";
import { submitMonth, reopenMonth, clearMonth, syncPowerBiForEtc, syncEtcHistory } from "@/lib/etc-actions";
import { isStandardSheetUnlocked, hadWrongPassword, unlockStandardSheet, lockStandardSheet } from "@/lib/standard-sheet-gate";
import { getExecutionEtcByJob } from "@/lib/execution-etc";
import {
  calcTotalEtcDollars,
  calcPercentOfTotal,
  calcStandardFeeEngineering,
  calcStandardFeeShop,
  calcTotalStandardFees,
} from "@/lib/standard-fees";
import { PageTitle } from "@/components/ui/Typography";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { MonthYearSelect } from "@/components/MonthYearSelect";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, TABLE_HEADER_ROW, TABLE_GRID } from "@/components/ui/classnames";

// Matches the real "Managers Fill Out" sheet's column shape exactly — every
// department block has these same 5 columns; Parts Cost and the Total rollup
// use the sheet's own label variants.
const SUB_COLUMNS = ["Prior ETC", "Hours Worked Month", "Hours Left", "New ETC", "Diff"] as const;
const PARTS_COST_SUB_COLUMNS = ["Prior ETC", "Money Spent Month", "Money Left", "New ETC", "Diff"] as const;
const TOTAL_SUB_COLUMNS = ["Prior ETC", "Hours Worked", "Hours Left", "Total New ETC", "Diff"] as const;

// The sheet's 5-level header above the column labels: Phase -> billing group
// (Engineering/Shop) -> sub-group (ME / CE / General Engineering / dept
// abbreviations) -> colored section cell. Counts are in sections (x5 columns
// each) and must line up with ETC_SECTIONS' order. Display-only — internal
// section names/phases in sections.ts are unchanged.
const ETC_HEADER_PHASES = [
  { label: "Complete Design and Build", sections: 9 },
  { label: "Testing", sections: 2 },
  { label: "Teardown and Install", sections: 2 },
] as const;
const ETC_HEADER_GROUPS = [
  { label: "Engineering", sections: 7 },
  { label: "Shop", sections: 2 },
  { label: "Engineering", sections: 1 },
  { label: "Shop", sections: 1 },
  { label: "Engineering", sections: 1 },
  { label: "Shop", sections: 1 },
] as const;
const ETC_HEADER_SUBGROUPS = [
  { label: "ME", sections: 1 },
  { label: "CE", sections: 2 },
  { label: "General Engineering", sections: 4 },
  { label: "Shop", sections: 2 },
  { label: "ME & CE & GE", sections: 1 },
  { label: "MB & EB", sections: 1 },
  { label: "ME & CE & GE", sections: 1 },
  { label: "MB & EB", sections: 1 },
] as const;

// Colored section-cell labels, exactly as the sheet prints them (no "CE"
// prefixes; Testing/Teardown show "All"/"Total" rather than section names).
const ETC_SECTION_DISPLAY: Record<string, string> = {
  "10-211": "ME General",
  "10-312": "Design and Drawings",
  "10-313": "Software",
  "10-515": "HMI",
  "10-516": "Robot",
  "10-517": "Vision",
  "10-518": "Database and Device",
  "10-411": "Mechanical Build",
  "10-412": "Electrical Build",
  "40-211": "All",
  "40-411": "Total",
  "50-211": "All",
  "50-411": "Total",
};

// Department header colors, matching the real "Managers Fill Out" sheet's
// column banding (ME = blue, CE = green, general engineering = teal, shop =
// tan). Machine Testing/Teardown & Install swap in their own Engineering/Shop
// tint (40-211/50-211 = Engineering, 40-411/50-411 = Shop) since those phases
// have no per-department breakdown, just the two billing groups.
const SECTION_HEADER_COLOR: Record<string, string> = {
  "10-211": "bg-[#81ACEE] text-sdc-navy",
  "10-312": "bg-[#9FD77F] text-sdc-navy",
  "10-313": "bg-[#9FD77F] text-sdc-navy",
  "10-515": "bg-[#97E4E6] text-sdc-navy",
  "10-516": "bg-[#97E4E6] text-sdc-navy",
  "10-517": "bg-[#97E4E6] text-sdc-navy",
  "10-518": "bg-[#97E4E6] text-sdc-navy",
  "10-411": "bg-[#E6AC89] text-sdc-navy",
  "10-412": "bg-[#E6AC89] text-sdc-navy",
  "40-211": "bg-[#D1ECF9] text-sdc-navy",
  "50-211": "bg-[#D1ECF9] text-sdc-navy",
  "40-411": "bg-[#E6AC89] text-sdc-navy",
  "50-411": "bg-[#E6AC89] text-sdc-navy",
};

const SECTION_HEADER_COLOR_LIGHT: Record<string, string> = {
  "10-211": "bg-[#81ACEE]/15",
  "10-312": "bg-[#9FD77F]/15",
  "10-313": "bg-[#9FD77F]/15",
  "10-515": "bg-[#97E4E6]/15",
  "10-516": "bg-[#97E4E6]/15",
  "10-517": "bg-[#97E4E6]/15",
  "10-518": "bg-[#97E4E6]/15",
  "10-411": "bg-[#E6AC89]/15",
  "10-412": "bg-[#E6AC89]/15",
  "40-211": "bg-[#D1ECF9]/15",
  "50-211": "bg-[#D1ECF9]/15",
  "40-411": "bg-[#E6AC89]/15",
  "50-411": "bg-[#E6AC89]/15",
};

// Column-identity backgrounds for the 5-column block shared by every
// department/Parts Cost/Engineering/Shop group, matching the real sheet.
const HOURS_WORKED_BG = "bg-[#C7DAF7]";
const HOURS_LEFT_BG = "bg-[#F1F6FD]";
function newEtcBg(hasValue: boolean) {
  return hasValue ? "bg-[#F2F2F2]" : "bg-[#FAFAC4]";
}
function diffBg(diff: number) {
  if (diff === 0) return "bg-white";
  return diff < 0 ? "bg-[#EEADAC]" : "bg-[#9FCE62]";
}

// Hours/cost display on this page is whole numbers — no decimals, rounded
// rather than truncated. Use this for any value added here later too.
function wholeNum(n: number): string {
  return Math.round(n).toString();
}

// Header cells have no row value, so "New ETC"/"Diff" fall back to a neutral
// flat shade rather than the value-conditional colors used in the body.
function subColHeaderBg(col: string): string {
  if (col === "Prior ETC") return "bg-[#5E91D3] text-white";
  if (col === "Hours Worked Month" || col === "Hours Worked" || col === "Money Spent Month") return HOURS_WORKED_BG;
  if (col === "Hours Left" || col === "Money Left") return HOURS_LEFT_BG;
  if (col === "New ETC" || col === "Total New ETC") return "bg-[#F2F2F2]";
  return "";
}

// Same column-identity backgrounds, without a text-color opinion — for cells
// (like the "—" empty-section placeholder) that set their own text color.
function subColBodyBg(col: string): string {
  if (col === "Hours Worked Month" || col === "Hours Worked" || col === "Money Spent Month") return HOURS_WORKED_BG;
  if (col === "Hours Left" || col === "Money Left") return HOURS_LEFT_BG;
  if (col === "New ETC" || col === "Total New ETC") return "bg-[#F2F2F2]";
  if (col === "Diff") return "bg-white";
  return "";
}

function currency(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function percent(n: number) {
  return (n * 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "%";
}

// The Standard Sheet columns appended to the grid once unlocked, in the order
// they print on that page — Execution Rates, Execution ETC (New ETC), Total
// ETC, the merged Standard Fees (Engineering + Shop as one), Contingency,
// Total Standard Fees, Notes. Display-only here (editing lives on /standard-sheet).
const STANDARD_LEAF_COLUMNS = [
  "ENGR", "Shop", "Parts",
  "Eng ETC", "Shop ETC", "Parts ETC",
  "Total ETC", "% Total",
  "Standard Fees",
  "Contingency",
  "Total Std Fees",
  "Notes",
] as const;
// Marks the left edge of the whole Standard block so it reads as a distinct
// section bolted onto the ETC grid.
const STD_EDGE = "border-l-2 border-l-sdc-navy";

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default async function MonthlyEtcPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;

  const distinctMonths = await prisma.etcEntry.findMany({
    distinct: ["month"],
    select: { month: true },
    orderBy: { month: "desc" },
  });
  const month = monthParam || distinctMonths[0]?.month || currentMonth();

  // A month is locked when it has entries and none still need review — months
  // with any pending entry are "in progress"; the rest of the history is locked.
  const inProgressMonths = await prisma.etcEntry.groupBy({
    by: ["month"],
    where: { needsReview: true },
  });
  const inProgressSet = new Set(inProgressMonths.map((m) => m.month));
  const lockedMonthList = distinctMonths.map((m) => m.month).filter((m) => !inProgressSet.has(m));

  // Once the latest month is locked, the only seedable month is the next one —
  // surface it in the picker so it can actually be started.
  const latestMonth = distinctMonths[0]?.month;
  const nextStartable = latestMonth && !inProgressSet.has(latestMonth) ? nextMonth(latestMonth) : undefined;

  // Which jobs the grid shows depends on whether the month is history:
  // - A locked month is a frozen snapshot — show exactly the jobs that have
  //   entries in it (Power BI parity), regardless of what their status is
  //   TODAY. Filtering by current status hides every job completed since,
  //   which made historical months show far fewer jobs than the source report.
  // - An in-progress (or not-yet-started) month keeps etcActiveJobFilter —
  //   the same universe seeding/pruning/submission operate on, which must
  //   stay in lockstep with the grid.
  // Single source of truth for the month's job universe — the Standard Sheet
  // reads from the exact same helper, so the two pages can never drift on which
  // projects a month contains.
  const { where: monthJobWhere, monthIsLocked } = await getEtcMonthJobWhere(month);

  const [jobs, session, lastPowerBiSync, hoursActualFreshness] = await Promise.all([
    prisma.job.findMany({
      where: monthJobWhere,
      include: { etcEntries: { where: { month } }, executionRate: true },
    }),
    auth(),
    prisma.jobMonthlyActualHours.findFirst({ orderBy: { syncedAt: "desc" }, select: { syncedAt: true } }),
    prisma.powerBiFreshness.findUnique({ where: { source: "hours_actual" }, select: { refreshedThrough: true } }),
  ]);
  const role = (session?.user as { role?: string } | undefined)?.role;

  // Numeric Job Id order like the sheet (979 before 1020 before 10000) — the
  // column is a string, so the DB's own sort is lexicographic.
  jobs.sort((a, b) => compareJobIds(a.jobId, b.jobId));

  // Standard Sheet columns, shown inline only once the password gate is
  // unlocked (same cookie the /standard-sheet tab uses). Numbers mirror that
  // page exactly for this month, scoped to the jobs this grid renders — the
  // % Total denominator is the grand Total ETC $ across those same rows.
  const showStandards = await isStandardSheetUnlocked();
  const standardWrongPassword = showStandards ? false : await hadWrongPassword();

  type StandardRow = {
    engrRate: number;
    shopRate: number;
    partsMarkup: number;
    etcEngineering: number;
    etcShop: number;
    etcParts: number;
    totalEtcDollars: number;
    percentOfTotal: number;
    standardFees: number;
    contingencyAmount: number;
    totalStandardFees: number;
    notes: string;
  };
  const standardByJob = new Map<number, StandardRow>();
  const standardGrand = {
    totalEtcDollars: 0,
    percentOfTotal: 0,
    standardFees: 0,
    contingencyAmount: 0,
    totalStandardFees: 0,
  };

  if (showStandards) {
    const [execEtcByJob, pools, setting] = await Promise.all([
      getExecutionEtcByJob(jobs.map((j) => j.id), month),
      prisma.categoryPool.findMany({ where: { month } }),
      prisma.standardSheetSetting.findUnique({ where: { id: 1 } }),
    ]);
    const contingencyRate = setting ? Number(setting.contingencyRate) : 1.2;
    const poolTotals = {
      engineeringPM: Number(pools.find((p) => p.category === "ENGINEERING_PM")?.standardFee ?? 0),
      engineeringWarranty: Number(pools.find((p) => p.category === "ENGINEERING_WARRANTY")?.standardFee ?? 0),
      shopManufacturing: Number(pools.find((p) => p.category === "SHOP_MANUFACTURING")?.standardFee ?? 0),
      shopWarranty: Number(pools.find((p) => p.category === "SHOP_WARRANTY")?.standardFee ?? 0),
    };

    const base = jobs.map((job) => {
      const etc = execEtcByJob.get(job.id) ?? { engineering: 0, shop: 0, parts: 0 };
      const rate = {
        engrRate: job.executionRate ? Number(job.executionRate.engrRate) : 170,
        shopRate: job.executionRate ? Number(job.executionRate.shopRate) : 140,
        partsMarkup: job.executionRate ? Number(job.executionRate.partsMarkup) : 1.2,
      };
      return { job, etc, rate, totalEtcDollars: calcTotalEtcDollars(etc, rate) };
    });
    const grandTotal = base.reduce((sum, r) => sum + r.totalEtcDollars, 0);

    for (const { job, etc, rate, totalEtcDollars } of base) {
      const percentOfTotal = calcPercentOfTotal(totalEtcDollars, grandTotal);
      const standardFees =
        calcStandardFeeEngineering(percentOfTotal, poolTotals) + calcStandardFeeShop(percentOfTotal, poolTotals);
      const contingencyAmount = job.executionRate ? Number(job.executionRate.contingencyAmount) : 0;
      const totalStandardFees = calcTotalStandardFees(
        totalEtcDollars,
        calcStandardFeeEngineering(percentOfTotal, poolTotals),
        calcStandardFeeShop(percentOfTotal, poolTotals),
        contingencyAmount,
        contingencyRate,
      );
      standardByJob.set(job.id, {
        engrRate: rate.engrRate,
        shopRate: rate.shopRate,
        partsMarkup: rate.partsMarkup,
        etcEngineering: etc.engineering,
        etcShop: etc.shop,
        etcParts: etc.parts,
        totalEtcDollars,
        percentOfTotal,
        standardFees,
        contingencyAmount,
        totalStandardFees,
        notes: job.executionRate?.notes ?? "",
      });
      standardGrand.totalEtcDollars += totalEtcDollars;
      standardGrand.percentOfTotal += percentOfTotal;
      standardGrand.standardFees += standardFees;
      standardGrand.contingencyAmount += contingencyAmount;
      standardGrand.totalStandardFees += totalStandardFees;
    }
  }

  const allEntries = jobs.flatMap((j) => j.etcEntries);
  const started = allEntries.length > 0;
  const locked = isMonthLocked(allEntries);
  const needsReviewCount = allEntries.filter((e) => e.needsReview).length;

  // Grand totals footer, matching the real sheet's row 63 — accumulated as
  // each job row below computes its own values, then rendered once after.
  const sectionGrandTotals = new Map(ETC_SECTIONS.map((s) => [s.code, { prior: 0, worked: 0, newEtc: 0 }]));
  const groupGrandTotals = { Engineering: { prior: 0, worked: 0, newEtc: 0 }, Shop: { prior: 0, worked: 0, newEtc: 0 } };
  const partsCostGrandTotal = { prior: 0, worked: 0, newEtc: 0 };

  return (
    <div className="w-full p-8">
      <PageTitle className="mb-1">Monthly ETC</PageTitle>
      <p className="mb-4 text-sm text-sdc-gray-600">
        {`${jobs.length} ${monthIsLocked ? "job" : "active job"}${jobs.length === 1 ? "" : "s"} — replaces the "Managers Fill Out" sheet.`}
      </p>

      {/* One toolbar: pick the month/year, Run Report pulls everything from
          Power BI for it, then enter/confirm and Submit and Lock. */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-sdc-gray-500">Report for:</span>
        <MonthYearSelect
          months={distinctMonths.map((m) => m.month)}
          current={month}
          lockedMonths={lockedMonthList}
          nextStartable={nextStartable}
        />
        {!locked && (
          <form action={syncPowerBiForEtc.bind(null, month)}>
            <button type="submit" className={BUTTON_PRIMARY}>
              Run Report
            </button>
          </form>
        )}
        {started && !locked && (
          <form action={clearMonth.bind(null, month)}>
            <button type="submit" className={BUTTON_SECONDARY}>
              Clear ETC
            </button>
          </form>
        )}
        {started && !locked && jobs.length > 0 && (
          <button type="submit" form="etc-month-form" className={BUTTON_SECONDARY}>
            Submit and Lock
          </button>
        )}
        {locked && role === "ADMIN" && (
          <form action={reopenMonth.bind(null, month)}>
            <button type="submit" className={BUTTON_SECONDARY}>
              Reopen for editing
            </button>
          </form>
        )}
        <form action={syncEtcHistory} title="Re-pull all past months from Power BI's ETC Historical measures. Months submitted in this app are never overwritten.">
          <button type="submit" className={BUTTON_SECONDARY}>
            Sync History
          </button>
        </form>
        {/* Password-gated Standard Sheet columns (Dan/Lisa only) — same
            unlock cookie as the /standard-sheet tab. */}
        {showStandards ? (
          <form action={lockStandardSheet}>
            <button type="submit" className={BUTTON_SECONDARY}>
              Hide Standards
            </button>
          </form>
        ) : (
          <form action={unlockStandardSheet} className="flex items-center gap-2">
            <input
              type="password"
              name="password"
              placeholder="Password"
              aria-label="Standard Sheet password"
              className="w-32 rounded-md border border-sdc-border px-2 py-1.5 text-sm outline-none focus:border-sdc-blue"
            />
            <button type="submit" className={BUTTON_SECONDARY} title="Show the Standard Sheet columns for this month (requires password).">
              Show Standards
            </button>
            {standardWrongPassword && <span className="text-xs text-red-600">Wrong password</span>}
          </form>
        )}
        <StatusBadge variant={!started ? "notStarted" : locked ? "locked" : "needsReview"}>
          {!started ? "Not started" : locked ? "Locked (submitted)" : `In progress — ${needsReviewCount} pending`}
        </StatusBadge>
        <span className="text-xs text-sdc-gray-400">
          {lastPowerBiSync?.syncedAt
            ? `Last synced: ${lastPowerBiSync.syncedAt.toISOString().slice(0, 16).replace("T", " ")}`
            : "Never synced"}
          {hoursActualFreshness?.refreshedThrough && (
            <> · Hours Refreshed Thru: {hoursActualFreshness.refreshedThrough.toISOString().slice(0, 10)}</>
          )}
          {distinctMonths.length === 0 && <> · no ETC history yet</>}
        </span>
      </div>

      <p className="mb-4 text-xs text-sdc-gray-400">
        {!started
          ? `"Run Report" starts ${month}: it seeds the job rows and pulls the latest hours from Power BI, just like the sheet.`
          : locked
            ? `${month} is submitted and locked — these numbers are frozen exactly as submitted. Pick a month above to view any past submission.`
            : `"Run Report" pulls the latest numbers from Power BI for the selected month. Enter Hours Worked, confirm or override each New ETC (suggestion shown in yellow), then Submit and Lock. "Clear ETC" resets New ETC values back to the suggestion (Hours Worked untouched).`}
      </p>

      {started && (
        <form id="etc-month-form" action={submitMonth.bind(null, month)}>
          <div className="max-h-[calc(100vh-260px)] min-w-[480px] overflow-auto border border-sdc-border bg-white shadow-sm select-none styled-scrollbar">
            <table className={`w-full text-sm ${TABLE_GRID}`}>
              <thead className="sticky top-0 z-20 bg-sdc-gray-100">
                <tr className={TABLE_HEADER_ROW}>
                  <th rowSpan={5} className="sticky left-0 z-10 w-10 min-w-10 bg-sdc-gray-100 px-2 py-3 text-center align-bottom">
                    #
                  </th>
                  <th rowSpan={5} className="sticky left-10 z-10 w-20 min-w-20 bg-sdc-gray-100 px-3 py-3 align-bottom">
                    Job Id
                  </th>
                  <th rowSpan={5} className="sticky left-[120px] z-10 bg-sdc-gray-100 px-3 py-3 align-bottom">Job Name</th>
                  {ETC_HEADER_PHASES.map((p, i) => (
                    <th key={p.label + i} colSpan={p.sections * SUB_COLUMNS.length} className="border-l border-sdc-border px-3 py-1.5 text-center">
                      {p.label}
                    </th>
                  ))}
                  <th colSpan={PARTS_COST_SUB_COLUMNS.length} className="border-l border-sdc-border bg-sdc-gray-100 px-3 py-1.5 text-center text-sdc-gray-700">
                    Parts Cost
                  </th>
                  <th colSpan={2 * TOTAL_SUB_COLUMNS.length} className="border-l border-sdc-border bg-[#FDFDE3] px-3 py-1.5 text-center text-sdc-navy">
                    Total (New ETC)
                  </th>
                  {showStandards && (
                    <th
                      rowSpan={4}
                      colSpan={STANDARD_LEAF_COLUMNS.length}
                      className={`${STD_EDGE} bg-[#D6E4F0] px-3 py-1.5 text-center align-middle text-sdc-blue-dark`}
                    >
                      Standard Sheet
                    </th>
                  )}
                </tr>
                {/* Billing-group row: Engineering / Shop per phase, like the sheet. */}
                <tr className={TABLE_HEADER_ROW}>
                  {ETC_HEADER_GROUPS.map((g, i) => (
                    <th key={g.label + i} colSpan={g.sections * SUB_COLUMNS.length} className="border-l border-sdc-border px-2 py-1 text-center font-medium">
                      {g.label}
                    </th>
                  ))}
                  {/* Parts Cost has no Engineering/Shop split — one green Total
                      block spanning down to the column-label row, as printed. */}
                  <th rowSpan={3} colSpan={PARTS_COST_SUB_COLUMNS.length} className="border-l border-sdc-border bg-[#00B050] px-2 py-1 text-center text-white">
                    Total
                  </th>
                  <th colSpan={TOTAL_SUB_COLUMNS.length} className="border-l border-sdc-border bg-[#FDFDE3] px-2 py-1 text-center font-medium text-sdc-navy">
                    Engineering
                  </th>
                  <th colSpan={TOTAL_SUB_COLUMNS.length} className="border-l border-sdc-border bg-[#FDFDE3] px-2 py-1 text-center font-medium text-sdc-navy">
                    Shop
                  </th>
                </tr>
                {/* Sub-group row: ME / CE / General Engineering / dept abbreviations. */}
                <tr className={TABLE_HEADER_ROW}>
                  {ETC_HEADER_SUBGROUPS.map((g, i) => (
                    <th key={g.label + i} colSpan={g.sections * SUB_COLUMNS.length} className="border-l border-sdc-border px-2 py-1 text-center font-medium">
                      {g.label}
                    </th>
                  ))}
                  <th colSpan={TOTAL_SUB_COLUMNS.length} className="border-l border-sdc-border bg-[#FDFDE3] px-2 py-1 text-center font-medium text-sdc-navy">
                    ME &amp; CE &amp; GE
                  </th>
                  <th colSpan={TOTAL_SUB_COLUMNS.length} className="border-l border-sdc-border bg-[#FDFDE3] px-2 py-1 text-center font-medium text-sdc-navy">
                    MB &amp; EB
                  </th>
                </tr>
                {/* Colored section row, labels exactly as the sheet prints them. */}
                <tr className={TABLE_HEADER_ROW}>
                  {ETC_SECTIONS.map((s) => {
                    const color = SECTION_HEADER_COLOR[s.code];
                    return (
                      <th
                        key={s.code}
                        title={`${s.name} (${s.code})`}
                        colSpan={SUB_COLUMNS.length}
                        className={`border-l border-sdc-border px-2 py-1 text-center ${color ?? ""}`}
                      >
                        {ETC_SECTION_DISPLAY[s.code] ?? s.name}
                      </th>
                    );
                  })}
                  <th colSpan={TOTAL_SUB_COLUMNS.length} className="border-l border-sdc-border bg-[#D1ECF9] px-2 py-1 text-center text-sdc-navy">
                    All
                  </th>
                  <th colSpan={TOTAL_SUB_COLUMNS.length} className="border-l border-sdc-border bg-[#E6AC89] px-2 py-1 text-center text-sdc-navy">
                    All
                  </th>
                </tr>
                <tr className={TABLE_HEADER_ROW}>
                  {ETC_SECTIONS.map((s) =>
                    SUB_COLUMNS.map((col) => (
                      <th
                        key={`${s.code}-${col}`}
                        className={`border-l border-sdc-border px-1 py-1.5 text-right text-[10px] ${
                          subColHeaderBg(col) || SECTION_HEADER_COLOR_LIGHT[s.code] || ""
                        }`}
                      >
                        {col}
                      </th>
                    ))
                  )}
                  {PARTS_COST_SUB_COLUMNS.map((col) => (
                    <th
                      key={`parts-cost-${col}`}
                      className={`border-l border-sdc-border px-1 py-1.5 text-right text-[10px] ${
                        subColHeaderBg(col) || "bg-sdc-gray-100 text-sdc-gray-700"
                      }`}
                    >
                      {col}
                    </th>
                  ))}
                  {(["Engineering", "Shop"] as const).map((group) =>
                    TOTAL_SUB_COLUMNS.map((col) => (
                      <th
                        key={`${group}-${col}`}
                        className={`border-l border-sdc-border px-1 py-1.5 text-right text-[10px] ${
                          subColHeaderBg(col) || "bg-[#FDFDE3] text-sdc-navy"
                        }`}
                      >
                        {col}
                      </th>
                    ))
                  )}
                  {showStandards &&
                    STANDARD_LEAF_COLUMNS.map((col, i) => (
                      <th
                        key={`std-${col}`}
                        className={`${i === 0 ? STD_EDGE : "border-l border-sdc-border"} bg-[#D6E4F0]/60 px-1 py-1.5 text-right text-[10px] text-sdc-blue-dark`}
                      >
                        {col}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map((job, jobIndex) => {
                  const entryByCode = new Map(job.etcEntries.map((e) => [e.section, e]));
                  const zebra = jobIndex % 2 === 1 ? "bg-sdc-gray-50/60" : "";
                  // Sticky columns need a fully opaque background — the translucent
                  // zebra tint above lets scrolled-under columns bleed through them.
                  const zebraSticky = jobIndex % 2 === 1 ? "bg-sdc-gray-50" : "bg-white";

                  // Effective New ETC: confirmed value once submitted; before
                  // that, the manager's autosaved draft if any, else the
                  // system suggestion.
                  const effectiveNewEtc = (entry: (typeof job.etcEntries)[number]): number => {
                    if (!entry.needsReview) return Number(entry.newEtc);
                    if (entry.newEtcDraft != null) return Number(entry.newEtcDraft);
                    return suggestNewEtc(Number(entry.priorEtc), Number(entry.hoursWorked));
                  };

                  // "Total (New ETC)" — a pure rollup, confirmed from the real sheet's
                  // formulas (SUM of the Engineering blocks' Prior/Worked/New ETC,
                  // separately for Shop) — not a manager-entered value.
                  const totals = { Engineering: { prior: 0, worked: 0, newEtc: 0 }, Shop: { prior: 0, worked: 0, newEtc: 0 } };
                  for (const s of ETC_SECTIONS) {
                    const entry = entryByCode.get(s.code);
                    if (!entry) continue;
                    totals[s.billingGroup].prior += Number(entry.priorEtc);
                    totals[s.billingGroup].worked += Number(entry.hoursWorked);
                    totals[s.billingGroup].newEtc += effectiveNewEtc(entry);
                  }

                  return (
                    <tr key={job.id} className={`hover:bg-sdc-blue-light/40 ${zebra}`}>
                      <td className={`sticky left-0 z-10 w-10 min-w-10 px-2 py-1 text-center text-sdc-gray-400 ${zebraSticky}`}>{jobIndex + 1}</td>
                      <td className={`sticky left-10 z-10 w-20 min-w-20 px-3 py-1 font-mono text-sdc-gray-400 ${zebraSticky}`}>{job.jobId}</td>
                      <td
                        className={`sticky left-[120px] z-10 min-w-[260px] whitespace-nowrap px-3 py-1 font-medium text-sdc-navy ${zebraSticky}`}
                        title={job.jobName}
                      >
                        {job.jobName}
                      </td>
                      {ETC_SECTIONS.map((s) => {
                        const entry = entryByCode.get(s.code);
                        if (!entry) {
                          return SUB_COLUMNS.map((col) => (
                            <td
                              key={`${s.code}-${col}`}
                              className={`border-l border-sdc-border px-2 py-1 text-center ${
                                col === "Prior ETC" ? "bg-[#5E91D3] text-white" : `${subColBodyBg(col)} text-sdc-gray-400`
                              }`}
                            >
                              —
                            </td>
                          ));
                        }
                        const prior = Number(entry.priorEtc);
                        const worked = Number(entry.hoursWorked);
                        const hoursLeft = calcHoursLeft(prior, worked);
                        const suggested = suggestNewEtc(prior, worked);
                        const draft = entry.newEtcDraft != null ? Number(entry.newEtcDraft) : null;
                        const effective = effectiveNewEtc(entry);
                        const diff = hoursLeft - effective;
                        // Deterministic carry-forward or a saved draft both count as "decided".
                        const decided = worked === 0 || draft != null;

                        const sectionTotal = sectionGrandTotals.get(s.code)!;
                        sectionTotal.prior += prior;
                        sectionTotal.worked += worked;
                        sectionTotal.newEtc += effective;

                        return (
                          <Fragment key={s.code}>
                            <td className="border-l border-sdc-border bg-[#5E91D3] px-1 py-1 text-right text-xs text-white">
                              {wholeNum(prior)}
                            </td>
                            <td className={`border-l border-sdc-border ${HOURS_WORKED_BG} px-1 py-1`}>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                name={`hoursWorked__${entry.id}`}
                                defaultValue={wholeNum(worked)}
                                disabled={locked}
                                aria-label={`Hours worked, ${job.jobName}, ${s.name}`}
                                className="w-12 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-right text-xs outline-none focus:border-sdc-blue focus:bg-white focus:shadow-sm disabled:text-sdc-gray-400"
                              />
                            </td>
                            <td className={`border-l border-sdc-border ${HOURS_LEFT_BG} px-1 py-1 text-right text-xs text-sdc-gray-500`}>
                              {wholeNum(hoursLeft)}
                            </td>
                            <td className={`border-l border-sdc-border ${newEtcBg(decided)} px-1 py-1`}>
                              {/* No hours worked -> carry-forward is deterministic, safe to auto-fill.
                                  Hours worked > 0 -> a manager's judgment call, not auto-filled;
                                  flagged yellow so it's obviously not done yet. Typed values
                                  autosave on blur so a Refresh can't wipe them. */}
                              <EtcDraftInput
                                entryId={entry.id}
                                name={`newEtcOverride__${entry.id}`}
                                defaultValue={draft != null ? String(draft) : worked === 0 ? wholeNum(suggested) : undefined}
                                placeholder={worked === 0 || draft != null ? undefined : wholeNum(suggested)}
                                disabled={locked}
                                ariaLabel={`New ETC override, ${job.jobName}, ${s.name}`}
                                className={`w-12 [appearance:textfield] rounded-md border-none bg-transparent px-1.5 py-1 text-right text-xs outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:bg-white focus:shadow-sm ${
                                  decided ? "text-sdc-gray-600" : "text-sdc-yellow-text placeholder:text-sdc-yellow-text/60"
                                }`}
                              />
                            </td>
                            <td className={`border-l border-sdc-border ${diffBg(diff)} px-1 py-1 text-right text-xs text-sdc-gray-700`}>
                              {wholeNum(diff)}
                            </td>
                          </Fragment>
                        );
                      })}
                      {(() => {
                        const partsCostEntry = entryByCode.get(PARTS_COST_SECTION);
                        if (!partsCostEntry) {
                          return PARTS_COST_SUB_COLUMNS.map((col) => (
                            <td
                              key={`parts-cost-${col}`}
                              className={`border-l border-sdc-border px-2 py-1 text-center text-sdc-gray-400 ${
                                col === "Prior ETC" ? "bg-[#5E91D3] text-white" : subColBodyBg(col) || "bg-sdc-gray-50"
                              }`}
                            >
                              —
                            </td>
                          ));
                        }
                        const prior = Number(partsCostEntry.priorEtc);
                        const spent = Number(partsCostEntry.hoursWorked);
                        const moneyLeft = calcHoursLeft(prior, spent);
                        const suggestedCost = suggestNewEtc(prior, spent);
                        const draftCost = partsCostEntry.newEtcDraft != null ? Number(partsCostEntry.newEtcDraft) : null;
                        const effectiveNewEtcCost = effectiveNewEtc(partsCostEntry);
                        const diffCost = moneyLeft - effectiveNewEtcCost;
                        const decidedCost = spent === 0 || draftCost != null;

                        partsCostGrandTotal.prior += prior;
                        partsCostGrandTotal.worked += spent;
                        partsCostGrandTotal.newEtc += effectiveNewEtcCost;

                        return (
                          <Fragment key="parts-cost">
                            <td className="border-l border-sdc-border bg-[#5E91D3] px-1 py-1 text-right text-xs text-white">
                              {currency(prior)}
                            </td>
                            <td className={`border-l border-sdc-border ${HOURS_WORKED_BG} px-1 py-1`}>
                              {/* Not manager-editable — always Power BI's actual, passed through as a
                                  hidden field so submitMonth's generic per-entry loop still works. */}
                              <input type="hidden" name={`hoursWorked__${partsCostEntry.id}`} value={spent} />
                              <span className="block w-16 truncate text-right text-xs text-sdc-gray-600" title={currency(spent)}>
                                {currency(spent)}
                              </span>
                            </td>
                            <td className={`border-l border-sdc-border ${HOURS_LEFT_BG} px-1 py-1 text-right text-xs text-sdc-gray-500`}>
                              {currency(moneyLeft)}
                            </td>
                            <td className={`border-l border-sdc-border ${newEtcBg(decidedCost)} px-1 py-1`}>
                              <EtcDraftInput
                                entryId={partsCostEntry.id}
                                name={`newEtcOverride__${partsCostEntry.id}`}
                                defaultValue={draftCost != null ? String(draftCost) : spent === 0 ? wholeNum(suggestedCost) : undefined}
                                placeholder={spent === 0 || draftCost != null ? undefined : wholeNum(suggestedCost)}
                                disabled={locked}
                                ariaLabel={`New ETC cost override, ${job.jobName}, Parts Cost`}
                                className={`w-16 [appearance:textfield] rounded-md border-none bg-transparent px-1.5 py-1 text-right text-xs outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:bg-white focus:shadow-sm ${
                                  decidedCost ? "text-sdc-gray-600" : "text-sdc-yellow-text placeholder:text-sdc-yellow-text/60"
                                }`}
                              />
                            </td>
                            <td className={`border-l border-sdc-border ${diffBg(diffCost)} px-1 py-1 text-right text-xs text-sdc-gray-700`}>
                              {currency(diffCost)}
                            </td>
                          </Fragment>
                        );
                      })()}
                      {(["Engineering", "Shop"] as const).map((group) => {
                        const hoursLeft = totals[group].prior - totals[group].worked;
                        const diff = hoursLeft - totals[group].newEtc;
                        groupGrandTotals[group].prior += totals[group].prior;
                        groupGrandTotals[group].worked += totals[group].worked;
                        groupGrandTotals[group].newEtc += totals[group].newEtc;
                        return (
                          <Fragment key={group}>
                            <td className="border-l border-sdc-border bg-[#5E91D3] px-1 py-1 text-right text-xs text-white">
                              {wholeNum(totals[group].prior)}
                            </td>
                            <td className={`border-l border-sdc-border ${HOURS_WORKED_BG} px-1 py-1 text-right text-xs text-sdc-gray-500`}>
                              {wholeNum(totals[group].worked)}
                            </td>
                            <td className={`border-l border-sdc-border ${HOURS_LEFT_BG} px-1 py-1 text-right text-xs text-sdc-gray-500`}>
                              {wholeNum(hoursLeft)}
                            </td>
                            <td className={`border-l border-sdc-border ${newEtcBg(true)} px-1 py-1 text-right text-xs font-medium text-sdc-navy`}>
                              {wholeNum(totals[group].newEtc)}
                            </td>
                            <td className={`border-l border-sdc-border ${diffBg(diff)} px-1 py-1 text-right text-xs text-sdc-gray-700`}>
                              {wholeNum(diff)}
                            </td>
                          </Fragment>
                        );
                      })}
                      {showStandards &&
                        (() => {
                          const std = standardByJob.get(job.id);
                          if (!std) return null;
                          const cell = (edge: boolean) =>
                            `${edge ? STD_EDGE : "border-l border-sdc-border"} px-2 py-1 text-right text-xs text-sdc-navy`;
                          return (
                            <Fragment key="standards">
                              <td className={cell(true)}>{wholeNum(std.engrRate)}</td>
                              <td className={cell(false)}>{wholeNum(std.shopRate)}</td>
                              <td className={cell(false)}>{std.partsMarkup}</td>
                              <td className={`${cell(false)} bg-sdc-blue-light/10`}>{wholeNum(std.etcEngineering)}</td>
                              <td className={`${cell(false)} bg-sdc-blue-light/10`}>{wholeNum(std.etcShop)}</td>
                              <td className={`${cell(false)} bg-sdc-blue-light/10`}>{currency(std.etcParts)}</td>
                              <td className={`${cell(false)} bg-sdc-gray-50`}>{currency(std.totalEtcDollars)}</td>
                              <td className={`${cell(false)} bg-sdc-gray-50`}>{percent(std.percentOfTotal)}</td>
                              <td className={`${cell(false)} bg-[#D6E4F0]/40`}>{currency(std.standardFees)}</td>
                              <td className={cell(false)}>{std.contingencyAmount ? currency(std.contingencyAmount) : "—"}</td>
                              <td className={`${cell(false)} bg-sdc-yellow-bg/60 font-medium`}>{currency(std.totalStandardFees)}</td>
                              <td className={`border-l border-sdc-border px-2 py-1 text-left text-xs text-sdc-gray-500 whitespace-nowrap`} title={std.notes}>
                                {std.notes || "—"}
                              </td>
                            </Fragment>
                          );
                        })()}
                    </tr>
                  );
                })}
                {jobs.length === 0 && (
                  <tr>
                    <td
                      colSpan={
                        3 +
                        (ETC_SECTIONS.length + 2) * SUB_COLUMNS.length +
                        PARTS_COST_SUB_COLUMNS.length +
                        (showStandards ? STANDARD_LEAF_COLUMNS.length : 0)
                      }
                      className="px-4 py-5 text-sdc-gray-400"
                    >
                      No active jobs found.
                    </td>
                  </tr>
                )}
                {jobs.length > 0 && (
                  <tr className="border-t-2 border-sdc-navy bg-sdc-gray-100 font-medium">
                    <td className="sticky left-0 z-10 bg-sdc-gray-100 px-3 py-2" colSpan={3}>
                      Total
                    </td>
                    {ETC_SECTIONS.map((s) => {
                      const t = sectionGrandTotals.get(s.code)!;
                      const hoursLeft = t.prior - t.worked;
                      const diff = hoursLeft - t.newEtc;
                      return (
                        <Fragment key={s.code}>
                          <td className="border-l border-sdc-border bg-[#5E91D3] px-1 py-1 text-right text-xs text-white">{wholeNum(t.prior)}</td>
                          <td className={`border-l border-sdc-border ${HOURS_WORKED_BG} px-1 py-1 text-right text-xs text-sdc-navy`}>{wholeNum(t.worked)}</td>
                          <td className={`border-l border-sdc-border ${HOURS_LEFT_BG} px-1 py-1 text-right text-xs text-sdc-navy`}>{wholeNum(hoursLeft)}</td>
                          <td className={`border-l border-sdc-border ${newEtcBg(true)} px-1 py-1 text-right text-xs text-sdc-navy`}>{wholeNum(t.newEtc)}</td>
                          <td className={`border-l border-sdc-border ${diffBg(diff)} px-1 py-1 text-right text-xs text-sdc-gray-700`}>{wholeNum(diff)}</td>
                        </Fragment>
                      );
                    })}
                    {(() => {
                      const t = partsCostGrandTotal;
                      const moneyLeft = t.prior - t.worked;
                      const diffCost = moneyLeft - t.newEtc;
                      return (
                        <Fragment key="parts-cost-total">
                          <td className="border-l border-sdc-border bg-[#5E91D3] px-1 py-1 text-right text-xs text-white">{currency(t.prior)}</td>
                          <td className={`border-l border-sdc-border ${HOURS_WORKED_BG} px-1 py-1 text-right text-xs text-sdc-navy`}>{currency(t.worked)}</td>
                          <td className={`border-l border-sdc-border ${HOURS_LEFT_BG} px-1 py-1 text-right text-xs text-sdc-navy`}>{currency(moneyLeft)}</td>
                          <td className={`border-l border-sdc-border ${newEtcBg(true)} px-1 py-1 text-right text-xs text-sdc-navy`}>{currency(t.newEtc)}</td>
                          <td className={`border-l border-sdc-border ${diffBg(diffCost)} px-1 py-1 text-right text-xs text-sdc-gray-700`}>{currency(diffCost)}</td>
                        </Fragment>
                      );
                    })()}
                    {(["Engineering", "Shop"] as const).map((group) => {
                      const t = groupGrandTotals[group];
                      const hoursLeft = t.prior - t.worked;
                      const diff = hoursLeft - t.newEtc;
                      return (
                        <Fragment key={group}>
                          <td className="border-l border-sdc-border bg-[#5E91D3] px-1 py-1 text-right text-xs text-white">{wholeNum(t.prior)}</td>
                          <td className={`border-l border-sdc-border ${HOURS_WORKED_BG} px-1 py-1 text-right text-xs text-sdc-blue-dark`}>{wholeNum(t.worked)}</td>
                          <td className={`border-l border-sdc-border ${HOURS_LEFT_BG} px-1 py-1 text-right text-xs text-sdc-blue-dark`}>{wholeNum(hoursLeft)}</td>
                          <td className={`border-l border-sdc-border ${newEtcBg(true)} px-1 py-1 text-right text-xs text-sdc-blue-dark`}>{wholeNum(t.newEtc)}</td>
                          <td className={`border-l border-sdc-border ${diffBg(diff)} px-1 py-1 text-right text-xs text-sdc-gray-700`}>{wholeNum(diff)}</td>
                        </Fragment>
                      );
                    })}
                    {showStandards && (
                      <Fragment key="standards-total">
                        {/* Rates don't sum — the three rate columns stay blank in the total row. */}
                        <td className={`${STD_EDGE} px-2 py-1`} />
                        <td className="border-l border-sdc-border px-2 py-1" />
                        <td className="border-l border-sdc-border px-2 py-1" />
                        <td className="border-l border-sdc-border px-2 py-1" />
                        <td className="border-l border-sdc-border px-2 py-1" />
                        <td className="border-l border-sdc-border px-2 py-1" />
                        <td className="border-l border-sdc-border px-2 py-1 text-right text-xs text-sdc-navy">{currency(standardGrand.totalEtcDollars)}</td>
                        <td className="border-l border-sdc-border px-2 py-1 text-right text-xs text-sdc-navy">{percent(standardGrand.percentOfTotal)}</td>
                        <td className="border-l border-sdc-border px-2 py-1 text-right text-xs text-sdc-navy">{currency(standardGrand.standardFees)}</td>
                        <td className="border-l border-sdc-border px-2 py-1 text-right text-xs text-sdc-navy">
                          {standardGrand.contingencyAmount ? currency(standardGrand.contingencyAmount) : "—"}
                        </td>
                        <td className="border-l border-sdc-border px-2 py-1 text-right text-xs font-semibold text-sdc-navy">{currency(standardGrand.totalStandardFees)}</td>
                        <td className="border-l border-sdc-border px-2 py-1" />
                      </Fragment>
                    )}
                  </tr>
                )}
              </tbody>
            </table>
          </div>

        </form>
      )}
    </div>
  );
}
