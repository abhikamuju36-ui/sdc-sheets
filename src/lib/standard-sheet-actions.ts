"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { assertStandardSheetUnlocked } from "@/lib/standard-sheet-gate";
import { getEtcMonthJobWhere } from "@/lib/etc-month-jobs";
import { getExecutionEtcByJob } from "@/lib/execution-etc";
import { isValidMonth, round2 } from "@/lib/etc";
import { syncCategoryPoolsFromPowerBi } from "@/lib/sync-powerbi";
import {
  calcTotalEtcDollars,
  calcPercentOfTotal,
  calcStandardFeeEngineering,
  calcStandardFeeShop,
  calcTotalStandardFees,
} from "@/lib/standard-fees";

// The Standard Sheet workflow — pool refresh/editing, the month freeze, and
// per-job Contingency/Notes editing — used to live only on the /standard-sheet
// tab. It now runs from the Monthly ETC page's unlocked Standard view; that tab
// is retired. The one behavioral change from the old tab: the month freeze
// stamps every job with the single GLOBAL execution rate set (StandardSheetSetting),
// matching what /etc displays, instead of per-job ExecutionRate rows.

// The department pools for `month`, or — if that month was never refreshed —
// the most recent PRIOR month's pools as a labeled fallback (so Standard Fees
// never silently collapse to $0). `carriedFrom` is the source month when the
// fallback kicked in, else null.
export async function loadEffectivePools(month: string) {
  const own = await prisma.categoryPool.findMany({ where: { month } });
  if (own.length > 0) return { pools: own, carriedFrom: null as string | null };
  const prior = await prisma.categoryPool.findFirst({
    where: { month: { lt: month } },
    orderBy: { month: "desc" },
    select: { month: true },
  });
  if (!prior) return { pools: own, carriedFrom: null as string | null };
  return { pools: await prisma.categoryPool.findMany({ where: { month: prior.month } }), carriedFrom: prior.month };
}

// A submitted month is frozen — server actions must enforce it, not just the
// UI hiding buttons. Also the single choke point every month-scoped action
// passes through, so a crafted/garbage month can never reach a write.
//
// Also refuses a month whose pools came from the PBI historical backfill
// (source: "power_bi_history") even without a StandardSheetSnapshot: editing
// those would corrupt the verified ledger chain (sync-powerbi.ts carries
// `prior.newEtcHours` forward), and a later refresh of the FOLLOWING month
// would then inherit the tampered balance — the same class of bug the June
// 2026 pool-reset investigation found and fixed.
async function assertMonthNotSubmitted(month: string) {
  if (!isValidMonth(month)) throw new Error(`"${month}" is not a valid month (expected YYYY-MM).`);
  const submitted = await prisma.standardSheetSnapshot.findFirst({ where: { month }, select: { id: true } });
  if (submitted) throw new Error(`${month} is submitted and frozen — reopen it first.`);
  const historical = await prisma.categoryPool.findFirst({ where: { month, source: "power_bi_history" }, select: { id: true } });
  if (historical) throw new Error(`${month}'s pools came from Power BI's historical archive — editing them here would break the balance chain to later months.`);
}

function globalRates(setting: { engrRate: unknown; shopRate: unknown; partsMarkup: unknown } | null) {
  return {
    engrRate: setting ? Number(setting.engrRate) : 170,
    shopRate: setting ? Number(setting.shopRate) : 140,
    partsMarkup: setting ? Number(setting.partsMarkup) : 1.2,
  };
}

// Pull the month's category-pool driver measures from Power BI (the app's
// version of the sheet's GETPIVOTDATA refresh).
export async function refreshPools(month: string) {
  await assertStandardSheetUnlocked();
  await assertMonthNotSubmitted(month);
  await syncCategoryPoolsFromPowerBi(month);
  await logAudit({ action: "standardSheet.refreshPools", entityType: "CategoryPool", entityId: month, summary: `Refreshed category pools from Power BI for ${month}` });
  revalidatePath("/etc");
}

