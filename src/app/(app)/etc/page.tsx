import { Fragment } from "react";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { validJobTypeFilter } from "@/lib/job-filters";
import { ETC_SECTIONS, ETC_PHASE_GROUPS, PARTS_COST_SECTION } from "@/lib/sections";
import { calcHoursLeft, suggestNewEtc, isMonthLocked } from "@/lib/etc";
import { startMonth, submitMonth, reopenMonth, clearMonth, syncPowerBiForEtc } from "@/lib/etc-actions";
import { PageTitle } from "@/components/ui/Typography";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PillLinks } from "@/components/ui/PillLinks";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, TABLE_HEADER_ROW } from "@/components/ui/classnames";

// Matches the real "Managers Fill Out" sheet's column shape exactly — every
// department block (and the Total rollup) has these same 5 columns.
const SUB_COLUMNS = ["Prior ETC", "Hours Worked", "Hours Left", "New ETC", "Diff"] as const;
const PARTS_COST_SUB_COLUMNS = ["Prior ETC", "Money Spent Month", "Money Left", "New ETC", "Diff"] as const;

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
  if (col === "Hours Worked" || col === "Money Spent Month") return HOURS_WORKED_BG;
  if (col === "Hours Left" || col === "Money Left") return HOURS_LEFT_BG;
  if (col === "New ETC") return "bg-[#F2F2F2]";
  return "";
}

// Same column-identity backgrounds, without a text-color opinion — for cells
// (like the "—" empty-section placeholder) that set their own text color.
function subColBodyBg(col: string): string {
  if (col === "Hours Worked" || col === "Money Spent Month") return HOURS_WORKED_BG;
  if (col === "Hours Left" || col === "Money Left") return HOURS_LEFT_BG;
  if (col === "New ETC") return "bg-[#F2F2F2]";
  if (col === "Diff") return "bg-white";
  return "";
}

