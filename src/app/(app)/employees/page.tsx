import { prisma } from "@/lib/prisma";
import { PageTitle } from "@/components/ui/Typography";
import { SyncSchedulerTeamButton } from "@/components/SyncSchedulerTeamButton";
import { ImportSupervisorsButton } from "@/components/ImportSupervisorsButton";
import { ReconcileRosterButton } from "@/components/ReconcileRosterButton";
import { EmployeesGrid } from "@/components/EmployeesGrid";
import type { EmployeeRow } from "@/components/EmployeesGridInner";

// Team groupings, matching the SDC Scheduler app's team_members.discipline
// categories. Now a sortable AG Grid column (Community can't do row grouping).
const DISCIPLINES = ["Project Management", "Mechanical Engineers", "Controls Engineers", "Builders", "Electricians"];
const DASH = "—";

// Replaces the "Employees" tab of Project Planner Data Control.xlsx.
// Soft-delete only: deactivating keeps every historical hour intact.
export default async function EmployeesPage() {
  const employees = await prisma.employee.findMany({
    orderBy: [{ discipline: "asc" }, { name: "asc" }],
  });

  // id → name across the WHOLE roster so a supervisor who's inactive still
  // resolves; active employees drive the supervisor dropdown.
  const nameById = new Map(employees.map((e) => [e.id, e.name]));
  const supervisors = employees
    .filter((e) => e.active)
    .map((e) => ({ id: e.id, name: e.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const rows: EmployeeRow[] = employees.map((e) => ({
    id: e.id,
    name: e.name,
    discipline: DISCIPLINES.includes(e.discipline ?? "") ? (e.discipline as string) : DASH,
    supervisor: e.supervisorId != null ? (nameById.get(e.supervisorId) ?? DASH) : DASH,
    department: e.department ?? "",
    active: e.active,
    billingGroup: e.billingGroup ?? "",
    paylocityId: e.paylocityId ?? "",
  }));

  return (
    <div className="w-full px-8 py-10 md:px-13 md:py-11">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle className="mb-1">Employees</PageTitle>
          <p className="text-sm text-sdc-gray-600">
            Replaces the Project Planner workbook&apos;s Employees tab. Deactivated employees keep all historical hours. Edit a cell, then Save the row.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ReconcileRosterButton />
          <ImportSupervisorsButton />
          <SyncSchedulerTeamButton />
        </div>
      </div>

      <div className="mt-5">
        <EmployeesGrid rows={rows} disciplines={DISCIPLINES} supervisors={supervisors} />
      </div>
    </div>
  );
}