// Saves the two manual cells of each "Standard Fees By Department" block —
// Hours being pulled this month and Rate — and recomputes the derived cells:
// New ETC Hours = Hours Available − Hours Pulled, Standard Fee = New ETC × Rate.
export async function savePools(month: string, formData: FormData) {
  await assertStandardSheetUnlocked();
  await assertMonthNotSubmitted(month);
  const categories = ["ENGINEERING_PM", "ENGINEERING_WARRANTY", "SHOP_MANUFACTURING", "SHOP_WARRANTY"] as const;
  const changes: Record<string, unknown>[] = [];

  const manualCell = (name: string, stored: number): number => {
    const raw = formData.get(name);
    // Absent AND cleared both mean "keep the stored value" — a field wiped
    // mid-edit must not silently save 0 (a 0 Rate collapses that whole
    // department's Standard Fee to $0). An explicit zero is still saveable
    // by typing 0.
    if (raw === null || raw === "") return stored;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid value "${raw}" for ${name}.`);
    return n;
  };

  const writes: { id: number; data: Record<string, number> }[] = [];
  for (const category of categories) {
    const pool = await prisma.categoryPool.findUnique({ where: { category_month: { category, month } } });
    if (!pool) continue; // pool rows come from Refresh Pools (Power BI) or migration
    const hoursPulledThisMonth = manualCell(`pulled__${category}`, Number(pool.hoursPulledThisMonth));
    const rate = manualCell(`rate__${category}`, Number(pool.rate));
    const newEtcHours = round2(Number(pool.hoursAvailable) - hoursPulledThisMonth);
    const standardFee = round2(newEtcHours * rate);
    writes.push({ id: pool.id, data: { hoursPulledThisMonth, rate, newEtcHours, standardFee } });
    changes.push({ category, hoursPulledThisMonth, rate, newEtcHours, standardFee });
  }
  await prisma.$transaction(writes.map((w) => prisma.categoryPool.update({ where: { id: w.id }, data: w.data })));

  await logAudit({
    action: "standardSheet.savePools",
    entityType: "CategoryPool",
    entityId: month,
    summary: `Saved category pool cells for ${month}`,
    metadata: { changes },
  });
  revalidatePath("/etc");
}

// Per-job Contingency $ and Notes — the sheet's manual R/Notes columns. Edited
// inline in the /etc Standard block now that the tab is gone. Split into two
// single-field saves so editing one never clobbers the other's stored value.
export async function saveContingencyAmount(jobId: number, contingencyAmount: number) {
  await assertStandardSheetUnlocked();
  if (!Number.isInteger(jobId)) throw new Error(`Invalid job id "${jobId}".`);
  if (!Number.isFinite(contingencyAmount) || contingencyAmount < 0) throw new Error(`Invalid contingency "${contingencyAmount}".`);
  await prisma.executionRate.upsert({
    where: { jobId },
    update: { contingencyAmount },
    create: { jobId, contingencyAmount },
  });
  await logAudit({ action: "standardSheet.saveContingency", entityType: "ExecutionRate", entityId: String(jobId), summary: `Saved contingency ${contingencyAmount} for job ${jobId}` });
  revalidatePath("/etc");
}

export async function saveJobNotes(jobId: number, notes: string) {
  await assertStandardSheetUnlocked();
  if (!Number.isInteger(jobId)) throw new Error(`Invalid job id "${jobId}".`);
  await prisma.executionRate.upsert({
    where: { jobId },
    update: { notes },
    create: { jobId, notes },
  });
  await logAudit({ action: "standardSheet.saveNotes", entityType: "ExecutionRate", entityId: String(jobId), summary: `Saved notes for job ${jobId}` });
  revalidatePath("/etc");
}

// The global contingency multiplier (StandardSheetSetting.contingencyRate).
export async function saveContingencyRate(contingencyRate: number) {
  await assertStandardSheetUnlocked();
  if (!Number.isFinite(contingencyRate) || contingencyRate < 0) throw new Error(`Invalid contingency rate "${contingencyRate}".`);
  const before = await prisma.standardSheetSetting.findUnique({ where: { id: 1 } });
  await prisma.standardSheetSetting.upsert({
    where: { id: 1 },
    update: { contingencyRate },
    create: { id: 1, contingencyRate },
  });
  await logAudit({
    action: "standardSheet.saveContingencyRate",
    entityType: "StandardSheetSetting",
    summary: `Changed global contingency rate to ${contingencyRate}`,
    metadata: { before: before ? Number(before.contingencyRate) : null, after: contingencyRate },
  });
  revalidatePath("/etc");
}

// Freezes the month: recomputes every job's row exactly as the live /etc view
// does — now with the GLOBAL execution rates — then writes all rows in one
// transaction. A submitted month always renders from these rows afterward.
export async function submitStandardSheetMonth(month: string) {
  await assertStandardSheetUnlocked();
  await assertMonthNotSubmitted(month);
  const session = await auth();
  const user = session?.user?.email ? await prisma.user.findUnique({ where: { email: session.user.email } }) : null;

  const jobs = await prisma.job.findMany({
    where: (await getEtcMonthJobWhere(month)).where,
    select: { id: true, executionRate: true },
  });
  const [etcByJob, effective, setting] = await Promise.all([
    getExecutionEtcByJob(jobs.map((j) => j.id), month),
    loadEffectivePools(month),
    prisma.standardSheetSetting.findUnique({ where: { id: 1 } }),
  ]);
  const rate = globalRates(setting);
  const contingencyRate = setting ? Number(setting.contingencyRate) : 1.2;
  const pools = effective.pools;
  const poolTotals = {
    engineeringPM: Number(pools.find((p) => p.category === "ENGINEERING_PM")?.standardFee ?? 0),
    engineeringWarranty: Number(pools.find((p) => p.category === "ENGINEERING_WARRANTY")?.standardFee ?? 0),
    shopManufacturing: Number(pools.find((p) => p.category === "SHOP_MANUFACTURING")?.standardFee ?? 0),
    shopWarranty: Number(pools.find((p) => p.category === "SHOP_WARRANTY")?.standardFee ?? 0),
  };

  const rows = jobs.map((job) => {
    const etc = etcByJob.get(job.id) ?? { engineering: 0, shop: 0, parts: 0 };
    return { job, etc, totalEtcDollars: calcTotalEtcDollars(etc, rate) };
  });
  const grandTotal = rows.reduce((sum, r) => sum + r.totalEtcDollars, 0);

  await prisma.$transaction([
    prisma.standardSheetSnapshot.deleteMany({ where: { month } }),
    prisma.standardSheetSnapshot.createMany({
      data: rows.map(({ job, etc, totalEtcDollars }) => {
        const percentOfTotal = calcPercentOfTotal(totalEtcDollars, grandTotal);
        const standardFeeEngineering = calcStandardFeeEngineering(percentOfTotal, poolTotals);
        const standardFeeShop = calcStandardFeeShop(percentOfTotal, poolTotals);
        const contingencyAmount = job.executionRate ? Number(job.executionRate.contingencyAmount) : 0;
        return {
          jobId: job.id,
          month,
          engrRate: rate.engrRate,
          shopRate: rate.shopRate,
          partsMarkup: rate.partsMarkup,
          etcEngineering: etc.engineering,
          etcShop: etc.shop,
          etcParts: etc.parts,
          totalEtcDollars,
          percentOfTotal,
          standardFeeEngineering,
          standardFeeShop,
          contingencyAmount,
          contingencyRate,
          totalStandardFees: calcTotalStandardFees(totalEtcDollars, standardFeeEngineering, standardFeeShop, contingencyAmount, contingencyRate),
          notes: job.executionRate?.notes ?? null,
          submittedById: user?.id ?? null,
        };
      }),
    }),
  ]);

  await logAudit({
    action: "standardSheet.submitMonth",
    entityType: "StandardSheetSnapshot",
    entityId: month,
    summary: `Submitted Standard Sheet for ${month} (${rows.length} jobs, grand total ${grandTotal.toFixed(2)})`,
  });
  revalidatePath("/etc");
}

export async function reopenStandardSheetMonth(month: string) {
  // Admin-only — the action itself must not trust the UI hiding the button.
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "ADMIN") throw new Error("Only admins can reopen a submitted month.");
  await prisma.standardSheetSnapshot.deleteMany({ where: { month } });
  await logAudit({ action: "standardSheet.reopenMonth", entityType: "StandardSheetSnapshot", entityId: month, summary: `Reopened Standard Sheet month ${month}` });
  revalidatePath("/etc");
}
