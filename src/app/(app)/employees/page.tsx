import { Fragment } from "react";
import { prisma } from "@/lib/prisma";
import { updateEmployee, setEmployeeActive } from "@/lib/employee-actions";
import { PageTitle } from "@/components/ui/Typography";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { BUTTON_SECONDARY, INPUT, TABLE_HEADER_ROW, TABLE_GRID } from "@/components/ui/classnames";
import { SyncSchedulerTeamButton } from "@/components/SyncSchedulerTeamButton";

// Team groupings, matching the SDC Scheduler app's team_members.discipline
// categories exactly (pm/mech/controls/build/wire) so the two apps read the
// same way. Order here is the display order; "Unassigned" (anyone with no
// discipline set, or an old free-text value that's since drifted) always
// sorts last.
const DISCIPLINES = ["Project Management", "Mechanical Engineers", "Controls Engineers", "Builders", "Electricians"] as const;
const UNASSIGNED = "Unassigned";
const DISCIPLINE_COLOR: Record<string, string> = {
  "Project Management": "bg-[#EDE7F6] text-[#5B3E96]",
  "Mechanical Engineers": "bg-[#DCEAFB] text-[#2A5A8C]",
  "Controls Engineers": "bg-[#DEF3E3] text-[#2E7D4F]",
  Builders: "bg-[#FBE6D4] text-[#96591A]",
  Electricians: "bg-[#FBF3C7] text-[#8A6D00]",
  [UNASSIGNED]: "bg-sdc-gray-100 text-sdc-gray-500",
};

