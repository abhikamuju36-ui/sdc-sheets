"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { assertStandardSheetUnlocked } from "@/lib/standard-sheet-gate";

// Global execution rates for the Monthly ETC grid's inline Standard Sheet view.
// Entered once via the "ETC Rates" button and applied to every job on that page
// (the per-job rate columns there were removed). Stored on the singleton
// StandardSheetSetting row — distinct from the /standard-sheet tab's per-job
// ExecutionRate rows, which this does not touch.
export async function saveStandardRates(engrRate: number, shopRate: number, partsMarkup: number, contingencyRate: number) {
  await assertStandardSheetUnlocked();
  for (const [name, v] of [["engrRate", engrRate], ["shopRate", shopRate], ["partsMarkup", partsMarkup], ["contingencyRate", contingencyRate]] as const) {
    if (!Number.isFinite(v) || v < 0) throw new Error(`Invalid ${name} value "${v}".`);
  }

  await prisma.standardSheetSetting.upsert({
    where: { id: 1 },
    update: { engrRate, shopRate, partsMarkup, contingencyRate },
    create: { id: 1, engrRate, shopRate, partsMarkup, contingencyRate },
  });

  await logAudit({
    action: "standardRates.save",
    entityType: "StandardSheetSetting",
    entityId: "1",
    summary: `Set global ETC rates: ENGR ${engrRate}, Shop ${shopRate}, Parts ${partsMarkup}, Contingency ${contingencyRate}`,
  });

  revalidatePath("/etc");
}
