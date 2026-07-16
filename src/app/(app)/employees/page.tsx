import { Fragment } from "react";
import { prisma } from "@/lib/prisma";
import { createEmployee, updateEmployee, setEmployeeActive } from "@/lib/employee-actions";
import { PageTitle } from "@/components/ui/Typography";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { card, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT, LABEL } from "@/components/ui/classnames";

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

  const cellInput = `${INPUT} w-full px-2.5 py-1.5 text-[10px]`;
  const GRID_COLS = "grid-cols-[40px_minmax(160px,1fr)_180px_150px_140px_110px_170px]";

  return (
    <div className="w-full max-w-[1280px] px-8 py-10 md:px-13 md:py-11">
      <PageTitle className="mb-1">Employees</PageTitle>
      <p className="mb-7 text-sm text-sdc-gray-600">
        {`Replaces the Project Planner workbook's Employees tab. ${activeCount} active${showInactive ? `, ${employees.length - activeCount} inactive shown` : ""}. Deactivated employees keep all historical hours.`}
      </p>

      {/* Add */}
      <form action={createEmployee} className={`${card("p-6")} mb-6`}>
        <p className="mb-3.5 text-sm font-semibold text-sdc-navy">Add employee</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Name *</span>
            <input name="name" required className={INPUT} placeholder="Full name" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Department</span>
            <input name="department" className={INPUT} placeholder="e.g. Controls Engineering" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Billing group</span>
            <select name="billingGroup" defaultValue="" className={INPUT}>
              <option value="">—</option>
              <option value="Engineering">Engineering</option>
              <option value="Shop">Shop</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Paylocity ID</span>
            <input name="paylocityId" className={INPUT} placeholder="optional" />
          </label>
          <button type="submit" className={BUTTON_PRIMARY}>
            Add
          </button>
        </div>
      </form>

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
      </div>

      {/* List — row edit forms live outside the grid (HTML forbids <form> in <tr>), linked via the form attribute. */}
      <div className={`${card("p-0")} overflow-x-auto`}>
        <div className={`grid ${GRID_COLS} min-w-[1080px] items-center gap-4 border-b border-sdc-border-soft bg-sdc-gray-50/60 px-6 py-3`}>
          {["#", "Name", "Department", "Billing group", "Paylocity ID", "Status", "Actions"].map((h) => (
            <span key={h} className="text-center text-[10px] font-semibold tracking-wider text-sdc-gray-400 uppercase">
              {h}
            </span>
          ))}
        </div>
        <div className="divide-y divide-sdc-border-soft">
          {employees.map((e, i) => (
            <div key={e.id} className={`grid ${GRID_COLS} min-w-[1080px] items-center gap-4 px-6 py-2.5 transition-colors hover:bg-sdc-blue-light/30`}>
              <span className="text-center text-[10px] text-sdc-gray-400 tabular-nums">{i + 1}</span>
              <input name="name" defaultValue={e.name} required form={`emp-${e.id}`} className={`${cellInput} text-center`} aria-label={`Name, ${e.name}`} />
              <input name="department" defaultValue={e.department ?? ""} form={`emp-${e.id}`} className={`${cellInput} text-center`} aria-label={`Department, ${e.name}`} />
              <select name="billingGroup" defaultValue={e.billingGroup ?? ""} form={`emp-${e.id}`} className={`${cellInput} text-center`} aria-label={`Billing group, ${e.name}`}>
                <option value="">—</option>
                <option value="Engineering">Engineering</option>
                <option value="Shop">Shop</option>
              </select>
              <input name="paylocityId" defaultValue={e.paylocityId ?? ""} form={`emp-${e.id}`} className={`${cellInput} text-center font-mono`} aria-label={`Paylocity ID, ${e.name}`} />
              <div className="flex justify-center">
                <StatusBadge variant={e.active ? "active" : "neutral"} style={{ fontSize: "10px" }}>
                  {e.active ? "Active" : "Inactive"}
                </StatusBadge>
              </div>
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
            </div>
          ))}
          {employees.length === 0 && <p className="px-6 py-5 text-sm text-sdc-gray-400">No employees found.</p>}
        </div>
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
