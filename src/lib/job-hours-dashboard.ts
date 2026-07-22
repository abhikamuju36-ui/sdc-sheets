import { prisma } from "@/lib/prisma";
import { SECTIONS, PHASE_GROUPS, PARTS_COST_SECTION } from "@/lib/sections";
import { suggestNewEtc } from "@/lib/etc";
import { validJobTypeFilter } from "@/lib/job-filters";

// Data layer for the "Job Hour Details" dashboard — a web recreation of the
// Power BI "Job Hours Report — Management Level" drillthrough page. Sources every
// hours metric from the ETC app's own data (EstimatedHours = Quoted, EtcEntry =
// Actual + ETC), so it needs no Power BI connection.

export type HoursType = "Quoted" | "ETC";

export type SectionHours = {
  code: string;
  name: string;
  phase: string;
  group: string;
  billingGroup: "Engineering" | "Shop";
  quoted: number;
  etc: number;
  actual: number;
};

// Engineering vs Shop split — mirrors sections.ts ENGINEERING_CODES (the set the
// sheet's Total-New-ETC formula treats as Engineering).
const ENGINEERING_CODES = new Set([
  "10-211", "10-312", "10-313", "10-515", "10-516", "10-517", "10-518", "40-211", "50-211",
]);
const billingGroupOf = (code: string): "Engineering" | "Shop" =>
  ENGINEERING_CODES.has(code) ? "Engineering" : "Shop";

export type JobHoursDashboard = {
  job: { id: number; jobId: string; jobName: string; customer: string | null; status: string };
  kpis: {
    activeJobs: number;
    hoursRefreshedThru: string | null;
    latestEtcMonth: string | null;
    designToDebugRatio: number | null;
  };
  sections: SectionHours[];
  phaseGroups: { phase: string; count: number }[];
  billingGroups: { group: string; quoted: number; etc: number; actual: number }[];
};

// Effective New ETC — the same rule the ETC grid renders with (execution-etc.ts).
function effectiveNewEtc(e: {
  needsReview: boolean; newEtc: unknown; newEtcDraft: unknown; priorEtc: unknown; hoursWorked: unknown;
}): number {
  if (!e.needsReview) return Number(e.newEtc);
  if (e.newEtcDraft != null) return Number(e.newEtcDraft);
  return suggestNewEtc(Number(e.priorEtc), Number(e.hoursWorked));
}

export async function listDashboardJobs(): Promise<{ id: number; jobId: string; jobName: string; status: string }[]> {
  const jobs = await prisma.job.findMany({
    where: { ...validJobTypeFilter },
    select: { id: true, jobId: true, jobName: true, status: true },
  });
  return jobs.sort((a, b) => {
    const na = Number(a.jobId), nb = Number(b.jobId);
    if (Number.isFinite(na) && Number.isFinite(nb)) return nb - na; // newest job first
    return a.jobId.localeCompare(b.jobId);
  });
}

// Pick a sensible default job for first load: the one with the most worked
// hours in the latest ETC month (so the dashboard opens on real data instead of
// an empty service/spare-parts job).
export async function defaultDashboardJobId(): Promise<number | null> {
  const latest = await prisma.etcEntry.findFirst({ orderBy: { month: "desc" }, select: { month: true } });
  if (!latest) return null;
  const grouped = await prisma.etcEntry.groupBy({
    by: ["jobId"],
    where: { month: latest.month },
    _sum: { hoursWorked: true },
  });
  grouped.sort((a, b) => Number(b._sum.hoursWorked ?? 0) - Number(a._sum.hoursWorked ?? 0));
  const validIds = new Set((await listDashboardJobs()).map((j) => j.id));
  for (const g of grouped) if (validIds.has(g.jobId)) return g.jobId;
  return null;
}

