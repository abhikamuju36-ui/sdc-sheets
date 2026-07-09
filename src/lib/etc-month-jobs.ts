import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { etcActiveJobFilter } from "@/lib/job-filters";

// The single source of truth for "which jobs belong to an ETC month" — used by
// the Monthly ETC grid AND the Standard Sheet so both always list the exact
// same projects for a given month/year.
//
// Mirrors the grid's own rule:
// - A LOCKED month (has entries, none still need review) is a frozen snapshot:
//   show exactly the jobs that have entries in it, whatever their status is
//   today. Filtering by current status would hide every job completed since,
//   making history show fewer jobs than were actually submitted.
// - An in-progress or not-yet-started month uses etcActiveJobFilter — the live
//   universe seeding/pruning/submission operate on.
export async function getEtcMonthJobWhere(month: string): Promise<{ where: Prisma.JobWhereInput; monthIsLocked: boolean }> {
  const [entryCount, pendingCount] = await Promise.all([
    prisma.etcEntry.count({ where: { month } }),
    prisma.etcEntry.count({ where: { month, needsReview: true } }),
  ]);
  const monthIsLocked = entryCount > 0 && pendingCount === 0;
  return {
    where: monthIsLocked ? { etcEntries: { some: { month } } } : etcActiveJobFilter,
    monthIsLocked,
  };
}
