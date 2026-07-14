import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { compareJobIds } from "@/lib/job-filters";
import { getEtcMonthJobWhere } from "@/lib/etc-month-jobs";
import { getExecutionEtcByJob } from "@/lib/execution-etc";
import { isValidMonth } from "@/lib/etc";
import { syncCategoryPoolsFromPowerBi } from "@/lib/sync-powerbi";
import {
  calcTotalEtcDollars,
  calcPercentOfTotal,
  calcStandardFeeEngineering,
  calcStandardFeeShop,
  calcTotalStandardFees,
} from "@/lib/standard-fees";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { assertStandardSheetUnlocked } from "@/lib/standard-sheet-gate";
import type { Prisma } from "@prisma/client";
import { StandardSheetLive } from "@/components/StandardSheetLive";
import type { PoolRow, RateRow } from "@/components/StandardSheetLive";

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// The department pools for `month`, or — if that month was never refreshed —
// the most recent PRIOR month's pools as a labeled fallback, so the block is
// never empty and Standard Fees never silently collapse to $0. `carriedFrom`
// is the source month when the fallback kicked in, else null. Shared by the
// live view and the submit action so what you see is what gets frozen.
async function loadEffectivePools(month: string) {
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

async function saveRates(month: string, formData: FormData) {
  "use server";
  await assertStandardSheetUnlocked();
  await assertMonthNotSubmitted(month);
  const jobIds = formData.getAll("jobId").map((v) => Number(v));

  // Validate every row before writing anything — one bad value rejects the
  // whole save instead of leaving a partially-updated rate set. NaN (missing
  // or non-numeric field), negatives, and Infinity all fail Number.isFinite/≥0.
  const numeric = (jobId: number, name: string, fallback?: number): number => {
    const raw = formData.get(`${name}__${jobId}`);
    if ((raw === null || raw === "") && fallback !== undefined) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${name} "${raw}" for job ${jobId}.`);
    return n;
  };
  const rates = jobIds.map((jobId) => {
    if (!Number.isInteger(jobId)) throw new Error(`Invalid job id "${jobId}".`);
    return {
      jobId,
      engrRate: numeric(jobId, "engrRate"),
      shopRate: numeric(jobId, "shopRate"),
      partsMarkup: numeric(jobId, "partsMarkup"),
      contingencyAmount: numeric(jobId, "contingencyAmount", 0),
      notes: String(formData.get(`notes__${jobId}`) ?? ""),
    };
  });

  await prisma.$transaction(
    rates.map(({ jobId, engrRate, shopRate, partsMarkup, contingencyAmount, notes }) =>
      prisma.executionRate.upsert({
        where: { jobId },
        update: { engrRate, shopRate, partsMarkup, contingencyAmount, notes },
        create: { jobId, engrRate, shopRate, partsMarkup, contingencyAmount, notes },
      })
    )
  );

  await logAudit({
    action: "standardSheet.saveRates",
    entityType: "ExecutionRate",
    summary: `Saved execution rates for ${rates.length} job${rates.length === 1 ? "" : "s"}`,
    metadata: { rates },
  });

  revalidatePath("/standard-sheet");
}

async function saveContingencyRate(formData: FormData) {
  "use server";
  await assertStandardSheetUnlocked();
  const contingencyRate = Number(formData.get("contingencyRate"));
  if (!Number.isFinite(contingencyRate) || contingencyRate < 0) {
    throw new Error(`Invalid contingency rate "${formData.get("contingencyRate")}".`);
  }
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
  revalidatePath("/standard-sheet");
}

// A submitted month is frozen — server actions must enforce it, not just the
// UI hiding buttons (a stale tab or crafted request could otherwise mutate it).
// Also the single choke point every month-scoped action here passes through,
// so a crafted/garbage month can never reach a write (e.g. freezing snapshot
// rows under a nonsense month key).
async function assertMonthNotSubmitted(month: string) {
  if (!isValidMonth(month)) throw new Error(`"${month}" is not a valid month (expected YYYY-MM).`);
  const submitted = await prisma.standardSheetSnapshot.findFirst({ where: { month }, select: { id: true } });
  if (submitted) throw new Error(`${month} is submitted and frozen — reopen it first.`);
}

// The app's version of the sheet's GETPIVOTDATA refresh — pulls the month's
// category pool driver measures from Power BI (see syncCategoryPoolsFromPowerBi).
async function refreshPools(month: string) {
  "use server";
  await assertStandardSheetUnlocked();
  await assertMonthNotSubmitted(month);
  await syncCategoryPoolsFromPowerBi(month);
  await logAudit({ action: "standardSheet.refreshPools", entityType: "CategoryPool", entityId: month, summary: `Refreshed category pools from Power BI for ${month}` });
  revalidatePath("/standard-sheet");
}

// Saves the two manual cells of each "Standard Fees By Department" block —
// Hours being pulled this month and Rate — and recomputes the sheet's derived
// cells exactly: New ETC Hours = Hours Available − Hours Pulled (D77=D75−D76),
// Standard Fee = New ETC Hours × Rate (D79=D77×D78).
async function savePools(month: string, formData: FormData) {
  "use server";
  await assertStandardSheetUnlocked();
  await assertMonthNotSubmitted(month);
  const categories = ["ENGINEERING_PM", "ENGINEERING_WARRANTY", "SHOP_MANUFACTURING", "SHOP_WARRANTY"] as const;
  const changes: Record<string, unknown>[] = [];

  // A field ABSENT from the form (not rendered, e.g. the Rate row lives only
  // in Power BI now) keeps its stored value — the old `Number(...) || 0`
  // zeroed rate AND standardFee on every save. A field present but cleared is
  // the sheet's blank cell (0); a present non-numeric/negative value is a
  // typo — reject the whole save rather than silently coercing it.
  const manualCell = (name: string, stored: number): number => {
    const raw = formData.get(name);
    if (raw === null) return stored;
    if (raw === "") return 0;
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
    const newEtcHours = Number(pool.hoursAvailable) - hoursPulledThisMonth;
    const standardFee = newEtcHours * rate;

    writes.push({ id: pool.id, data: { hoursPulledThisMonth, rate, newEtcHours, standardFee } });
    changes.push({ category, hoursPulledThisMonth, rate, newEtcHours, standardFee });
  }
  // All four categories in one transaction — a failure mid-save must not
  // leave the department block half-updated.
  await prisma.$transaction(writes.map((w) => prisma.categoryPool.update({ where: { id: w.id }, data: w.data })));

  await logAudit({
    action: "standardSheet.savePools",
    entityType: "CategoryPool",
    entityId: month,
    summary: `Saved category pool cells for ${month}`,
    metadata: { changes },
  });

  revalidatePath("/standard-sheet");
}

// Freezes the month: recomputes every job's row exactly as the live view
// does, then writes all rows in one transaction — the app's version of the
// workbook's "copy Managers Fill Out to an archive tab" macro, minus the
// fragility. A submitted month always renders from these rows afterward.
async function submitStandardSheetMonth(month: string) {
  "use server";
  await assertStandardSheetUnlocked();
  await assertMonthNotSubmitted(month);
  const session = await auth();
  const user = session?.user?.email
    ? await prisma.user.findUnique({ where: { email: session.user.email } })
    : null;

  const jobs = await prisma.job.findMany({
    where: (await getEtcMonthJobWhere(month)).where,
    select: { id: true, executionRate: true },
  });
  const [etcByJob, effectivePools, setting] = await Promise.all([
    getExecutionEtcByJob(jobs.map((j) => j.id), month),
    // Same fallback the live view uses, so submitting a month that shows
    // carried-forward pools freezes exactly what was on screen (not $0).
    loadEffectivePools(month).then((r) => r.pools),
    prisma.standardSheetSetting.findUnique({ where: { id: 1 } }),
  ]);
  const contingencyRate = setting ? Number(setting.contingencyRate) : 1.2;
  const poolTotals = {
    engineeringPM: Number(effectivePools.find((p) => p.category === "ENGINEERING_PM")?.standardFee ?? 0),
    engineeringWarranty: Number(effectivePools.find((p) => p.category === "ENGINEERING_WARRANTY")?.standardFee ?? 0),
    shopManufacturing: Number(effectivePools.find((p) => p.category === "SHOP_MANUFACTURING")?.standardFee ?? 0),
    shopWarranty: Number(effectivePools.find((p) => p.category === "SHOP_WARRANTY")?.standardFee ?? 0),
  };

  const rows = jobs.map((job) => {
    const etc = etcByJob.get(job.id) ?? { engineering: 0, shop: 0, parts: 0 };
    const rate = {
      engrRate: job.executionRate ? Number(job.executionRate.engrRate) : 170,
      shopRate: job.executionRate ? Number(job.executionRate.shopRate) : 140,
      partsMarkup: job.executionRate ? Number(job.executionRate.partsMarkup) : 1.2,
    };
    return { job, etc, rate, totalEtcDollars: calcTotalEtcDollars(etc, rate) };
  });
  const grandTotal = rows.reduce((sum, r) => sum + r.totalEtcDollars, 0);

  await prisma.$transaction([
    prisma.standardSheetSnapshot.deleteMany({ where: { month } }),
    prisma.standardSheetSnapshot.createMany({
      data: rows.map(({ job, etc, rate, totalEtcDollars }) => {
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
          totalStandardFees: calcTotalStandardFees(
            totalEtcDollars,
            standardFeeEngineering,
            standardFeeShop,
            contingencyAmount,
            contingencyRate
          ),
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

  revalidatePath("/standard-sheet");
}

async function reopenStandardSheetMonth(month: string) {
  "use server";
  // Server-side role check — the UI only shows the button to admins, but the
  // action itself must not trust the UI.
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "ADMIN") throw new Error("Only admins can reopen a submitted month.");
  await prisma.standardSheetSnapshot.deleteMany({ where: { month } });
  await logAudit({ action: "standardSheet.reopenMonth", entityType: "StandardSheetSnapshot", entityId: month, summary: `Reopened Standard Sheet month ${month}` });
  revalidatePath("/standard-sheet");
}

// A display row — same shape whether it came from live math or a frozen snapshot.
type DisplayRow = {
  jobId: number;
  jobIdLabel: string;
  jobName: string;
  status: string;
  engrRate: string;
  shopRate: string;
  partsMarkup: string;
  etcEngineering: number;
  etcShop: number;
  etcParts: number;
  totalEtcDollars: number;
  percentOfTotal: number;
  standardFeeEngineering: number;
  standardFeeShop: number;
  contingencyAmount: number;
  totalStandardFees: number;
  notes: string;
};

export default async function StandardSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; q?: string }>;
}) {
  const { month: monthParam, q } = await searchParams;

  // Month list mirrors the Monthly ETC tab: every month with ETC entries,
  // plus any month that has a submitted Standard Sheet snapshot.
  const [etcMonths, snapshotMonths] = await Promise.all([
    prisma.etcEntry.findMany({ distinct: ["month"], select: { month: true }, orderBy: { month: "desc" } }),
    prisma.standardSheetSnapshot.findMany({ distinct: ["month"], select: { month: true }, orderBy: { month: "desc" } }),
  ]);
  const allMonths = [...new Set([...etcMonths.map((m) => m.month), ...snapshotMonths.map((m) => m.month)])].sort().reverse();
  // A malformed ?month= must not flow into queries or (worse) a Submit that
  // would freeze snapshot rows under a garbage month key.
  const month = (monthParam && isValidMonth(monthParam) ? monthParam : undefined) || allMonths[0] || currentMonth();
  const submittedMonths = new Set(snapshotMonths.map((m) => m.month));
  const isSubmitted = submittedMonths.has(month);

  const [setting, latestSnapshotMeta, session, pools] = await Promise.all([
    prisma.standardSheetSetting.findUnique({ where: { id: 1 } }),
    isSubmitted
      ? prisma.standardSheetSnapshot.findFirst({ where: { month }, include: { submittedBy: true }, orderBy: { submittedAt: "desc" } })
      : Promise.resolve(null),
    auth(),
    prisma.categoryPool.findMany({ where: { month } }),
  ]);
  const role = (session?.user as { role?: string } | undefined)?.role;
  const contingencyRate = setting ? Number(setting.contingencyRate) : 1.2;

  // A month whose department pools were never refreshed (e.g. a month created
  // only by the ETC history backfill) would otherwise render the block empty
  // and allocate $0 Standard Fees to every job. Fall back to the most recent
  // PRIOR month that does have pools — the best available figures — clearly
  // labeled, with the exact month numbers one "Refresh Pools" click away. A
  // submitted month renders from its frozen snapshot, so it never needs this.
  let effectivePools = pools;
  let poolsCarriedFrom: string | null = null;
  if (!isSubmitted && pools.length === 0) {
    const fallback = await loadEffectivePools(month);
    effectivePools = fallback.pools;
    poolsCarriedFrom = fallback.carriedFrom;
  }

  const jobFilter: Prisma.JobWhereInput = q
    ? { OR: [{ jobName: { contains: q } }, { jobId: { contains: q } }] }
    : {};

  let rows: DisplayRow[];

  if (isSubmitted) {
    // Frozen view — rendered entirely from the snapshot rows, matching the
    // workbook's archive tabs. Later rate/ETC edits don't touch these.
    const snapshots = await prisma.standardSheetSnapshot.findMany({
      where: { month, job: jobFilter },
      include: { job: { select: { jobId: true, jobName: true, status: true } } },
    });
    snapshots.sort((a, b) => compareJobIds(a.job.jobId, b.job.jobId)); // numeric, not lexicographic
    rows = snapshots.map((s) => ({
      jobId: s.jobId,
      jobIdLabel: s.job.jobId,
      jobName: s.job.jobName,
      status: s.job.status,
      engrRate: s.engrRate.toString(),
      shopRate: s.shopRate.toString(),
      partsMarkup: s.partsMarkup.toString(),
      etcEngineering: Number(s.etcEngineering),
      etcShop: Number(s.etcShop),
      etcParts: Number(s.etcParts),
      totalEtcDollars: Number(s.totalEtcDollars),
      percentOfTotal: Number(s.percentOfTotal),
      standardFeeEngineering: Number(s.standardFeeEngineering),
      standardFeeShop: Number(s.standardFeeShop),
      contingencyAmount: Number(s.contingencyAmount),
      totalStandardFees: Number(s.totalStandardFees),
      notes: s.notes ?? "",
    }));
  } else {
    // Live view — same math as the workbook's open file, scoped to `month`.
    // Fetch ALL active jobs (not the search-filtered subset): the sheet's
    // % Total denominator ($L$66) sums every row, so searching must only
    // narrow the display, never change the math.
    const jobs = await prisma.job.findMany({
      where: (await getEtcMonthJobWhere(month)).where,
      select: { id: true, jobId: true, jobName: true, status: true, executionRate: true },
    });
    jobs.sort((a, b) => compareJobIds(a.jobId, b.jobId)); // numeric, not lexicographic
    const etcByJob = await getExecutionEtcByJob(jobs.map((j) => j.id), month);
    const poolTotals = {
      engineeringPM: Number(effectivePools.find((p) => p.category === "ENGINEERING_PM")?.standardFee ?? 0),
      engineeringWarranty: Number(effectivePools.find((p) => p.category === "ENGINEERING_WARRANTY")?.standardFee ?? 0),
      shopManufacturing: Number(effectivePools.find((p) => p.category === "SHOP_MANUFACTURING")?.standardFee ?? 0),
      shopWarranty: Number(effectivePools.find((p) => p.category === "SHOP_WARRANTY")?.standardFee ?? 0),
    };

    const base = jobs.map((job) => {
      const etc = etcByJob.get(job.id) ?? { engineering: 0, shop: 0, parts: 0 };
      const rate = {
        engrRate: job.executionRate ? Number(job.executionRate.engrRate) : 170,
        shopRate: job.executionRate ? Number(job.executionRate.shopRate) : 140,
        partsMarkup: job.executionRate ? Number(job.executionRate.partsMarkup) : 1.2,
      };
      return { job, etc, rate, totalEtcDollars: calcTotalEtcDollars(etc, rate) };
    });
    const grandTotal = base.reduce((sum, r) => sum + r.totalEtcDollars, 0);

    rows = base.map(({ job, etc, rate, totalEtcDollars }) => {
      const percentOfTotal = calcPercentOfTotal(totalEtcDollars, grandTotal);
      const standardFeeEngineering = calcStandardFeeEngineering(percentOfTotal, poolTotals);
      const standardFeeShop = calcStandardFeeShop(percentOfTotal, poolTotals);
      const contingencyAmount = job.executionRate ? Number(job.executionRate.contingencyAmount) : 0;
      return {
        jobId: job.id,
        jobIdLabel: job.jobId,
        jobName: job.jobName,
        status: job.status,
        engrRate: rate.engrRate.toString(),
        shopRate: rate.shopRate.toString(),
        partsMarkup: rate.partsMarkup.toString(),
        etcEngineering: etc.engineering,
        etcShop: etc.shop,
        etcParts: etc.parts,
        totalEtcDollars,
        percentOfTotal,
        standardFeeEngineering,
        standardFeeShop,
        contingencyAmount,
        totalStandardFees: calcTotalStandardFees(
          totalEtcDollars,
          standardFeeEngineering,
          standardFeeShop,
          contingencyAmount,
          contingencyRate
        ),
        notes: job.executionRate?.notes ?? "",
      };
    });

    // Search narrows the display only, after all math is done on the full set.
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter((r) => r.jobName.toLowerCase().includes(needle) || r.jobIdLabel.toLowerCase().includes(needle));
    }
  }

  const editable = !isSubmitted;
  // Carried-forward pools belong to another month — show them read-only so a
  // Save Pools can't try to write rows that don't exist for the selected month.
  const poolsEditable = editable && !poolsCarriedFrom;

  // "Standard Fees By Department" block (sheet rows 71-108), one row per
  // category. Order matches the sheet; the manual-cell default hints come
  // from the sheet's own margin notes. All derived math (New ETC Hours,
  // Standard Fee, and — cross-linked — every job row's Standard Fee
  // allocation above) is computed live client-side in StandardSheetLive.
  const POOL_ROWS = [
    { category: "ENGINEERING_PM", group: "Engineering", dept: "PM", hint: "Defaults to 450" },
    { category: "ENGINEERING_WARRANTY", group: "Engineering", dept: "Warranty", hint: "Defaults to Hours Worked This Month" },
    { category: "SHOP_MANUFACTURING", group: "Shop", dept: "Manufacturing", hint: "Defaults to Hours Worked This Month" },
    { category: "SHOP_WARRANTY", group: "Shop", dept: "Warranty", hint: "Defaults to Hours Worked This Month" },
  ] as const;
  const poolByCategory = new Map(effectivePools.map((p) => [p.category, p]));
  const poolRowsProp: PoolRow[] = POOL_ROWS.map(({ category, group, dept, hint }) => {
    const pool = poolByCategory.get(category);
    return {
      category,
      group,
      dept,
      hint,
      data: pool
        ? {
            hoursAvailable: Number(pool.hoursAvailable),
            hoursPulledThisMonth: Number(pool.hoursPulledThisMonth),
            rate: Number(pool.rate),
            previousMonthPulledHours: Number(pool.previousMonthPulledHours),
            newHoursAddedThisMonth: Number(pool.newHoursAddedThisMonth),
            hoursWorkedThisMonth: Number(pool.hoursWorkedThisMonth),
          }
        : null,
    };
  });
  const rateRowsProp: RateRow[] = rows.map((r) => ({
    jobId: r.jobId,
    jobIdLabel: r.jobIdLabel,
    jobName: r.jobName,
    status: r.status,
    etcEngineering: r.etcEngineering,
    etcShop: r.etcShop,
    etcParts: r.etcParts,
    engrRate: Number(r.engrRate),
    shopRate: Number(r.shopRate),
    partsMarkup: Number(r.partsMarkup),
    contingencyAmount: r.contingencyAmount,
    notes: r.notes,
  }));

  return (
    /* key={month}: month switches soft-navigate, reconciling this client
       component in place — its rates/pulled state would otherwise survive
       the switch and mix one month's edits into another's view (this is the
       navigation-level cause of the 2026-07-14 engrRate crash; the in-
       component fallbacks remain as a second line of defense). */
    <StandardSheetLive
      key={month}
      month={month}
      q={q}
      allMonths={allMonths}
      submittedMonths={[...submittedMonths]}
      isSubmitted={isSubmitted}
      roleIsAdmin={role === "ADMIN"}
      submittedByName={latestSnapshotMeta?.submittedBy?.name ?? null}
      submittedAtLabel={latestSnapshotMeta ? latestSnapshotMeta.submittedAt.toISOString().slice(0, 16).replace("T", " ") : null}
      editable={editable}
      poolsEditable={poolsEditable}
      poolsCarriedFrom={poolsCarriedFrom}
      initialContingencyRate={contingencyRate}
      rows={rateRowsProp}
      poolRows={poolRowsProp}
      saveRatesAction={saveRates.bind(null, month)}
      saveContingencyRateAction={saveContingencyRate}
      savePoolsAction={savePools.bind(null, month)}
      submitMonthAction={submitStandardSheetMonth.bind(null, month)}
      reopenMonthAction={reopenStandardSheetMonth.bind(null, month)}
      refreshPoolsAction={refreshPools.bind(null, month)}
    />
  );
}

