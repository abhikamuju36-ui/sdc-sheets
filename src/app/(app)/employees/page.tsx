import { Fragment } from "react";
import { prisma } from "@/lib/prisma";
import { createEmployee, updateEmployee, setEmployeeActive } from "@/lib/employee-actions";
import { PageTitle } from "@/components/ui/Typography";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { card, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT, LABEL, TABLE_HEADER_ROW, TABLE_ROW_HOVER, TABLE_GRID, TABLE_CARD } from "@/components/ui/classnames";

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

  const cellInput = `${INPUT} w-full px-2 py-1 text-xs`;

  return (
    <div className="w-full max-w-5xl p-8">
      <PageTitle className="mb-1">Employees</PageTitle>
      <p className="mb-6 text-sm text-sdc-gray-600">
        {`Replaces the Project Planner workbook's Employees tab. ${activeCount} active${showInactive ? `, ${employees.length - activeCount} inactive shown` : ""}. Deactivated employees keep all historical hours.`}
      </p>

      {/* Add */}
      <form action={createEmployee} className={`${card()} mb-6`}>
        <p className="mb-3 text-sm font-semibold text-sdc-navy">Add employee</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Name *</span>
            <input name="name" required className={INPUT} placeholder="Full name" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Department</span>
            <input name="department" className={INPUT} placeholder="e.g. Controls Engineering" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Billing group</span>
            <select name="billingGroup" defaultValue="" className={INPUT}>
              <option value="">—</option>
              <option value="Engineering">Engineering</option>
              <option value="Shop">Shop</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Paylocity ID</span>
            <input name="paylocityId" className={INPUT} placeholder="optional" />
          </label>
          <button type="submit" className={BUTTON_PRIMARY}>
            Add
          </button>
        </div>
      </form>

      {/* Search / filter */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form className="flex items-center gap-2">
          {showInactive && <input type="hidden" name="show" value="inactive" />}
          <input name="q" defaultValue={q} placeholder="Search name…" className={INPUT} />
          <button type="submit" className={BUTTON_SECONDARY}>
            Search
          </button>
        </form>
        <a
          href={showInactive ? `/employees${q ? `?q=${encodeURIComponent(q)}` : ""}` : `/employees?show=inactive${q ? `&q=${encodeURIComponent(q)}` : ""}`}
          className="text-xs text-sdc-blue underline hover:text-sdc-blue-dark"
        >
          {showInactive ? "Hide inactive" : "Show inactive"}
        </a>
      </div>

      {/* List — row edit forms live outside the table (HTML forbids <form> in <tr>), linked via the form attribute. */}
      <div className={TABLE_CARD}>
        <table className={`w-full text-sm ${TABLE_GRID}`}>
          <thead>
            <tr className={TABLE_HEADER_ROW}>
              <th className="px-4 py-3">Name</th>
              <th className="px-3 py-3">Department</th>
              <th className="px-3 py-3">Billing group</th>
              <th className="px-3 py-3">Paylocity ID</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e, i) => (
              <tr key={e.id} className={`${TABLE_ROW_HOVER} ${i % 2 === 1 ? "bg-sdc-gray-50/60" : ""}`}>
                <td className="px-4 py-2">
                  <input name="name" defaultValue={e.name} required form={`emp-${e.id}`} className={cellInput} aria-label={`Name, ${e.name}`} />
                </td>
                <td className="px-3 py-2">
                  <input name="department" defaultValue={e.department ?? ""} form={`emp-${e.id}`} className={cellInput} aria-label={`Department, ${e.name}`} />
                </td>
                <td className="px-3 py-2">
                  <select name="billingGroup" defaultValue={e.billingGroup ?? ""} form={`emp-${e.id}`} className={cellInput} aria-label={`Billing group, ${e.name}`}>
                    <option value="">—</option>
                    <option value="Engineering">Engineering</option>
                    <option value="Shop">Shop</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input name="paylocityId" defaultValue={e.paylocityId ?? ""} form={`emp-${e.id}`} className={`${cellInput} font-mono`} aria-label={`Paylocity ID, ${e.name}`} />
                </td>
                <td className="px-3 py-2">
                  <StatusBadge variant={e.active ? "active" : "neutral"}>{e.active ? "Active" : "Inactive"}</StatusBadge>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <button type="submit" form={`emp-${e.id}`} className={`${BUTTON_SECONDARY} px-2.5 py-1 text-xs`}>
                      Save
                    </button>
                    <button
                      type="submit"
                      form={`emp-toggle-${e.id}`}
                      className={`${BUTTON_SECONDARY} px-2.5 py-1 text-xs ${e.active ? "text-red-700" : ""}`}
                    >
                      {e.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-5 text-sdc-gray-400">
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
