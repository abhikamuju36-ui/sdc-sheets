"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { assertStandardSheetUnlocked } from "@/lib/standard-sheet-gate";

type RateField = "engrRate" | "shopRate" | "partsMarkup";

// TypeScript's RateField union is compile-time only — a directly-invoked
// action can pass any string, which would otherwise land in the upsert's
// computed `[field]` key.
const RATE_FIELDS = new Set<RateField>(["engrRate", "shopRate", "partsMarkup"]);
const RATE_DEFAULTS: Record<RateField, number> = { engrRate: 170, shopRate: 140, partsMarkup: 1.2 };

// Single-field autosave for the Execution Rates shared by the Monthly ETC
// grid's inline Standard Sheet columns and the /standard-sheet tab's own
// grid — both read/write the same ExecutionRate row per job, so a save here
// shows up on both without any extra sync step.
export async function saveExecutionRateField(jobId: number, field: RateField, value: number) {
  await assertStandardSheetUnlocked();
  if (!RATE_FIELDS.has(field)) throw new Error(`Unknown execution rate field "${field}".`);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${field} value "${value}".`);

  // Create uses the plain defaults (the same ones every reader falls back to
  // when no row exists) rather than a pre-read of the row — the old
  // read-then-upsert let two concurrent first-saves clobber each other.
  await prisma.executionRate.upsert({
    where: { jobId },
    update: { [field]: value },
    create: {
      jobId,
      ...RATE_DEFAULTS,
      [field]: value,
      contingencyAmount: 0,
      notes: "",
    },
  });

  await logAudit({
    action: "executionRate.saveField",
    entityType: "ExecutionRate",
    entityId: String(jobId),
    summary: `Updated ${field} to ${value} for job ${jobId}`,
  });

  revalidatePath("/etc");
  revalidatePath("/standard-sheet");
}