function currency(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

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

  const [jobs, session, lastPowerBiSync, hoursActualFreshness] = await Promise.all([
    prisma.job.findMany({
      where: { status: "Active", completeDate: null, ...validJobTypeFilter },
      include: { estimatedHours: true, etcEntries: { where: { month } } },
      orderBy: { jobId: "asc" },
    }),
    auth(),
    prisma.jobMonthlyActualHours.findFirst({ orderBy: { syncedAt: "desc" }, select: { syncedAt: true } }),
    prisma.powerBiFreshness.findUnique({ where: { source: "hours_actual" }, select: { refreshedThrough: true } }),
  ]);
  const role = (session?.user as { role?: string } | undefined)?.role;

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
      <p className="mb-1 text-sm text-sdc-gray-600">
        {jobs.length} active job{jobs.length === 1 ? "" : "s"}
      </p>
      <p className="mb-4 text-sm text-sdc-gray-600">
        One screen for all active jobs&apos; ETC sections — replaces the &quot;Managers Fill Out&quot; sheet with
        atomic, audited submission per month.
      </p>

      <div className="mb-6 flex items-center gap-3">
        <form action={syncPowerBiForEtc.bind(null, month)}>
          <button type="submit" className={BUTTON_SECONDARY}>
            Refresh Data (Power BI)
          </button>
        </form>
        <span className="text-xs text-sdc-gray-400">
          {lastPowerBiSync?.syncedAt
            ? `Last synced: ${lastPowerBiSync.syncedAt.toISOString().slice(0, 16).replace("T", " ")}`
            : "Never synced"}
          {hoursActualFreshness?.refreshedThrough && (
            <> · Hours Refreshed Thru: {hoursActualFreshness.refreshedThrough.toISOString().slice(0, 10)}</>
          )}
        </span>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-sdc-gray-500">Month:</span>
        {distinctMonths.length === 0 && <span className="text-xs text-sdc-gray-400">no ETC history yet</span>}
        <PillLinks
          items={distinctMonths.map((m) => ({
            key: m.month,
            label: m.month,
            href: `/etc?month=${m.month}`,
            active: m.month === month,
          }))}
        />
        {!distinctMonths.some((m) => m.month === month) && (
          <StatusBadge variant="active">{month} (current, no entries)</StatusBadge>
        )}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusBadge variant={!started ? "notStarted" : locked ? "locked" : "needsReview"}>
          {!started ? "Not started" : locked ? "Locked (submitted)" : `In progress — ${needsReviewCount} pending`}
        </StatusBadge>

        {!started && (
          <form action={startMonth.bind(null, month)}>
            <button type="submit" className={BUTTON_PRIMARY}>
              Start {month}
            </button>
          </form>
        )}

        {locked && role === "ADMIN" && (
          <form action={reopenMonth.bind(null, month)}>
            <button type="submit" className={BUTTON_SECONDARY}>
              Reopen for editing
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
      </div>

      {started && !locked && (
        <p className="mb-4 -mt-4 text-xs text-sdc-gray-400">
          &quot;Clear ETC&quot; resets Hours Worked back to zero for every row in {month} — use it to start this
          month&apos;s entry over, not to correct one job (edit that row instead).
        </p>
      )}

      {started && (
        <form action={submitMonth.bind(null, month)}>
          <p className="mb-2 text-xs text-sdc-gray-400">
            Enter Hours Worked this month. New ETC defaults to the suggested value (shown as a placeholder below each
            input) — type a value to override it.
          </p>
          <div className="overflow-x-auto rounded-xl border border-sdc-border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className={TABLE_HEADER_ROW}>
                  <th rowSpan={3} className="sticky left-0 z-10 bg-sdc-gray-100 px-3 py-3 align-bottom">
                    Job Id
                  </th>
                  <th rowSpan={3} className="px-3 py-3 align-bottom">Job Name</th>
                  {ETC_PHASE_GROUPS.map((g, i) => (
                    <th
                      key={g.phase + i}
                      colSpan={g.count * SUB_COLUMNS.length}
                      className="border-l border-sdc-border px-3 py-2 text-center"
                    >
                      {g.phase}
                    </th>
                  ))}
                  <th colSpan={PARTS_COST_SUB_COLUMNS.length} className="border-l border-sdc-border bg-sdc-gray-100 px-3 py-2 text-center text-sdc-gray-700">
                    Parts Cost
                  </th>
                  <th colSpan={2 * SUB_COLUMNS.length} className="border-l border-sdc-border bg-sdc-blue-light/40 px-3 py-2 text-center text-sdc-blue-dark">
                    Total (New ETC)
                  </th>
                </tr>
                <tr className={TABLE_HEADER_ROW}>
                  {ETC_SECTIONS.map((s) => {
                    const color = SECTION_HEADER_COLOR[s.code];
                    return (
                      <th
                        key={s.code}
                        title={s.code}
                        colSpan={SUB_COLUMNS.length}
                        className={`border-l border-sdc-border px-2 py-2 text-center ${color ?? ""}`}
                      >
                        {s.name}
                        <span
                          className={`block font-mono text-[10px] font-normal normal-case tracking-normal ${
                            color ? "text-sdc-navy/60" : "text-sdc-gray-400"
                          }`}
                        >
                          {s.code}
                        </span>
                      </th>
                    );
                  })}
                  <th colSpan={PARTS_COST_SUB_COLUMNS.length} className="border-l border-sdc-border bg-sdc-gray-100 px-2 py-2 text-center text-sdc-gray-700">
                    Total
                  </th>
                  <th colSpan={SUB_COLUMNS.length} className="border-l border-sdc-border bg-sdc-blue-light/40 px-2 py-2 text-center text-sdc-blue-dark">
                    Engineering
                  </th>
                  <th colSpan={SUB_COLUMNS.length} className="border-l border-sdc-border bg-sdc-blue-light/40 px-2 py-2 text-center text-sdc-blue-dark">
                    Shop
                  </th>
                </tr>
                <tr className={TABLE_HEADER_ROW}>
                  {ETC_SECTIONS.map((s) =>
                    SUB_COLUMNS.map((col) => (
                      <th
                        key={`${s.code}-${col}`}
                        className={`border-l border-sdc-border px-2 py-1.5 text-right text-[10px] ${
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
                      className={`border-l border-sdc-border px-2 py-1.5 text-right text-[10px] ${
                        subColHeaderBg(col) || "bg-sdc-gray-100 text-sdc-gray-700"
                      }`}
                    >
                      {col}
                    </th>
                  ))}
                  {(["Engineering", "Shop"] as const).map((group) =>
                    SUB_COLUMNS.map((col) => (
                      <th
                        key={`${group}-${col}`}
                        className={`border-l border-sdc-border px-2 py-1.5 text-right text-[10px] ${
                          subColHeaderBg(col) || "bg-sdc-blue-light/40 text-sdc-blue-dark"
                        }`}
                      >
                        {col}
                      </th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-sdc-border-soft">
                {jobs.map((job) => {
                  const estByCode = new Map(job.estimatedHours.map((eh) => [eh.section, eh]));
                  const entryByCode = new Map(job.etcEntries.map((e) => [e.section, e]));

                  // "Total (New ETC)" — a pure rollup, confirmed from the real sheet's
                  // formulas (SUM of the Engineering blocks' Prior/Worked/New ETC,
                  // separately for Shop) — not a manager-entered value.
                  const totals = { Engineering: { prior: 0, worked: 0, newEtc: 0 }, Shop: { prior: 0, worked: 0, newEtc: 0 } };
                  for (const s of ETC_SECTIONS) {
                    const entry = entryByCode.get(s.code);
                    if (!entry || !estByCode.has(s.code)) continue;
                    const prior = Number(entry.priorEtc);
                    const worked = Number(entry.hoursWorked);
                    const newEtc = entry.needsReview ? suggestNewEtc(prior, worked) : Number(entry.newEtc);
                    totals[s.billingGroup].prior += prior;
                    totals[s.billingGroup].worked += worked;
                    totals[s.billingGroup].newEtc += newEtc;
                  }

                  return (
                    <tr key={job.id} className="hover:bg-sdc-blue-light/40">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 font-mono text-sdc-gray-400">{job.jobId}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-sdc-navy">{job.jobName}</td>
                      {ETC_SECTIONS.map((s) => {
                        const hasSection = estByCode.has(s.code);
                        const entry = entryByCode.get(s.code);
                        if (!hasSection || !entry) {
                          return SUB_COLUMNS.map((col) => (
                            <td
                              key={`${s.code}-${col}`}
                              className={`border-l border-sdc-border px-2 py-2 text-center ${
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
                        const effectiveNewEtc = entry.needsReview ? suggested : Number(entry.newEtc);
                        const diff = hoursLeft - effectiveNewEtc;

                        const sectionTotal = sectionGrandTotals.get(s.code)!;
                        sectionTotal.prior += prior;
                        sectionTotal.worked += worked;
                        sectionTotal.newEtc += effectiveNewEtc;

                        return (
                          <Fragment key={s.code}>
                            <td className="border-l border-sdc-border bg-[#5E91D3] px-2 py-2 text-right text-xs text-white">
                              {wholeNum(prior)}
                            </td>
                            <td className={`border-l border-sdc-border ${HOURS_WORKED_BG} px-2 py-2`}>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                name={`hoursWorked__${entry.id}`}
                                defaultValue={wholeNum(worked)}
                                disabled={locked}
                                aria-label={`Hours worked, ${job.jobName}, ${s.name}`}
                                className="w-16 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-right text-xs outline-none focus:border-sdc-blue focus:bg-white focus:shadow-sm disabled:text-sdc-gray-400"
                              />
                            </td>
                            <td className={`border-l border-sdc-border ${HOURS_LEFT_BG} px-2 py-2 text-right text-xs text-sdc-gray-500`}>
                              {wholeNum(hoursLeft)}
                            </td>
                            <td className={`border-l border-sdc-border ${newEtcBg(worked === 0)} px-2 py-2`}>
                              {/* No hours worked -> carry-forward is deterministic, safe to auto-fill.
                                  Hours worked > 0 -> a manager's judgment call, not auto-filled;
                                  flagged yellow so it's obviously not done yet. */}
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                name={`newEtcOverride__${entry.id}`}
                                defaultValue={worked === 0 ? wholeNum(suggested) : undefined}
                                placeholder={worked === 0 ? undefined : wholeNum(suggested)}
                                disabled={locked}
                                aria-label={`New ETC override, ${job.jobName}, ${s.name}`}
                                className={`w-16 [appearance:textfield] rounded-md border-none bg-transparent px-1.5 py-1 text-right text-xs outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:bg-white focus:shadow-sm ${
                                  worked === 0 ? "text-sdc-gray-600" : "text-sdc-yellow-text placeholder:text-sdc-yellow-text/60"
                                }`}
                              />
                            </td>
                            <td className={`border-l border-sdc-border ${diffBg(diff)} px-2 py-2 text-right text-xs text-sdc-gray-700`}>
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
                              className={`border-l border-sdc-border px-2 py-2 text-center text-sdc-gray-400 ${
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
                        const effectiveNewEtcCost = partsCostEntry.needsReview ? suggestedCost : Number(partsCostEntry.newEtc);
                        const diffCost = moneyLeft - effectiveNewEtcCost;

                        partsCostGrandTotal.prior += prior;
                        partsCostGrandTotal.worked += spent;
                        partsCostGrandTotal.newEtc += effectiveNewEtcCost;

                        return (
                          <Fragment key="parts-cost">
                            <td className="border-l border-sdc-border bg-[#5E91D3] px-2 py-2 text-right text-xs text-white">
                              {currency(prior)}
                            </td>
                            <td className={`border-l border-sdc-border ${HOURS_WORKED_BG} px-2 py-2`}>
                              {/* Not manager-editable — always Power BI's actual, passed through as a
                                  hidden field so submitMonth's generic per-entry loop still works. */}
                              <input type="hidden" name={`hoursWorked__${partsCostEntry.id}`} value={spent} />
                              <span className="block w-20 truncate text-right text-xs text-sdc-gray-600" title={currency(spent)}>
                                {currency(spent)}
                              </span>
                            </td>
                            <td className={`border-l border-sdc-border ${HOURS_LEFT_BG} px-2 py-2 text-right text-xs text-sdc-gray-500`}>
                              {currency(moneyLeft)}
                            </td>
                            <td className={`border-l border-sdc-border ${newEtcBg(spent === 0)} px-2 py-2`}>
                              <input
                                type="number"
                                step="0.01"
                                name={`newEtcOverride__${partsCostEntry.id}`}
                                defaultValue={spent === 0 ? wholeNum(suggestedCost) : undefined}
                                placeholder={spent === 0 ? undefined : wholeNum(suggestedCost)}
                                disabled={locked}
                                aria-label={`New ETC cost override, ${job.jobName}, Parts Cost`}
                                className={`w-20 [appearance:textfield] rounded-md border-none bg-transparent px-1.5 py-1 text-right text-xs outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:bg-white focus:shadow-sm ${
                                  spent === 0 ? "text-sdc-gray-600" : "text-sdc-yellow-text placeholder:text-sdc-yellow-text/60"
                                }`}
                              />
                            </td>
                            <td className={`border-l border-sdc-border ${diffBg(diffCost)} px-2 py-2 text-right text-xs text-sdc-gray-700`}>
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
                            <td className="border-l border-sdc-border bg-[#5E91D3] px-2 py-2 text-right text-xs text-white">
                              {wholeNum(totals[group].prior)}
                            </td>
                            <td className={`border-l border-sdc-border ${HOURS_WORKED_BG} px-2 py-2 text-right text-xs text-sdc-gray-500`}>
                              {wholeNum(totals[group].worked)}
                            </td>
                            <td className={`border-l border-sdc-border ${HOURS_LEFT_BG} px-2 py-2 text-right text-xs text-sdc-gray-500`}>
                              {wholeNum(hoursLeft)}
                            </td>
                            <td className={`border-l border-sdc-border ${newEtcBg(true)} px-2 py-2 text-right text-xs font-medium text-sdc-navy`}>
                              {wholeNum(totals[group].newEtc)}
                            </td>
                            <td className={`border-l border-sdc-border ${diffBg(diff)} px-2 py-2 text-right text-xs text-sdc-gray-700`}>
                              {wholeNum(diff)}
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  );
                })}
                {jobs.length === 0 && (
                  <tr>
                    <td
                      colSpan={2 + (ETC_SECTIONS.length + 2) * SUB_COLUMNS.length + PARTS_COST_SUB_COLUMNS.length}
                      className="px-4 py-5 text-sdc-gray-400"
                    >
                      No active jobs found.
                    </td>
                  </tr>
                )}
                {jobs.length > 0 && (
                  <tr className="border-t-2 border-sdc-navy bg-sdc-gray-100 font-medium">
                    <td className="sticky left-0 z-10 bg-sdc-gray-100 px-3 py-2" colSpan={2}>
                      Total
                    </td>
                    {ETC_SECTIONS.map((s) => {
                      const t = sectionGrandTotals.get(s.code)!;
                      const hoursLeft = t.prior - t.worked;
                      const diff = hoursLeft - t.newEtc;
                      return (
                        <Fragment key={s.code}>
                          <td className="border-l border-sdc-border bg-[#5E91D3] px-2 py-2 text-right text-xs text-white">{wholeNum(t.prior)}</td>
                          <td className={`border-l border-sdc-border ${HOURS_WORKED_BG} px-2 py-2 text-right text-xs text-sdc-navy`}>{wholeNum(t.worked)}</td>
                          <td className={`border-l border-sdc-border ${HOURS_LEFT_BG} px-2 py-2 text-right text-xs text-sdc-navy`}>{wholeNum(hoursLeft)}</td>
                          <td className={`border-l border-sdc-border ${newEtcBg(true)} px-2 py-2 text-right text-xs text-sdc-navy`}>{wholeNum(t.newEtc)}</td>
                          <td className={`border-l border-sdc-border ${diffBg(diff)} px-2 py-2 text-right text-xs text-sdc-gray-700`}>{wholeNum(diff)}</td>
                        </Fragment>
                      );
                    })}
                    {(() => {
                      const t = partsCostGrandTotal;
                      const moneyLeft = t.prior - t.worked;
                      const diffCost = moneyLeft - t.newEtc;
                      return (
                        <Fragment key="parts-cost-total">
                          <td className="border-l border-sdc-border bg-[#5E91D3] px-2 py-2 text-right text-xs text-white">{currency(t.prior)}</td>
                          <td className={`border-l border-sdc-border ${HOURS_WORKED_BG} px-2 py-2 text-right text-xs text-sdc-navy`}>{currency(t.worked)}</td>
                          <td className={`border-l border-sdc-border ${HOURS_LEFT_BG} px-2 py-2 text-right text-xs text-sdc-navy`}>{currency(moneyLeft)}</td>
                          <td className={`border-l border-sdc-border ${newEtcBg(true)} px-2 py-2 text-right text-xs text-sdc-navy`}>{currency(t.newEtc)}</td>
                          <td className={`border-l border-sdc-border ${diffBg(diffCost)} px-2 py-2 text-right text-xs text-sdc-gray-700`}>{currency(diffCost)}</td>
                        </Fragment>
                      );
                    })()}
                    {(["Engineering", "Shop"] as const).map((group) => {
                      const t = groupGrandTotals[group];
                      const hoursLeft = t.prior - t.worked;
                      const diff = hoursLeft - t.newEtc;
                      return (
                        <Fragment key={group}>
                          <td className="border-l border-sdc-border bg-[#5E91D3] px-2 py-2 text-right text-xs text-white">{wholeNum(t.prior)}</td>
                          <td className={`border-l border-sdc-border ${HOURS_WORKED_BG} px-2 py-2 text-right text-xs text-sdc-blue-dark`}>{wholeNum(t.worked)}</td>
                          <td className={`border-l border-sdc-border ${HOURS_LEFT_BG} px-2 py-2 text-right text-xs text-sdc-blue-dark`}>{wholeNum(hoursLeft)}</td>
                          <td className={`border-l border-sdc-border ${newEtcBg(true)} px-2 py-2 text-right text-xs text-sdc-blue-dark`}>{wholeNum(t.newEtc)}</td>
                          <td className={`border-l border-sdc-border ${diffBg(diff)} px-2 py-2 text-right text-xs text-sdc-gray-700`}>{wholeNum(diff)}</td>
                        </Fragment>
                      );
                    })}
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {!locked && jobs.length > 0 && (
            <div className="mt-4">
              <button type="submit" className={`${BUTTON_PRIMARY} px-5 py-2.5`}>
                Submit {month}
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
