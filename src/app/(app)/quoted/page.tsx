import { Fragment } from "react";
import { prisma } from "@/lib/prisma";
import { validJobTypeFilter, VALID_JOB_TYPES, compareJobIds } from "@/lib/job-filters";
import { SECTIONS, PHASE_GROUPS } from "@/lib/sections";
import { PageTitle } from "@/components/ui/Typography";
import { TABLE_HEADER_ROW, TABLE_GRID } from "@/components/ui/classnames";
import { PhaseColumnPicker } from "@/components/PhaseColumnPicker";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { SortButton } from "@/components/SortButton";

function formatDate(d: Date | null) {
  return d ? d.toISOString().slice(0, 10) : "—";
}

function currency(n: unknown) {
  if (n == null) return "—";
  return Number(n).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// Hours display everywhere on this page is whole numbers — no decimals,
// rounded rather than truncated. Use this for any hours value added later too.
function wholeHours(n: unknown): string {
  if (n == null) return "—";
  return Math.round(Number(n)).toString();
}

const SORT_KEYS = ["jobId", "status", "startDate", "completeDate"] as const;
type SortKey = (typeof SORT_KEYS)[number];

export default async function QuotedPage({
  searchParams,
}: {
  searchParams: Promise<{ cols?: string; sort?: string; dir?: string; customers?: string; types?: string; statuses?: string }>;
}) {
  const { cols, sort, dir, customers, types, statuses } = await searchParams;
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

  const jobs = await prisma.job.findMany({
    where: { type: { in: selectedTypes }, customer: { in: selectedCustomers }, status: { in: selectedStatuses } },
    include: { estimatedHours: true },
    orderBy: { [sortKey]: sortDir },
  });
  if (sortKey === "jobId") {
    // Job Id is a string column — re-sort numerically (979 before 1020 before 10000).
    jobs.sort((a, b) => (sortDir === "desc" ? -1 : 1) * compareJobIds(a.jobId, b.jobId));
  }

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
    <div className="w-full p-8">
      <PageTitle className="mb-1">Quoted</PageTitle>
      <p className="mb-4 text-sm text-sdc-gray-600">
        {jobs.length} jobs — quoted hours by section, quoted vs. actual cost. Click a phase to choose which section columns to show.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <MultiSelectFilter label="Customer" paramName="customers" options={allCustomers} selected={selectedCustomers} />
        <MultiSelectFilter label="Type" paramName="types" options={allTypes} selected={selectedTypes} />
        <MultiSelectFilter label="Status" paramName="statuses" options={allStatuses} selected={selectedStatuses} />
        {PHASE_GROUPS.map((g) => (
          <PhaseColumnPicker
            key={g.phase}
            phase={g.phase}
            sections={SECTIONS.filter((s) => s.phase === g.phase)}
            visibleCodes={visibleCodes}
          />
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-sdc-border bg-white shadow-sm">
        <table className={`w-full text-sm ${TABLE_GRID}`}>
          <thead>
            <tr className={TABLE_HEADER_ROW}>
              <th rowSpan={2} className="sticky left-0 z-10 bg-sdc-gray-100 px-2 py-2 align-bottom">
                <SortButton sortKey="jobId" label="Job Id" currentSort={sortKey} currentDir={sortDir} />
              </th>
              <th rowSpan={2} className="sticky left-[64px] z-10 min-w-[280px] border-l border-sdc-border bg-sdc-gray-100 px-2 py-2 align-bottom">
                Job
              </th>
              <th rowSpan={2} className="px-2 py-2 align-bottom">
                Customer
              </th>
              <th rowSpan={2} className="px-2 py-2 align-bottom">
                Type
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
                  <th key={g.phase} colSpan={visible.length + 1} className="border-l border-sdc-border px-2 py-1.5 text-center">
                    {g.phase}
                  </th>
                ) : (
                  <th key={g.phase} className="border-l border-sdc-border px-1.5 py-1.5 text-center align-bottom" rowSpan={2}>
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
                    <th key={s.code} title={s.code} className="w-14 border-l border-sdc-border px-1 py-1.5 text-right text-[10px]">
                      {s.name}
                      <span className="block font-mono text-[9px] font-normal normal-case tracking-normal text-sdc-gray-400">
                        {s.code}
                      </span>
                    </th>
                  )),
                  <th key={`${g.phase}-total`} className="w-14 border-l border-sdc-border bg-sdc-blue-light px-1 py-1.5 text-right text-[10px] text-sdc-blue-dark">
                    Total
                  </th>,
                ];
              })}
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr>
                <td colSpan={7 + dataColumnCount + 2} className="px-4 py-5 text-sdc-gray-400">
                  No jobs found.
                </td>
              </tr>
            )}
            {jobs.map((job, i) => {
              const hoursBySection = new Map(job.estimatedHours.map((eh) => [eh.section, eh.quotedHours]));
              const zebra = i % 2 === 1 ? "bg-sdc-gray-50/60" : "";
              return (
                <tr key={job.id} className={`hover:bg-sdc-blue-light/40 ${zebra}`}>
                  <td className={`sticky left-0 z-10 whitespace-nowrap px-2 py-1.5 font-mono text-xs text-sdc-gray-500 ${zebra || "bg-white"}`}>
                    #{job.jobId}
                  </td>
                  <td className={`sticky left-[64px] z-10 min-w-[280px] whitespace-nowrap border-l border-sdc-border px-2 py-1.5 text-xs font-medium text-sdc-navy ${zebra || "bg-white"}`}>
                    {job.jobName}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs text-sdc-gray-600">{job.customer || "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs text-sdc-gray-600">{job.type || "—"}</td>
                  <td
                    className={`whitespace-nowrap px-2 py-1.5 text-xs font-medium ${
                      job.status === "Complete" ? "text-sdc-green-text" : "text-sdc-blue-dark"
                    }`}
                  >
                    {job.status}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs text-sdc-gray-500">{formatDate(job.startDate)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs text-sdc-gray-500">{formatDate(job.completeDate)}</td>
                  {PHASE_GROUPS.map((g) => {
                    const allSections = SECTIONS.filter((s) => s.phase === g.phase);
                    const visibleSections = visibleSectionsByPhase.get(g.phase) ?? [];
                    const total = allSections.reduce((sum, s) => sum + Number(hoursBySection.get(s.code) ?? 0), 0);
                    if (!visibleSections.length) {
                      return (
                        <td key={g.phase} className="border-l border-sdc-border px-1.5 py-1.5 text-right font-mono text-xs text-sdc-gray-600">
                          {wholeHours(total)}
                        </td>
                      );
                    }
                    return (
                      <Fragment key={g.phase}>
                        {visibleSections.map((s) => {
                          const hours = hoursBySection.get(s.code);
                          return (
                            <td key={s.code} className="border-l border-sdc-border px-1.5 py-1.5 text-right font-mono text-xs text-sdc-gray-600">
                              {wholeHours(hours)}
                            </td>
                          );
                        })}
                        <td className="border-l border-sdc-border bg-sdc-blue-light/30 px-1.5 py-1.5 text-right font-mono text-xs font-medium text-sdc-navy">
                          {wholeHours(total)}
                        </td>
                      </Fragment>
                    );
                  })}
                  <td className={`sticky right-[84px] z-10 whitespace-nowrap border-l border-sdc-border px-2 py-1.5 text-right text-xs font-medium text-sdc-navy ${zebra || "bg-white"}`}>
                    {currency(job.costQuoted)}
                  </td>
                  <td className={`sticky right-0 z-10 whitespace-nowrap px-2 py-1.5 text-right text-xs text-sdc-gray-600 ${zebra || "bg-white"}`}>
                    {currency(job.costActualHistorical)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
