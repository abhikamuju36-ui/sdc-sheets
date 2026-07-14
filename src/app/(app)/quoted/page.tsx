import { Fragment } from "react";
import { prisma } from "@/lib/prisma";
import { validJobTypeFilter, VALID_JOB_TYPES, compareJobIds, isSdcCustomer } from "@/lib/job-filters";
import { SECTIONS, PHASE_GROUPS } from "@/lib/sections";
import { PageTitle } from "@/components/ui/Typography";
import { TABLE_HEADER_ROW, TABLE_GRID, BUTTON_PRIMARY } from "@/components/ui/classnames";
import { PhaseColumnPicker } from "@/components/PhaseColumnPicker";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { SortButton } from "@/components/SortButton";
import { AddProjectButton } from "@/components/AddProjectButton";
import { NewProjectRows } from "@/components/NewProjectRows";
import { DateCell } from "@/components/DateCell";
import { saveQuotedHours } from "@/lib/quoted-actions";

// <input type="date"> wants "" or "YYYY-MM-DD" — never "—" (formatDate's
// display placeholder), which the browser would reject as an invalid date.
function dateInputValue(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

// Hours display everywhere on this page is whole numbers — no decimals,
// rounded rather than truncated. Use this for any hours value added later too.
function wholeHours(n: unknown): string {
  if (n == null) return "—";
  return Math.round(Number(n)).toString();
}

const SORT_KEYS = ["jobId", "status", "startDate", "completeDate"] as const;
type SortKey = (typeof SORT_KEYS)[number];

const BILLABLE_OPTIONS = ["Billable", "Non-Billable"];

export default async function QuotedPage({
  searchParams,
}: {
  searchParams: Promise<{
    cols?: string;
    sort?: string;
    dir?: string;
    customers?: string;
    types?: string;
    statuses?: string;
    billables?: string;
  }>;
}) {
  const { cols, sort, dir, customers, types, statuses, billables } = await searchParams;
  // No `cols` param at all (first visit) defaults to every section visible;
  // an explicit (possibly empty) `cols` value means the user has picked some.
  const visibleCodes = cols === undefined ? SECTIONS.map((s) => s.code) : cols.split(",").filter(Boolean);
  const visibleSet = new Set(visibleCodes);

  const sortKey: SortKey = SORT_KEYS.includes(sort as SortKey) ? (sort as SortKey) : "jobId";
  const sortDir = dir === "desc" ? "desc" : "asc";

  // Real job types are a fixed, known set (job-filters.ts) — no query needed.
  // Customers are open-ended, so pull the distinct list actually in use.
  const allTypes: string[] = [...VALID_JOB_TYPES];
  const distinctCustomers = await prisma.job.findMany({
    where: validJobTypeFilter,
    distinct: ["customer"],
    select: { customer: true },
  });
  const allCustomers = distinctCustomers
    .map((j) => j.customer)
    .filter((c): c is string => Boolean(c))
    .sort((a, b) => a.localeCompare(b));

  const distinctStatuses = await prisma.job.findMany({
    where: validJobTypeFilter,
    distinct: ["status"],
    select: { status: true },
  });
  const allStatuses = distinctStatuses
    .map((j) => j.status)
    .filter((s): s is string => Boolean(s))
    .sort((a, b) => a.localeCompare(b));

  // Same "undefined = everything, explicit (even empty) = user's picks" rule as `cols`.
  const selectedTypes = types === undefined ? allTypes : types.split(",").filter(Boolean);
  const selectedCustomers = customers === undefined ? allCustomers : customers.split(",").filter(Boolean);
  const selectedStatuses = statuses === undefined ? allStatuses : statuses.split(",").filter(Boolean);
  const selectedBillables = billables === undefined ? BILLABLE_OPTIONS : billables.split(",").filter(Boolean);
  const showBillable = selectedBillables.includes("Billable");
  const showNonBillable = selectedBillables.includes("Non-Billable");
  // Boolean columns have no Prisma `in` filter — translate the two checkboxes
  // into an equals/no-match condition instead (both checked = no filter at all).
  const billableWhere =
    showBillable && showNonBillable
      ? {}
      : showBillable
        ? { billable: true }
        : showNonBillable
          ? { billable: false }
          : { id: -1 }; // neither checked -> match nothing, same as an empty `in` elsewhere

  const jobs = await prisma.job.findMany({
    where: {
      type: { in: selectedTypes },
      customer: { in: selectedCustomers },
      status: { in: selectedStatuses },
      ...billableWhere,
    },
    include: { estimatedHours: true },
    orderBy: { [sortKey]: sortDir },
  });
  if (sortKey === "jobId") {
    // Job Id is a string column — re-sort numerically (979 before 1020 before 10000).
    jobs.sort((a, b) => (sortDir === "desc" ? -1 : 1) * compareJobIds(a.jobId, b.jobId));
  }
  // Non-billable projects always sink to the bottom, regardless of the chosen
  // sort — Array#sort is stable, so this only reorders across the billable/
  // non-billable boundary and leaves each group's existing order untouched.
  jobs.sort((a, b) => Number(!a.billable) - Number(!b.billable));

  const visibleSectionsByPhase = new Map(
    PHASE_GROUPS.map((g) => [g.phase, SECTIONS.filter((s) => s.phase === g.phase && visibleSet.has(s.code))])
  );

  // Total visible data columns: for each phase, its visible sections + 1 total column
  // (or just 1 column if every section in that phase is hidden).
  const dataColumnCount = PHASE_GROUPS.reduce((sum, g) => {
    const visible = visibleSectionsByPhase.get(g.phase) ?? [];
    return sum + (visible.length ? visible.length + 1 : 1);
  }, 0);

  return (
    <div className="w-full px-8 py-10 md:px-13 md:py-11">
      <div className="mb-1 flex items-end justify-between gap-4">
        <PageTitle>Projects</PageTitle>
        <AddProjectButton className={BUTTON_PRIMARY} />
      </div>
      <p className="mb-5 text-sm text-sdc-gray-600">
        {jobs.length} jobs — quoted hours by section, quoted vs. actual cost. Click a phase to choose which section columns to show.
      </p>

      <div className="mb-5 flex flex-wrap gap-2.5">
        <MultiSelectFilter label="Customer" paramName="customers" options={allCustomers} selected={selectedCustomers} />
        <MultiSelectFilter label="Type" paramName="types" options={allTypes} selected={selectedTypes} />
        <MultiSelectFilter label="Status" paramName="statuses" options={allStatuses} selected={selectedStatuses} />
        <MultiSelectFilter label="Billable" paramName="billables" options={BILLABLE_OPTIONS} selected={selectedBillables} />
        {PHASE_GROUPS.map((g) => (
          <PhaseColumnPicker
            key={g.phase}
            phase={g.phase}
            sections={SECTIONS.filter((s) => s.phase === g.phase)}
            visibleCodes={visibleCodes}
          />
        ))}
      </div>

      <form action={saveQuotedHours}>
      <div className="max-h-[calc(100vh-220px)] min-w-[480px] overflow-auto rounded-xl border border-sdc-border bg-white shadow-sm select-none styled-scrollbar">
        <table className={`text-sm ${TABLE_GRID}`}>
          <thead className="sticky top-0 z-20 bg-sdc-gray-100">
            <tr className={TABLE_HEADER_ROW}>
              <th rowSpan={2} className="sticky left-0 z-10 w-8 min-w-8 bg-sdc-gray-100 px-1 py-2 text-center align-bottom">
                #
              </th>
              <th rowSpan={2} className="sticky left-8 z-10 bg-sdc-gray-100 px-2 py-2 align-bottom">
                <SortButton sortKey="jobId" label="Job Id" currentSort={sortKey} currentDir={sortDir} />
              </th>
              <th rowSpan={2} className="sticky left-[96px] z-10 min-w-[280px] border-l border-r border-sdc-border bg-sdc-gray-100 px-2 py-2 align-bottom">
                Job
              </th>
              <th rowSpan={2} className="px-2 py-2 align-bottom">
                Customer
              </th>
              <th rowSpan={2} className="px-2 py-2 align-bottom">
                Type
              </th>
              <th rowSpan={2} className="px-2 py-2 align-bottom">
                Billable
              </th>
              <th rowSpan={2} className="px-2 py-2 align-bottom">
                <SortButton sortKey="status" label="Status" currentSort={sortKey} currentDir={sortDir} />
              </th>
              <th rowSpan={2} className="px-2 py-2 align-bottom">
                <SortButton sortKey="startDate" label="Start Date" currentSort={sortKey} currentDir={sortDir} />
              </th>
              <th rowSpan={2} className="px-2 py-2 align-bottom">
                <SortButton sortKey="completeDate" label="Complete Date" currentSort={sortKey} currentDir={sortDir} />
              </th>
              {PHASE_GROUPS.map((g) => {
                const visible = visibleSectionsByPhase.get(g.phase) ?? [];
                return visible.length ? (
                  <th
                    key={g.phase}
                    colSpan={visible.length + 1}
                    className="border-l border-sdc-border bg-sdc-blue-light px-2 py-2 text-center text-sdc-blue"
                  >
                    {g.phase}
                  </th>
                ) : (
                  <th key={g.phase} className="border-l border-sdc-border px-1.5 py-2 text-center align-bottom text-sdc-blue" rowSpan={2}>
                    {g.phase}
                  </th>
                );
              })}
              <th rowSpan={2} className="sticky right-[84px] z-10 min-w-[84px] border-l border-sdc-border bg-sdc-gray-100 px-2 py-2 text-right align-bottom">
                Cost Quoted
              </th>
              <th rowSpan={2} className="sticky right-0 z-10 min-w-[84px] bg-sdc-gray-100 px-2 py-2 text-right align-bottom">
                Cost Actual
              </th>
            </tr>
            <tr className={TABLE_HEADER_ROW}>
              {PHASE_GROUPS.flatMap((g) => {
                const sections = visibleSectionsByPhase.get(g.phase) ?? [];
                if (!sections.length) return [];
                return [
                  ...sections.map((s) => (
                    <th key={s.code} title={s.code} className="w-14 border-l border-sdc-border px-1 py-2 text-center text-[10.5px] leading-tight">
                      {s.name}
                      <span className="block font-mono text-[9px] font-normal normal-case tracking-normal text-sdc-gray-400">
                        {s.code}
                      </span>
                    </th>
                  )),
                  <th key={`${g.phase}-total`} className="w-12 border-l border-sdc-border bg-sdc-blue-light px-1 py-2 text-center text-[10.5px] text-sdc-blue-dark">
                    Total
                  </th>,
                ];
              })}
            </tr>
          </thead>
          <tbody>
            <NewProjectRows
              phaseGroups={PHASE_GROUPS.map((g) => ({ phase: g.phase, sections: visibleSectionsByPhase.get(g.phase) ?? [] }))}
              allStatuses={allStatuses}
            />
            {jobs.length === 0 && (
              <tr>
                <td colSpan={9 + dataColumnCount + 2} className="px-4 py-5 text-sdc-gray-400">
                  No jobs found.
                </td>
              </tr>
            )}
            {jobs.map((job, i) => {
              const hoursBySection = new Map(job.estimatedHours.map((eh) => [eh.section, eh.quotedHours]));
              // SDC's own internal projects are always non-billable and get a
              // permanent light-blue highlight so they stand out from customer
              // work at a glance — this is driven by Customer, not the stored
              // billable flag, so it's correct even before the next save.
              const isSdc = isSdcCustomer(job.customer);
              const zebra = isSdc ? "bg-[#caedfb]" : i % 2 === 1 ? "bg-sdc-gray-50/60" : "";
              const zebraSticky = isSdc ? "bg-[#caedfb]" : i % 2 === 1 ? "bg-sdc-gray-50" : "bg-white";
              return (
                <tr key={job.id} className={`hover:bg-sdc-blue-light/40 ${zebra}`}>
                  <td className={`sticky left-0 z-10 w-8 min-w-8 px-1 py-1.5 text-center text-xs text-sdc-gray-400 ${zebraSticky}`}>
                    {i + 1}
                  </td>
                  <td className={`sticky left-8 z-10 whitespace-nowrap px-2 py-1.5 font-mono text-xs text-sdc-gray-500 ${zebraSticky}`}>
                    #{job.jobId}
                  </td>
                  <td className={`sticky left-[96px] z-10 min-w-[280px] whitespace-nowrap border-l border-r border-sdc-border px-2 py-1.5 text-xs font-medium text-sdc-navy ${zebraSticky}`}>
                    <input
                      type="text"
                      name={`jobField__${job.id}__jobName`}
                      defaultValue={job.jobName}
                      aria-label={`Job Name, ${job.jobName}`}
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs text-sdc-gray-600">
                    <input
                      type="text"
                      name={`jobField__${job.id}__customer`}
                      defaultValue={job.customer ?? ""}
                      placeholder="—"
                      aria-label={`Customer, ${job.jobName}`}
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs text-sdc-gray-600">
                    <select name={`jobField__${job.id}__type`} defaultValue={job.type ?? ""} aria-label={`Type, ${job.jobName}`}>
                      {job.type == null && <option value="">—</option>}
                      {VALID_JOB_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs">
                    {isSdc ? (
                      <span className="text-sdc-gray-500" aria-label={`Billable, ${job.jobName}`} title="SDC's own projects are always non-billable">
                        Non-Billable
                      </span>
                    ) : (
                      <select
                        name={`jobField__${job.id}__billable`}
                        defaultValue={job.billable ? "Billable" : "Non-Billable"}
                        aria-label={`Billable, ${job.jobName}`}
                        className={job.billable ? "text-sdc-green-text" : "text-sdc-gray-500"}
                      >
                        <option value="Billable">Billable</option>
                        <option value="Non-Billable">Non-Billable</option>
                      </select>
                    )}
                  </td>
                  <td
                    className={`whitespace-nowrap px-2 py-1.5 text-xs font-medium ${
                      job.status === "Complete" ? "text-sdc-green-text" : "text-sdc-blue-dark"
                    }`}
                  >
                    <select name={`jobField__${job.id}__status`} defaultValue={job.status} aria-label={`Status, ${job.jobName}`}>
                      {allStatuses.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs text-sdc-gray-500">
                    <DateCell
                      name={`jobField__${job.id}__startDate`}
                      defaultValue={dateInputValue(job.startDate)}
                      ariaLabel={`Start Date, ${job.jobName}`}
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs text-sdc-gray-500">
                    <DateCell
                      name={`jobField__${job.id}__completeDate`}
                      defaultValue={dateInputValue(job.completeDate)}
                      ariaLabel={`Complete Date, ${job.jobName}`}
                    />
                  </td>
                  {PHASE_GROUPS.map((g) => {
                    const allSections = SECTIONS.filter((s) => s.phase === g.phase);
                    const visibleSections = visibleSectionsByPhase.get(g.phase) ?? [];
                    const total = allSections.reduce((sum, s) => sum + Number(hoursBySection.get(s.code) ?? 0), 0);
                    if (!visibleSections.length) {
                      return (
                        <td key={g.phase} className="border-l border-sdc-border px-1 py-1.5 text-right font-mono text-xs text-sdc-gray-600">
                          {wholeHours(total)}
                        </td>
                      );
                    }
                    return (
                      <Fragment key={g.phase}>
                        {visibleSections.map((s) => {
                          const hours = hoursBySection.get(s.code);
                          return (
                            <td key={s.code} className="border-l border-sdc-border px-1 py-1.5 text-right font-mono text-xs text-sdc-gray-600">
                              <input
                                type="number"
                                step="1"
                                min="0"
                                name={`quoted__${job.id}__${s.code}`}
                                defaultValue={hours != null ? Math.round(Number(hours)).toString() : ""}
                                placeholder="—"
                                aria-label={`Quoted hours, ${job.jobName}, ${s.name}`}
                                className="text-right"
                              />
                            </td>
                          );
                        })}
                        <td className="border-l border-sdc-border bg-sdc-blue-light px-1 py-1.5 text-right font-mono text-xs font-medium text-sdc-navy">
                          {wholeHours(total)}
                        </td>
                      </Fragment>
                    );
                  })}
                  <td className={`sticky right-[84px] z-10 whitespace-nowrap border-l border-sdc-border px-2 py-1.5 text-right text-xs font-medium text-sdc-navy ${zebraSticky}`}>
                    <div className="flex items-center justify-end gap-0.5">
                      <span className="text-sdc-gray-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        name={`jobField__${job.id}__costQuoted`}
                        defaultValue={job.costQuoted != null ? Number(job.costQuoted).toString() : ""}
                        placeholder="—"
                        aria-label={`Cost Quoted, ${job.jobName}`}
                        className="w-full min-w-0 border-none bg-transparent text-right outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </div>
                  </td>
                  <td className={`sticky right-0 z-10 whitespace-nowrap px-2 py-1.5 text-right text-xs text-sdc-gray-600 ${zebraSticky}`}>
                    <div className="flex items-center justify-end gap-0.5">
                      <span className="text-sdc-gray-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        name={`jobField__${job.id}__costActualHistorical`}
                        defaultValue={job.costActualHistorical != null ? Number(job.costActualHistorical).toString() : ""}
                        placeholder="—"
                        aria-label={`Cost Actual, ${job.jobName}`}
                        className="w-full min-w-0 border-none bg-transparent text-right outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4">
        <button type="submit" className={BUTTON_PRIMARY}>
          Save Quoted Hours
        </button>
      </div>
      </form>
    </div>
  );
}
