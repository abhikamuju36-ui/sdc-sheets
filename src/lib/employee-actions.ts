"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { syncSchedulerTeam, type TeamSyncResult } from "@/lib/sync-scheduler-team";

// Employees are NEVER hard-deleted — departed people keep their historical
// hours (Dan's requirement). Deactivate/reactivate only.

function readEmployeeForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Employee name is required.");

  const department = String(formData.get("department") ?? "").trim() || null;
  const billingGroup = String(formData.get("billingGroup") ?? "").trim() || null;
  const discipline = String(formData.get("discipline") ?? "").trim() || null;
  const paylocityId = String(formData.get("paylocityId") ?? "").trim() || null;
  return { name, department, billingGroup, discipline, paylocityId };
}

export async function createEmployee(formData: FormData) {
  const data = readEmployeeForm(formData);

  if (data.paylocityId) {
    const existing = await prisma.employee.findUnique({ where: { paylocityId: data.paylocityId } });
    if (existing) {
      throw new Error(`Paylocity ID ${data.paylocityId} already belongs to ${existing.name}${existing.active ? "" : " (inactive — reactivate them instead)"}.`);
    }
  }

  const employee = await prisma.employee.create({ data });
  await logAudit({
    action: "employee.create",
    entityType: "Employee",
    entityId: employee.id,
    summary: `Created employee ${employee.name}`,
    metadata: data,
  });
  revalidatePath("/employees");
}

export async function updateEmployee(id: number, formData: FormData) {
  const data = readEmployeeForm(formData);

  if (data.paylocityId) {
    const existing = await prisma.employee.findUnique({ where: { paylocityId: data.paylocityId } });
    if (existing && existing.id !== id) {
      throw new Error(`Paylocity ID ${data.paylocityId} already belongs to ${existing.name}.`);
    }
  }

  const before = await prisma.employee.findUnique({ where: { id } });
  await prisma.employee.update({ where: { id }, data });
  await logAudit({
    action: "employee.update",
    entityType: "Employee",
    entityId: id,
    summary: `Updated employee ${data.name}`,
    metadata: { before, after: data },
  });
  revalidatePath("/employees");
}

// Pulls the team grouping from the SDC Scheduler (its team_members table is the
// source of truth for discipline) and mirrors it onto ETC employees by name.
// Returns a full report so the UI can show what changed and what couldn't match.
export async function syncSchedulerTeamAction(): Promise<TeamSyncResult> {
  const result = await syncSchedulerTeam();
  if (result.ok) revalidatePath("/employees");
  return result;
}

// Soft-delete / restore. Historical ActualHours rows stay linked either way.
export async function setEmployeeActive(id: number, active: boolean, _formData: FormData) {
  const employee = await prisma.employee.update({ where: { id }, data: { active } });
  await logAudit({
    action: active ? "employee.reactivate" : "employee.deactivate",
    entityType: "Employee",
    entityId: id,
    summary: `${active ? "Reactivated" : "Deactivated"} employee ${employee.name}`,
  });
  revalidatePath("/employees");
}
