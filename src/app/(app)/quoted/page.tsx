import { Fragment } from "react";
import { prisma } from "@/lib/prisma";
import { validJobTypeFilter, VALID_JOB_TYPES, compareJobIds, isSdcCustomer } from "@/lib/job-filters";
import { SECTIONS, PHASE_GROUPS } from "@/lib/sections";
import { PageTitle } from "@/components/ui/Typography";
import { TABLE_HEADER_ROW, TABLE_GRID, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/classnames";
import { PhaseColumnPicker } from "@/components/PhaseColumnPicker";
import { ColumnToggle } from "@/components/ColumnToggle";
import { GridZoomControls } from "@/components/GridZoomControls";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { SortButton } from "@/components/SortButton";
import { AddProjectButton } from "@/components/AddProjectButton";
import { NewProjectRows } from "@/components/NewProjectRows";
import { NewFromReleaseButton } from "@/components/NewFromReleaseButton";
import { DateCell } from "@/components/DateCell";
import { saveQuotedHours } from "@/lib/quoted-actions";

// Header banding, matching the real "Estimated Hours" tab's column colors
// exactly (extracted from its theme + explicit fills) — phase row, then a
// department-band row (Function Group), then the section name.
// Re-themed to the SDC brand palette (see brand color sheet): phase banners
// use the bold brand *core* colors, group sub-bands below use lighter brand
// *tints* so the two-tier header hierarchy reads at a glance. Each value
// carries its own text color so it can win over the base cell class reliably.
const PHASE_HEADER_COLOR: Record<string, string> = {
  "Complete Design & Build": "bg-sdc-navy text-white", // #061D39 — anchor phase
  "Machine Testing": "bg-sdc-blue text-white", // #1574C4 — primary brand
  "Teardown & Install": "bg-sdc-green text-white", // #74C415
  Warranty: "bg-sdc-yellow text-sdc-navy", // #FFDE51 (dark text for contrast)
};
// Row height / column width density controls (GridZoomControls, in the
// toolbar) work by setting --quoted-row-py/--quoted-col-px on the document
// root. Row height applies to every body cell uniformly (they're already a
// consistent py-1.5 today, so nothing changes until a user clicks +/-).
// Column width only targets cells marked with the "qc" ("quoted column")
// class below — the repeated per-section header/data columns, which are
// already a consistent px-1 — deliberately excluding the sticky #/Job Id/Job/
// Cost columns (own fixed widths) and the optional metadata columns
// (Customer/Type/Status/Dates, px-2) and phase/group banner headers, whose
// padding isn't a "column width" in the same sense.
const ZOOM_CONTROLS = "[&_td]:py-[var(--quoted-row-py,6px)] [&_.qc]:px-[var(--quoted-col-px,4px)]";

// Group sub-bands: lighter SDC brand tints, each distinct, all drawn from the
// brand palette (blue/green/yellow tints + light blue), with one bold brand
// blue for the large General Engineering block so it reads as its own zone.
const GROUP_HEADER_COLOR: Record<string, string> = {
  PM: "bg-sdc-gray-100 text-sdc-navy", // neutral brand gray
  ME: "bg-sdc-blue-light text-sdc-navy", // #e6f0fa
  CE: "bg-sdc-green-bg text-sdc-navy", // #eef7de
  "General Engineering": "bg-sdc-blue text-white", // #1574C4
  Shop: "bg-sdc-yellow-bg text-sdc-navy", // #fff6d6
  Engineering: "bg-sdc-blue-100 text-sdc-navy", // #aacee8
};
// Full names for the department abbreviations above — only defined where the
// header actually abbreviates something ("General Engineering"/"Shop"/
// "Engineering" are already spelled out).
const GROUP_FULL_NAME: Record<string, string> = {
  PM: "Project Management",
  ME: "Mechanical Engineering",
  CE: "Controls Engineering",
};

// Consecutive runs of the same group within a phase's visible sections, for
// the group-band row's colSpans (mirrors PHASE_GROUPS but re-derived per
// request since visibility is filtered live via the `cols` param).
function groupRuns(sections: { code: string; group: string }[]) {
  const runs: { group: string; count: number }[] = [];
  for (const s of sections) {
    const last = runs[runs.length - 1];
    if (last && last.group === s.group) last.count += 1;
    else runs.push({ group: s.group, count: 1 });
  }
  return runs;
}

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
// Un-rounded counterpart to wholeHours() above, for tooltips — in case a
// stored hours value ever carries a fraction.
function exactHours(n: unknown): string | undefined {
  if (n == null) return undefined;
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

const SORT_KEYS = ["jobId", "status", "startDate", "completeDate"] as const;
type SortKey = (typeof SORT_KEYS)[number];

const BILLABLE_OPTIONS = ["Billable", "Non-Billable"];

// Info columns the "Columns" dropdown can show/hide. # and Job Id always
// show (row identity); phase section columns have their own phase pickers;
// the two Cost columns are the grid's whole point, so neither is toggleable.
const TOGGLE_COLUMNS = [
  { key: "job", label: "Job" },
  { key: "customer", label: "Customer" },
  { key: "type", label: "Type" },
  { key: "billable", label: "Billable" },
  { key: "status", label: "Status" },
  { key: "startDate", label: "Start Date" },
  { key: "completeDate", label: "Complete Date" },
] as const;

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
    hide?: string;
  }>;
}) {
  const { cols, sort, dir, customers, types, statuses, billables, hide } = await searchParams;
  // Column show/hide — `hide` is a comma-separated list of hidden column
  // keys (absent = all shown). Drives the "Columns" dropdown.
  const hiddenCols = new Set((hide ?? "").split(",").filter(Boolean));
  const show = (key: string) => !hiddenCols.has(key);
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

  // Prisma `in` never matches NULL, so a plain customer `in` filter would
  // permanently hide any job with no Customer set — including one just added
  // on this very page (saveNewRows allows a blank Customer). With no filter
  // active, null-customer jobs must show; with a filter active they're
  // excluded like any other non-selected value.
  const customerWhere =
    customers === undefined
      ? {} // no filter -> all jobs, including customer = null
      : { customer: { in: selectedCustomers } };

  const jobs = await prisma.job.findMany({
    where: {
      type: { in: selectedTypes },
      ...customerWhere,
      status: { in: selectedStatuses },
      ...billableWhere,
    },
    // etcEntries (unfiltered by month) is how "actual hours" gets built below:
    // a closed/historical job's real total lives entirely in
    // estimatedHours.actualHistoricalHours (an Excel-migration snapshot, never
    // touched again once EtcEntry rows exist for it — see sync-powerbi.ts),
    // while an actively ETC-tracked job's total is the sum of every month's
    // hoursWorked instead. The two never overlap for the same job, so adding
    // them is always safe.
    include: { estimatedHours: true, etcEntries: { select: { section: true, hoursWorked: true } } },
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

  // Total visible data columns: for each phase, its visible sections + 1 total
  // column (Machine Testing only — the other phases don't show a Total column),
  // or just 1 column if every section in that phase is hidden.
  const dataColumnCount = PHASE_GROUPS.reduce((sum, g) => {
    const visible = visibleSectionsByPhase.get(g.phase) ?? [];
    const hasTotalCol = g.phase === "Machine Testing";
    return sum + (visible.length ? visible.length + (hasTotalCol ? 1 : 0) : 1);
  }, 0);

  return (
    <form action={saveQuotedHours} className="w-full px-8 py-10 md:px-13 md:py-11">
      <div className="mb-1 flex items-end justify-between gap-4">
        <PageTitle>Projects</PageTitle>
        <div className="flex items-center gap-2.5">
          <NewFromReleaseButton className={BUTTON_SECONDARY} />
          <AddProjectButton className={BUTTON_PRIMARY} />
          <button type="submit" className={BUTTON_PRIMARY}>
            Save Quoted Hours
          </button>
        </div>
      </div>
      <p className="mb-2 text-sm text-sdc-gray-600">
        {jobs.length} jobs — quoted hours by section, quoted vs. actual cost. Click a phase to choose which section columns to show.
      </p>
      <p className="mb-5 flex items-center gap-4 text-xs text-sdc-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="font-mono font-semibold text-sdc-blue-dark">000</span> = Quoted hours
        </span>
        <span className="text-sdc-gray-400">/</span>
        <span className="flex items-center gap-1.5">
          <span className="font-mono font-semibold text-sdc-green-text">000</span> = Actual hours
        </span>
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
        <ColumnToggle columns={[...TOGGLE_COLUMNS]} hidden={[...hiddenCols]} />
        <GridZoomControls
          rowVar="--quoted-row-py"
          colVar="--quoted-col-px"
          rowStorageKey="quoted-grid-row-py"
          colStorageKey="quoted-grid-col-px"
          defaultRowPx={6}
          defaultColPx={4}
        />
      </div>

      <div className="max-h-[calc(100vh-220px)] min-w-[480px] overflow-auto rounded-xl border border-sdc-border bg-white shadow-sm select-none styled-scrollbar">
        <table className={`text-sm ${TABLE_GRID} ${ZOOM_CONTROLS}`}>
          <thead className="sticky top-0 z-20 bg-sdc-gray-100">
            <tr className={TABLE_HEADER_ROW}>
              <th rowSpan={3} className="sticky left-0 z-10 w-8 min-w-8 bg-sdc-gray-100 px-1 py-2 text-center align-bottom">
                #
              </th>
              <th rowSpan={3} className="sticky left-8 z-10 w-20 min-w-20 max-w-20 overflow-hidden truncate bg-sdc-gray-100 px-2 py-2 align-bottom">
                <SortButton sortKey="jobId" label="Job Id" currentSort={sortKey} currentDir={sortDir} />
              </th>
              {show("job") && (
                <th
                  rowSpan={3}
                  style={{ width: "var(--job-col-width, 280px)", minWidth: "var(--job-col-width, 280px)" }}
                  className="sticky left-[112px] z-10 border-l border-r border-sdc-border bg-sdc-gray-100 px-2 py-2 align-bottom"
                >
                  Job
                  <div
                    className="col-resize-handle absolute right-0 inset-y-0 z-10 w-3"
                    data-resize-var="--job-col-width"
                    data-resize-min="160"
                    data-resize-max="640"
                    title="Drag to resize"
                    style={{ touchAction: "none" }}
                  />
                </th>
              )}
              {show("customer") && (
                <th
                  rowSpan={3}
                  style={{ width: "var(--customer-col-width, 120px)", minWidth: "var(--customer-col-width, 120px)" }}
                  className="relative px-2 py-2 align-bottom"
                >
                  Customer
                  <div
                    className="col-resize-handle absolute right-0 inset-y-0 z-10 w-3"
                    data-resize-var="--customer-col-width"
                    data-resize-min="80"
                    data-resize-max="400"
                    title="Drag to resize"
                    style={{ touchAction: "none" }}
                  />
                </th>
              )}
              {show("type") && (
                <th rowSpan={3} className="px-2 py-2 align-bottom">
                  Type
                </th>
              )}
              {show("billable") && (
                <th rowSpan={3} className="px-2 py-2 align-bottom">
                  Billable
                </th>
              )}
              {show("status") && (
                <th rowSpan={3} className="px-2 py-2 align-bottom">
                  <SortButton sortKey="status" label="Status" currentSort={sortKey} currentDir={sortDir} />
                </th>
              )}
              {show("startDate") && (
                <th rowSpan={3} className="px-2 py-2 align-bottom">
                  <SortButton sortKey="startDate" label="Start Date" currentSort={sortKey} currentDir={sortDir} />
                </th>
              )}
              {show("completeDate") && (
                <th rowSpan={3} className="px-2 py-2 align-bottom">
                  <SortButton sortKey="completeDate" label="Complete Date" currentSort={sortKey} currentDir={sortDir} />
                </th>
              )}
              {PHASE_GROUPS.map((g) => {
                const visible = visibleSectionsByPhase.get(g.phase) ?? [];
                const color = PHASE_HEADER_COLOR[g.phase] ?? "bg-sdc-blue-light";
                const hasTotalCol = g.phase === "Machine Testing";
                return visible.length ? (
                  <th
                    key={g.phase}
                    colSpan={visible.length + (hasTotalCol ? 1 : 0)}
                    className={`border-l border-sdc-border px-2 py-2 text-center italic ${color}`}
                  >
                    {g.phase}
                  </th>
                ) : (
                  <th
                    key={g.phase}
                    className={`border-l border-sdc-border px-1.5 py-2 text-center align-bottom italic ${color}`}
                    rowSpan={3}
                  >
                    {g.phase}
                  </th>
                );
              })}
              <th rowSpan={3} className="min-w-[90px] border-l border-sdc-border bg-sdc-green-bg px-2 py-2 text-center align-bottom text-sdc-green-text">
                Cost Quoted
              </th>
              <th rowSpan={3} className="min-w-[90px] bg-sdc-green-bg px-2 py-2 text-center align-bottom text-sdc-green-text">
                Cost Actual Historical
              </th>
            </tr>
            <tr className={TABLE_HEADER_ROW}>
              {PHASE_GROUPS.flatMap((g) => {
                const sections = visibleSectionsByPhase.get(g.phase) ?? [];
                if (!sections.length) return [];
                const groupHeaders = groupRuns(sections).map((run, i) => (
                  <th
                    key={`${g.phase}-group-${i}`}
                    colSpan={run.count}
                    title={GROUP_FULL_NAME[run.group]}
                    className={`qc border-l border-sdc-border px-1 py-1.5 text-center text-[10px] italic ${
                      GROUP_HEADER_COLOR[run.group] ?? ""
                    }`}
                  >
                    {run.group}
                  </th>
                ));
                if (g.phase !== "Machine Testing") return groupHeaders;
                return [
                  ...groupHeaders,
                  <th
                    key={`${g.phase}-total`}
                    rowSpan={2}
                    className="qc w-[78px] min-w-[78px] border-l border-sdc-border bg-sdc-blue-light px-1 py-2 text-center align-bottom text-[10px] text-sdc-blue-dark"
                  >
                    Total
                  </th>,
                ];
              })}
            </tr>
            <tr className={TABLE_HEADER_ROW}>
              {PHASE_GROUPS.flatMap((g) => {
                const sections = visibleSectionsByPhase.get(g.phase) ?? [];
                return sections.map((s) => (
                  <th key={s.code} title={s.code} className="qc w-[78px] min-w-[78px] border-l border-sdc-border px-1 py-2 text-center text-[10px] leading-tight">
                    {s.name}
                    <span className="block font-mono text-[10px] font-normal normal-case tracking-normal text-sdc-gray-400">
                      {s.code}
                    </span>
                  </th>
                ));
              })}
            </tr>
          </thead>
          <tbody>
            <NewProjectRows
              hidden={[...hiddenCols]}
              phaseGroups={PHASE_GROUPS.map((g) => ({ phase: g.phase, sections: visibleSectionsByPhase.get(g.phase) ?? [] }))}
              allStatuses={allStatuses}
            />
            {jobs.length === 0 && (
              <tr>
                {/* 2 always-on (# + Job Id) + visible toggle columns + phase cols + 2 cost cols */}
                <td colSpan={2 + TOGGLE_COLUMNS.filter((c) => show(c.key)).length + dataColumnCount + 2} className="px-4 py-5 text-center text-sdc-gray-400">
                  No jobs found.
                </td>
              </tr>
            )}
            {jobs.map((job, i) => {
              const hoursBySection = new Map(job.estimatedHours.map((eh) => [eh.section, eh.quotedHours]));
              // Actual hours to date, per section: Excel-migration snapshot
              // (closed jobs) + everything since accumulated via ETC tracking
              // (active jobs) — see the query comment above for why these
              // two never double-count.
              const actualBySection = new Map(job.estimatedHours.map((eh) => [eh.section, Number(eh.actualHistoricalHours)]));
              for (const e of job.etcEntries) {
                actualBySection.set(e.section, (actualBySection.get(e.section) ?? 0) + Number(e.hoursWorked));
              }
              // SDC's own internal projects are always non-billable and get a
              // permanent light-blue highlight so they stand out from customer
              // work at a glance — this is driven by Customer, not the stored
              // billable flag, so it's correct even before the next save.
              const isSdc = isSdcCustomer(job.customer);
              const zebra = isSdc ? "bg-[#caedfb]" : i % 2 === 1 ? "bg-sdc-gray-50/60" : "";
              const zebraSticky = isSdc ? "bg-[#caedfb]" : i % 2 === 1 ? "bg-sdc-gray-50" : "bg-white";
              return (
                <tr key={job.id} className={`hover:bg-sdc-blue-light/40 ${zebra}`}>
                  <td className={`sticky left-0 z-10 w-8 min-w-8 px-1 py-1.5 text-center text-[10px] text-sdc-gray-400 ${zebraSticky}`}>
                    {i + 1}
                  </td>
                  <td
                    title={job.jobId}
                    className={`sticky left-8 z-10 w-20 min-w-20 max-w-20 overflow-hidden truncate px-2 py-1.5 text-center font-mono text-[10px] text-sdc-gray-500 ${zebraSticky}`}
                  >
                    {job.jobId}
                  </td>
                  {show("job") && (
                    <td
                      style={{ width: "var(--job-col-width, 280px)", minWidth: "var(--job-col-width, 280px)" }}
                      className={`sticky left-[112px] z-10 whitespace-nowrap border-l border-r border-sdc-border px-2 py-1.5 text-center text-[10px] font-medium text-sdc-navy ${zebraSticky}`}
                      title={job.jobName}
                    >
                      <input
                        type="text"
                        name={`jobField__${job.id}__jobName`}
                        defaultValue={job.jobName}
                        aria-label={`Job Name, ${job.jobName}`}
                        className="w-full min-w-0 text-center"
                      />
                    </td>
                  )}
                  {show("customer") && (
                    <td
                      style={{ width: "var(--customer-col-width, 120px)", minWidth: "var(--customer-col-width, 120px)", maxWidth: "var(--customer-col-width, 120px)" }}
                      className="overflow-hidden whitespace-nowrap px-2 py-1.5 text-center text-[10px] text-sdc-gray-600"
                      title={job.customer ?? ""}
                    >
                      <input
                        type="text"
                        name={`jobField__${job.id}__customer`}
                        defaultValue={job.customer ?? ""}
                        placeholder="—"
                        aria-label={`Customer, ${job.jobName}`}
                        className="text-center"
                      />
                    </td>
                  )}
                  {show("type") && (
                    <td className="whitespace-nowrap px-2 py-1.5 text-center text-[10px] text-sdc-gray-600">
                      <select name={`jobField__${job.id}__type`} defaultValue={job.type ?? ""} aria-label={`Type, ${job.jobName}`} className="text-center">
                        {job.type == null && <option value="">—</option>}
                        {VALID_JOB_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  {show("billable") && (
                    <td className="whitespace-nowrap px-2 py-1.5 text-center text-[10px]">
                      {isSdc ? (
                        <span className="text-sdc-gray-500" aria-label={`Billable, ${job.jobName}`} title="SDC's own projects are always non-billable">
                          Non-Billable
                        </span>
                      ) : (
                        <select
                          name={`jobField__${job.id}__billable`}
                          defaultValue={job.billable ? "Billable" : "Non-Billable"}
                          aria-label={`Billable, ${job.jobName}`}
                          className={`text-center ${job.billable ? "text-sdc-green-text" : "text-sdc-gray-500"}`}
                        >
                          <option value="Billable">Billable</option>
                          <option value="Non-Billable">Non-Billable</option>
                        </select>
                      )}
                    </td>
                  )}
                  {show("status") && (
                    <td
                      className={`whitespace-nowrap px-2 py-1.5 text-center text-[10px] font-medium ${
                        job.status === "Complete" ? "text-sdc-green-text" : "text-sdc-blue-dark"
                      }`}
                    >
                      <select
                        name={`jobField__${job.id}__status`}
                        defaultValue={job.status}
                        aria-label={`Status, ${job.jobName}`}
                        className="text-center"
                      >
                        {allStatuses.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  {show("startDate") && (
                    <td className="whitespace-nowrap px-2 py-1.5 text-center text-[10px] text-sdc-gray-500">
                      <DateCell
                        name={`jobField__${job.id}__startDate`}
                        defaultValue={dateInputValue(job.startDate)}
                        ariaLabel={`Start Date, ${job.jobName}`}
                      />
                    </td>
                  )}
                  {show("completeDate") && (
                    <td className="whitespace-nowrap px-2 py-1.5 text-center text-[10px] text-sdc-gray-500">
                      <DateCell
                        name={`jobField__${job.id}__completeDate`}
                        defaultValue={dateInputValue(job.completeDate)}
                        ariaLabel={`Complete Date, ${job.jobName}`}
                      />
                    </td>
                  )}
                  {PHASE_GROUPS.map((g) => {
                    const allSections = SECTIONS.filter((s) => s.phase === g.phase);
                    const visibleSections = visibleSectionsByPhase.get(g.phase) ?? [];
                    const total = allSections.reduce((sum, s) => sum + Number(hoursBySection.get(s.code) ?? 0), 0);
                    const actualTotal = allSections.reduce((sum, s) => sum + (actualBySection.get(s.code) ?? 0), 0);
                    if (!visibleSections.length) {
                      return (
                        <td
                          key={g.phase}
                          className="whitespace-nowrap border-l border-sdc-border px-1 py-1.5 text-center font-mono text-[10px] text-sdc-gray-600"
                          title={`Quoted ${exactHours(total) ?? "0"} / Actual ${exactHours(actualTotal) ?? "0"}`}
                        >
                          <span className="font-semibold text-sdc-blue-dark">{wholeHours(total)}</span>
                          <span className="text-sdc-gray-400"> / </span>
                          <span className="font-semibold text-sdc-green-text">{wholeHours(actualTotal)}</span>
                        </td>
                      );
                    }
                    return (
                      <Fragment key={g.phase}>
                        {visibleSections.map((s) => {
                          const hours = hoursBySection.get(s.code);
                          const actual = actualBySection.get(s.code) ?? 0;
                          return (
                            <td
                              key={s.code}
                              className="qc quoted-actual-cell border-l border-sdc-border px-1 py-1.5 text-center font-mono text-[10px] text-sdc-gray-600"
                              title={`Quoted ${exactHours(hours) ?? "0"} / Actual ${exactHours(actual) ?? "0"}`}
                            >
                              <input
                                type="number"
                                step="1"
                                min="0"
                                name={`quoted__${job.id}__${s.code}`}
                                defaultValue={hours != null ? Math.round(Number(hours)).toString() : ""}
                                placeholder="—"
                                aria-label={`Quoted hours, ${job.jobName}, ${s.name}`}
                                className="text-center font-semibold text-sdc-blue-dark"
                              />
                              <span className="actual-suffix text-sdc-gray-400">
                                /<span className="font-semibold text-sdc-green-text">{wholeHours(actual)}</span>
                              </span>
                            </td>
                          );
                        })}
                        {g.phase === "Machine Testing" && (
                          <td
                            className="qc whitespace-nowrap border-l border-sdc-border bg-sdc-blue-light px-1 py-1.5 text-center font-mono text-[10px] font-medium"
                            title={`Quoted ${exactHours(total) ?? "0"} / Actual ${exactHours(actualTotal) ?? "0"}`}
                          >
                            <span className="font-semibold text-sdc-blue-dark">{wholeHours(total)}</span>
                            <span className="text-sdc-gray-400"> / </span>
                            <span className="font-semibold text-sdc-green-text">{wholeHours(actualTotal)}</span>
                          </td>
                        )}
                      </Fragment>
                    );
                  })}
                  <td className={`whitespace-nowrap border-l border-sdc-border px-2 py-1.5 text-center text-[10px] font-medium text-sdc-navy ${zebra}`}>
                    <div className="flex items-center justify-center gap-0.5">
                      <span className="text-sdc-gray-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        name={`jobField__${job.id}__costQuoted`}
                        defaultValue={job.costQuoted != null ? Number(job.costQuoted).toString() : ""}
                        placeholder="—"
                        aria-label={`Cost Quoted, ${job.jobName}`}
                        className="w-full min-w-0 border-none bg-transparent text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </div>
                  </td>
                  <td className={`whitespace-nowrap border-l border-sdc-border px-2 py-1.5 text-center text-[10px] text-sdc-gray-600 ${zebra}`}>
                    <div className="flex items-center justify-center gap-0.5">
                      <span className="text-sdc-gray-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        name={`jobField__${job.id}__costActualHistorical`}
                        defaultValue={job.costActualHistorical != null ? Number(job.costActualHistorical).toString() : ""}
                        placeholder="—"
                        aria-label={`Cost Actual, ${job.jobName}`}
                        className="w-full min-w-0 border-none bg-transparent text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </form>
  );
}
