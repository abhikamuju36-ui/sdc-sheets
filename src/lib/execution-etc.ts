import { prisma } from "@/lib/prisma";
import { ETC_SECTIONS, ETC_TRACKED_CODES, PARTS_COST_SECTION } from "@/lib/sections";

const SECTION_BILLING_GROUP = new Map(ETC_SECTIONS.map((s) => [s.code, s.billingGroup]));

export type ExecutionEtc = { engineering: number; shop: number; parts: number };

// Mirrors Standard Fees.xlsx's per-job VLOOKUP into Managers Fill Out's
// "Total (New ETC) > Engineering/Shop > All > Total New ETC" and
// "Parts Cost > Total > New ETC" columns — rolled up here from EtcEntry
// instead of a cross-workbook formula.
//
// `month` scopes the rollup to one ETC month, mirroring how the workbook's
// Managers Fill Out always holds exactly one month's working state.
export async function getExecutionEtcByJob(jobIds: number[], month: string): Promise<Map<number, ExecutionEtc>> {
  const result = new Map<number, ExecutionEtc>();
  if (jobIds.length === 0) return result;

  const entries = await prisma.etcEntry.findMany({
    where: { jobId: { in: jobIds }, month },
    select: { jobId: true, section: true, newEtc: true },
  });

  for (const e of entries) {
    if (e.section !== PARTS_COST_SECTION && !ETC_TRACKED_CODES.has(e.section)) continue;

    const totals = result.get(e.jobId) ?? { engineering: 0, shop: 0, parts: 0 };
    const value = Number(e.newEtc);
    if (e.section === PARTS_COST_SECTION) {
      totals.parts += value;
    } else if (SECTION_BILLING_GROUP.get(e.section) === "Engineering") {
      totals.engineering += value;
    } else {
      totals.shop += value;
    }
    result.set(e.jobId, totals);
  }

  return result;
}