export async function getJobHoursDashboard(jobId: number): Promise<JobHoursDashboard | null> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, jobId: true, jobName: true, customer: true, status: true },
  });
  if (!job) return null;

  const [estimated, entries, activeJobs, freshness, latestEntry] = await Promise.all([
    prisma.estimatedHours.findMany({ where: { jobId }, select: { section: true, quotedHours: true, actualHistoricalHours: true } }),
    prisma.etcEntry.findMany({
      where: { jobId },
      select: { section: true, month: true, hoursWorked: true, newEtc: true, newEtcDraft: true, priorEtc: true, needsReview: true },
    }),
    prisma.job.count({ where: { status: "Active", ...validJobTypeFilter } }),
    prisma.powerBiFreshness.findUnique({ where: { source: "hours_actual" }, select: { refreshedThrough: true } }).catch(() => null),
    prisma.etcEntry.findFirst({ where: { jobId }, orderBy: { month: "desc" }, select: { month: true } }),
  ]);

  const latestMonth = latestEntry?.month ?? null;

  // Quoted per section.
  const quotedBy = new Map<string, number>();
  for (const e of estimated) quotedBy.set(e.section, (quotedBy.get(e.section) ?? 0) + Number(e.quotedHours));

  // Cumulative actual per section. A closed/historical job's real total lives in
  // EstimatedHours.actualHistoricalHours (the Excel-migration snapshot); an
  // actively ETC-tracked job's total is the sum of every month's hoursWorked.
  // The two never overlap for the same job, so adding is safe (same rule the
  // Projects grid uses).
  const actualBy = new Map<string, number>();
  for (const e of estimated) {
    if (e.actualHistoricalHours != null) actualBy.set(e.section, (actualBy.get(e.section) ?? 0) + Number(e.actualHistoricalHours));
  }
  for (const e of entries) {
    if (e.section === PARTS_COST_SECTION) continue;
    actualBy.set(e.section, (actualBy.get(e.section) ?? 0) + Number(e.hoursWorked));
  }

  // ETC per section — effective New ETC for the latest month only.
  const etcBy = new Map<string, number>();
  if (latestMonth) {
    for (const e of entries) {
      if (e.month !== latestMonth || e.section === PARTS_COST_SECTION) continue;
      etcBy.set(e.section, (etcBy.get(e.section) ?? 0) + effectiveNewEtc(e));
    }
  }

  const sections: SectionHours[] = SECTIONS.map((s) => ({
    code: s.code,
    name: s.name,
    phase: s.phase,
    group: s.group,
    billingGroup: billingGroupOf(s.code),
    quoted: quotedBy.get(s.code) ?? 0,
    etc: etcBy.get(s.code) ?? 0,
    actual: actualBy.get(s.code) ?? 0,
  }));

  // Billing-group rollups (Engineering / Shop).
  const bgMap = new Map<string, { quoted: number; etc: number; actual: number }>();
  for (const s of sections) {
    const cur = bgMap.get(s.billingGroup) ?? { quoted: 0, etc: 0, actual: 0 };
    cur.quoted += s.quoted; cur.etc += s.etc; cur.actual += s.actual;
    bgMap.set(s.billingGroup, cur);
  }
  const billingGroups = ["Engineering", "Shop"].map((g) => ({ group: g, ...(bgMap.get(g) ?? { quoted: 0, etc: 0, actual: 0 }) }));

  // Engineering Design-to-Debug Ratio (PBI DAX): Section 10 Engineering actual /
  // Section 40 Engineering actual; blank when debug < 200.
  let design = 0, debug = 0;
  for (const s of sections) {
    if (s.billingGroup !== "Engineering") continue;
    if (s.code.startsWith("10-")) design += s.actual;
    else if (s.code.startsWith("40-")) debug += s.actual;
  }
  const designToDebugRatio = debug < 200 ? null : design / debug;

  return {
    job,
    kpis: {
      activeJobs,
      hoursRefreshedThru: freshness?.refreshedThrough ? freshness.refreshedThrough.toISOString().slice(0, 10) : null,
      latestEtcMonth: latestMonth,
      designToDebugRatio,
    },
    sections,
    phaseGroups: PHASE_GROUPS,
    billingGroups,
  };
}