// Replaces the "Employees" tab of Project Planner Data Control.xlsx.
// Soft-delete only: deactivating keeps every historical hour intact.
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; show?: string }>;
}) {
  const { q, show } = await searchParams;
  const showInactive = show === "inactive";

  const employees = await prisma.employee.findMany({
    where: {
      active: showInactive ? undefined : true,
      ...(q ? { name: { contains: q } } : {}),
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  const activeCount = employees.filter((e) => e.active).length;

  // Grouped for display — fixed discipline order, "Unassigned" last, empty
  // groups skipped. Each employee's own active/name ordering from the query
  // above is preserved within its group.
  const groups = [...DISCIPLINES, UNASSIGNED]
    .map((label) => ({
      label,
      employees: employees.filter((e) => (label === UNASSIGNED ? !e.discipline || !DISCIPLINES.includes(e.discipline as (typeof DISCIPLINES)[number]) : e.discipline === label)),
    }))
    .filter((g) => g.employees.length > 0);

  const cellInput = `${INPUT} w-full px-2.5 py-1.5 text-[10px]`;
  const HEADERS = ["#", "Name", "Discipline", "Department", "Status", "Actions"];
  const COL_COUNT = HEADERS.length;

  return (
    <div className="w-full px-8 py-10 md:px-13 md:py-11">
      <PageTitle className="mb-1">Employees</PageTitle>
      <p className="mb-7 text-sm text-sdc-gray-600">
        {`Replaces the Project Planner workbook's Employees tab. ${activeCount} active${showInactive ? `, ${employees.length - activeCount} inactive shown` : ""}. Deactivated employees keep all historical hours.`}
      </p>

      {/* Search / filter */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <form className="flex items-center gap-2.5">
          {showInactive && <input type="hidden" name="show" value="inactive" />}
          <div className="flex items-center gap-2.5 rounded-lg border border-sdc-border bg-white px-3.5">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sdc-gray-400">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              name="q"
              defaultValue={q}
              placeholder="Search name…"
              className="border-none bg-transparent py-2.5 text-sm text-sdc-navy outline-none placeholder:text-sdc-gray-400"
            />
          </div>
          <button type="submit" className={BUTTON_SECONDARY}>
            Search
          </button>
        </form>
        <a
          href={showInactive ? `/employees${q ? `?q=${encodeURIComponent(q)}` : ""}` : `/employees?show=inactive${q ? `&q=${encodeURIComponent(q)}` : ""}`}
          className="rounded-lg bg-sdc-gray-100 px-3.5 py-2 text-xs font-semibold text-sdc-gray-600 transition-colors hover:text-sdc-navy"
        >
          {showInactive ? "Hide inactive" : "Show inactive"}
        </a>
        <div className="ml-auto">
          <SyncSchedulerTeamButton />
        </div>
      </div>

      {/* List — a real table (not the old ad-hoc CSS-grid rows), matching the
          spreadsheet-grid look used on Quoted/Monthly ETC. Row edit forms live
          outside the table (HTML forbids <form> in <tr>), linked via the form
          attribute. */}
      <div className="max-h-[calc(100vh-220px)] overflow-auto rounded-xl border border-sdc-border bg-white shadow-sm styled-scrollbar">
        <table className={`w-full text-sm ${TABLE_GRID}`}>
          <thead className="sticky top-0 z-20 bg-sdc-gray-100">
            <tr className={TABLE_HEADER_ROW}>
              {HEADERS.map((h) => (
                <th key={h} className="px-3 py-2.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(() => {
              let rowNumber = 0;
              return groups.map((group) => (
                <Fragment key={group.label}>
                  <tr>
                    <td colSpan={COL_COUNT} className={`px-3 py-1.5 text-xs font-semibold ${DISCIPLINE_COLOR[group.label] ?? "bg-sdc-gray-100 text-sdc-gray-500"}`}>
                      {group.label} <span className="font-normal opacity-70">· {group.employees.length}</span>
                    </td>
                  </tr>
                  {group.employees.map((e, i) => {
                    rowNumber++;
                    const zebra = i % 2 === 1 ? "bg-sdc-gray-50/60" : "";
                    return (
                      <tr key={e.id} className={`transition-colors hover:bg-sdc-blue-light/30 ${zebra}`}>
                        <td className="px-3 py-1.5 text-center text-[10px] text-sdc-gray-400 tabular-nums">{rowNumber}</td>
                        <td className="px-3 py-1.5">
                          <input name="name" defaultValue={e.name} required form={`emp-${e.id}`} className={`${cellInput} text-center`} aria-label={`Name, ${e.name}`} />
                          {/* Not shown in the table but still owned by this row's Save —
                              hidden so an unrelated edit (e.g. Discipline) can't wipe them. */}
                          <input type="hidden" name="billingGroup" defaultValue={e.billingGroup ?? ""} form={`emp-${e.id}`} />
                          <input type="hidden" name="paylocityId" defaultValue={e.paylocityId ?? ""} form={`emp-${e.id}`} />
                        </td>
                        <td className="px-3 py-1.5">
                          <select name="discipline" defaultValue={e.discipline ?? ""} form={`emp-${e.id}`} className={`${cellInput} text-center`} aria-label={`Discipline, ${e.name}`}>
                            <option value="">—</option>
                            {DISCIPLINES.map((d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-1.5">
                          <input name="department" defaultValue={e.department ?? ""} form={`emp-${e.id}`} className={`${cellInput} text-center`} aria-label={`Department, ${e.name}`} />
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex justify-center">
                            <StatusBadge variant={e.active ? "active" : "neutral"} style={{ fontSize: "10px" }}>
                              {e.active ? "Active" : "Inactive"}
                            </StatusBadge>
                          </div>
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex justify-center gap-2">
                            <button type="submit" form={`emp-${e.id}`} className="rounded-md border border-sdc-border px-2.5 py-1 text-[10px] font-semibold text-sdc-navy transition-colors hover:bg-sdc-blue-light">
                              Save
                            </button>
                            <button
                              type="submit"
                              form={`emp-toggle-${e.id}`}
                              className={
                                e.active
                                  ? "rounded-md border border-[#F0D6D6] px-2.5 py-1 text-[10px] font-semibold text-[#B03A3A] transition-colors hover:bg-[#FBEDED]"
                                  : "rounded-md border border-sdc-border px-2.5 py-1 text-[10px] font-semibold text-sdc-navy transition-colors hover:bg-sdc-blue-light"
                              }
                            >
                              {e.active ? "Deactivate" : "Reactivate"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ));
            })()}
            {employees.length === 0 && (
              <tr>
                <td colSpan={COL_COUNT} className="px-4 py-5 text-center text-sdc-gray-400">
                  No employees found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {employees.map((e) => (
        <Fragment key={e.id}>
          <form id={`emp-${e.id}`} action={updateEmployee.bind(null, e.id)} />
          <form id={`emp-toggle-${e.id}`} action={setEmployeeActive.bind(null, e.id, !e.active)} />
        </Fragment>
      ))}
    </div>
  );
}
