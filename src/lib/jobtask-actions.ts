"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";

// Task assignments mirror the sheet's "ME Name" columns (slots 1-11).

export async function saveJobTask(jobId: number, slot: number | null, formData: FormData) {
  const taskName = String(formData.get("taskName") ?? "").trim();
  if (!taskName) throw new Error("Task name is required.");

  const rawHours = String(formData.get("hours") ?? "").trim();
  const hours = rawHours === "" ? 0 : Number(rawHours);
  if (!Number.isFinite(hours) || hours < 0) throw new Error(`Invalid hours "${rawHours}".`);

  if (slot === null) {
    // New task: next free slot (the sheet had 11 columns; the app doesn't cap).
    const last = await prisma.jobTask.findFirst({ where: { jobId }, orderBy: { slot: "desc" }, select: { slot: true } });
    slot = (last?.slot ?? 0) + 1;
  }

  await prisma.jobTask.upsert({
    where: { jobId_slot: { jobId, slot } },
    update: { taskName, estimateToCompleteHours: hours },
    create: { jobId, slot, taskName, estimateToCompleteHours: hours },
  });
  await logAudit({
    action: "jobtask.save",
    entityType: "JobTask",
    entityId: `${jobId}-${slot}`,
    summary: `Saved task "${taskName}" (${hours}h) on job ${jobId}, slot ${slot}`,
    metadata: { jobId, slot, taskName, hours },
  });
  revalidatePath(`/jobs/${jobId}`);
}

export async function deleteJobTask(id: number, _formData: FormData) {
  const task = await prisma.jobTask.delete({ where: { id } });
  await logAudit({
    action: "jobtask.delete",
    entityType: "JobTask",
    entityId: id,
    summary: `Deleted task "${task.taskName}" from job ${task.jobId}`,
  });
  revalidatePath(`/jobs/${task.jobId}`);
}
