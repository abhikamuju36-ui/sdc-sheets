import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { compareJobIds } from "@/lib/job-filters";
import { getEtcMonthJobWhere } from "@/lib/etc-month-jobs";
import { getExecutionEtcByJob } from "@/lib/execution-etc";
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
import { BUTTON_PRIMARY, BUTTON_SECONDARY, TABLE_HEADER_ROW, TABLE_GRID } from "@/components/ui/classnames";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SelectOnFocusInput } from "@/components/SelectOnFocusInput";
import { MonthSelect } from "@/components/MonthSelect";

const RATE_INPUT_CLASS =
  "w-12 [appearance:textfield] border-none bg-transparent px-1 py-1 text-right text-xs outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none disabled:text-sdc-gray-400";

// Heavier divider at the start of each named column block (Execution Rates /
// Execution ETC / Total ETC / Standard Fees / Contingency / Total Standard
// Fees / Notes) — same weight/treatment as the Monthly ETC grid's phase
// dividers, for a consistent "major block boundary" look app-wide. `!` forces
// it to win over TABLE_GRID's blanket `[&_th]:border-l`/`[&_td]:border-l`
// rules, which — being a class+element selector — otherwise out-specificity
// a plain utility class and silently reset the border back to the thin default.
// Matches TABLE_GRID's own gridline color (#2b2b2b, a blackish charcoal)
// exactly — same color on both the wide border-left and the thin
// border-bottom means their mitered corner is invisible, instead of the
// jagged two-tone seam a mismatched divider color made.
const BLOCK_EDGE = "border-l-[33px]! border-l-[#2b2b2b]!";

function wholeHours(n: number): string {
  return Math.round(n).toString();
}

function currency(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function percent(n: number): string {
  return (n * 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "%";
}

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
async function assertMonthNotSubmitted(month: string) {
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
  const month = monthParam || allMonths[0] || currentMonth();
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

  // Grand totals footer, matching the sheet's SUM row 66.
  const grand = rows.reduce(
    (acc, r) => ({
      totalEtcDollars: acc.totalEtcDollars + r.totalEtcDollars,
      percentOfTotal: acc.percentOfTotal + r.percentOfTotal,
      standardFeeEngineering: acc.standardFeeEngineering + r.standardFeeEngineering,
      standardFeeShop: acc.standardFeeShop + r.standardFeeShop,
      contingencyAmount: acc.contingencyAmount + r.contingencyAmount,
      totalStandardFees: acc.totalStandardFees + r.totalStandardFees,
    }),
    { totalEtcDollars: 0, percentOfTotal: 0, standardFeeEngineering: 0, standardFeeShop: 0, contingencyAmount: 0, totalStandardFees: 0 }
  );

  const editable = !isSubmitted;
  // Carried-forward pools belong to another month — show them read-only so a
  // Save Pools can't try to write rows that don't exist for the selected month.
  const poolsEditable = editable && !poolsCarriedFrom;

  // "Standard Fees By Department" block (sheet rows 71-108), one display row
  // per category. Order matches the sheet; the manual-cell default hints come
  // from the sheet's own margin notes.
  const POOL_ROWS = [
    { category: "ENGINEERING_PM", group: "Engineering", dept: "PM", hint: "Defaults to 450" },
    { category: "ENGINEERING_WARRANTY", group: "Engineering", dept: "Warranty", hint: "Defaults to Hours Worked This Month" },
    { category: "SHOP_MANUFACTURING", group: "Shop", dept: "Manufacturing", hint: "Defaults to Hours Worked This Month" },
    { category: "SHOP_WARRANTY", group: "Shop", dept: "Warranty", hint: "Defaults to Hours Worked This Month" },
  ] as const;
  const poolByCategory = new Map(effectivePools.map((p) => [p.category, p]));
  const engineeringTotal = ["ENGINEERING_PM", "ENGINEERING_WARRANTY"].reduce(
    (sum, c) => sum + Number(poolByCategory.get(c as never)?.standardFee ?? 0),
    0
  );
  const shopTotal = ["SHOP_MANUFACTURING", "SHOP_WARRANTY"].reduce(
    (sum, c) => sum + Number(poolByCategory.get(c as never)?.standardFee ?? 0),
    0
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <form className="flex w-full max-w-md gap-2">
          <input type="hidden" name="month" value={month} />
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search by Job Id or name…"
            className="w-full rounded-md border border-sdc-border px-3 py-2 text-sm focus:border-sdc-blue focus:outline-none"
          />
          <button type="submit" className="rounded-md bg-sdc-navy px-4 py-2 text-sm font-medium whitespace-nowrap text-white">
            Search
          </button>
        </form>

        <span className="text-xs font-medium text-sdc-gray-500">Month:</span>
        <MonthSelect
          months={allMonths}
          current={month}
          basePath="/standard-sheet"
          lockedMonths={[...submittedMonths]}
          inProgressSuffix=""
        />

        <StatusBadge variant={isSubmitted ? "locked" : "needsReview"}>
          {isSubmitted ? "Submitted (frozen)" : "Live — not submitted"}
        </StatusBadge>
        {isSubmitted && latestSnapshotMeta && (
          <span className="text-xs text-sdc-gray-400">
            Submitted by {latestSnapshotMeta.submittedBy?.name ?? "—"} on{" "}
            {latestSnapshotMeta.submittedAt.toISOString().slice(0, 16).replace("T", " ")}
          </span>
        )}
        {!isSubmitted && rows.length > 0 && (
          <form action={submitStandardSheetMonth.bind(null, month)}>
            <button type="submit" className={BUTTON_PRIMARY}>
              Submit {month}
            </button>
          </form>
        )}
        {isSubmitted && role === "ADMIN" && (
          <form action={reopenStandardSheetMonth.bind(null, month)}>
            <button type="submit" className={BUTTON_SECONDARY}>
              Reopen for editing
            </button>
          </form>
        )}

        {editable && (
          <form action={refreshPools.bind(null, month)}>
            <button type="submit" className={BUTTON_SECONDARY}>
              Refresh Pools (Power BI)
            </button>
          </form>
        )}

        {editable && (
          <form action={saveContingencyRate} className="flex items-center gap-2">
            <label className="text-xs font-medium text-sdc-gray-500">Global Contingency Rate</label>
            <SelectOnFocusInput
              type="number"
              step="0.01"
              name="contingencyRate"
              defaultValue={contingencyRate.toString()}
              className="w-16 rounded-md border border-sdc-border px-1.5 py-2 text-right text-sm outline-none focus:border-sdc-blue"
            />
            <button type="submit" className={BUTTON_SECONDARY}>
              Save
            </button>
          </form>
        )}
      </div>

      <div className="flex flex-col items-start gap-6 xl:flex-row">
      <form action={saveRates.bind(null, month)} className="min-w-0 flex-1">
        <h2 className="mb-2 font-heading text-base font-semibold tracking-tight text-sdc-navy">
          Execution Rates &amp; Standard Fees — {month}
        </h2>
        <div className="max-h-[calc(100vh-260px)] min-w-[480px] overflow-auto border border-sdc-border bg-white shadow-sm select-none styled-scrollbar">
          <table className={`w-full text-sm ${TABLE_GRID}`}>
            <thead className="sticky top-0 z-20 bg-white">
              <tr className={TABLE_HEADER_ROW}>
                <th rowSpan={3} className="sticky left-0 z-10 w-10 min-w-10 bg-white px-2 py-3 text-center align-bottom">#</th>
                <th rowSpan={3} className="sticky left-10 z-10 w-20 min-w-20 bg-white px-3 py-3 align-bottom">Job Id</th>
                <th rowSpan={3} className="sticky left-[120px] z-10 bg-white px-3 py-3 align-bottom">Job Name</th>
                <th rowSpan={3} className="border-l border-sdc-border px-3 py-3 align-bottom">Job Status</th>
                <th colSpan={3} className={`${BLOCK_EDGE} px-3 py-2 text-center`}>
                  Execution Rates <span className="text-sdc-blue" title="Editable column">✎</span>
                </th>
                <th colSpan={3} className={`${BLOCK_EDGE} bg-sdc-blue-light/40 px-3 py-2 text-center text-sdc-blue-dark`}>Execution ETC</th>
                <th colSpan={2} className={`${BLOCK_EDGE} bg-sdc-gray-100 px-3 py-2 text-center text-sdc-gray-700`}>Total ETC</th>
                <th colSpan={2} className={`${BLOCK_EDGE} bg-[#D6E4F0] px-3 py-2 text-center text-sdc-blue-dark`}>Standard Fees</th>
                <th rowSpan={3} className={`${BLOCK_EDGE} bg-[#F8D7DA] px-3 py-2 text-center text-red-800`}>
                  Contingency <span title="Editable column">✎</span>
                </th>
                <th rowSpan={3} className={`${BLOCK_EDGE} bg-sdc-yellow-bg px-3 py-3 text-center align-bottom`}>Total Standard Fees</th>
                <th rowSpan={3} className={`${BLOCK_EDGE} px-3 py-3 align-bottom`}>
                  Notes <span className="text-sdc-blue" title="Editable column">✎</span>
                </th>
              </tr>
              <tr className={TABLE_HEADER_ROW}>
                <th className={`${BLOCK_EDGE} px-2 py-2 text-center`}>ENGR</th>
                <th className="px-2 py-2 text-center">Shop</th>
                <th className="px-2 py-2 text-center">Parts</th>
                <th className={`${BLOCK_EDGE} bg-sdc-blue-light/40 px-2 py-2 text-center text-sdc-blue-dark`}>Engineering</th>
                <th className="bg-sdc-blue-light/40 px-2 py-2 text-center text-sdc-blue-dark">Shop</th>
                <th className="bg-sdc-blue-light/40 px-2 py-2 text-center text-sdc-blue-dark">Parts</th>
                <th className={`${BLOCK_EDGE} bg-sdc-gray-100 px-2 py-2 text-center text-sdc-gray-700`}>Total ETC</th>
                <th className="bg-sdc-gray-100 px-2 py-2 text-center text-sdc-gray-700">% Total</th>
                <th className={`${BLOCK_EDGE} bg-[#D6E4F0] px-2 py-2 text-center text-sdc-blue-dark`}>Engineering</th>
                <th className="bg-[#D6E4F0] px-2 py-2 text-center text-sdc-blue-dark">Shop</th>
              </tr>
              <tr className={TABLE_HEADER_ROW}>
                <th className={`${BLOCK_EDGE} px-2 py-1.5 text-center text-[10px]`}>All</th>
                <th className="px-2 py-1.5 text-center text-[10px]">All</th>
                <th className="px-2 py-1.5 text-center text-[10px]">All</th>
                <th className={`${BLOCK_EDGE} bg-sdc-blue-light/40 px-2 py-1.5 text-center text-[10px] text-sdc-blue-dark`}>New ETC</th>
                <th className="bg-sdc-blue-light/40 px-2 py-1.5 text-center text-[10px] text-sdc-blue-dark">New ETC</th>
                <th className="bg-sdc-blue-light/40 px-2 py-1.5 text-center text-[10px] text-sdc-blue-dark">New ETC</th>
                <th className={`${BLOCK_EDGE} bg-sdc-gray-100 px-2 py-1.5 text-[10px]`}></th>
                <th className="bg-sdc-gray-100 px-2 py-1.5 text-[10px]"></th>
                <th className={`${BLOCK_EDGE} bg-[#D6E4F0] px-2 py-1.5 text-center text-[10px] text-sdc-blue-dark`}>PM/Warranty</th>
                <th className="bg-[#D6E4F0] px-2 py-1.5 text-center text-[10px] text-sdc-blue-dark">MFG/Warranty</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.jobId} className={`hover:bg-sdc-blue-light/40 ${i % 2 === 1 ? "bg-sdc-gray-50/60" : ""}`}>
                  <td className={`sticky left-0 z-10 w-10 min-w-10 px-2 py-2 text-center text-sdc-gray-400 ${i % 2 === 1 ? "bg-sdc-gray-50" : "bg-white"}`}>
                    {i + 1}
                  </td>
                  <td className={`sticky left-10 z-10 w-20 min-w-20 px-3 py-2 font-mono text-sdc-gray-400 ${i % 2 === 1 ? "bg-sdc-gray-50" : "bg-white"}`}>
                    {r.jobIdLabel}
                  </td>
                  <td
                    className={`sticky left-[120px] z-10 min-w-[240px] whitespace-nowrap px-3 py-2 font-medium text-sdc-navy ${i % 2 === 1 ? "bg-sdc-gray-50" : "bg-white"}`}
                    title={r.jobName}
                  >
                    {r.jobName}
                  </td>
                  <td className="border-l border-sdc-border px-3 py-2 text-sdc-gray-400">{r.status}</td>
                  <td className={`${BLOCK_EDGE} px-2 py-2`}>
                    {editable && <input type="hidden" name="jobId" value={r.jobId} />}
                    <SelectOnFocusInput
                      type="number"
                      step="0.01"
                      name={`engrRate__${r.jobId}`}
                      defaultValue={r.engrRate}
                      disabled={!editable}
                      aria-label={`ENGR rate, ${r.jobName}`}
                      className={RATE_INPUT_CLASS}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <SelectOnFocusInput
                      type="number"
                      step="0.01"
                      name={`shopRate__${r.jobId}`}
                      defaultValue={r.shopRate}
                      disabled={!editable}
                      aria-label={`Shop rate, ${r.jobName}`}
                      className={RATE_INPUT_CLASS}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <SelectOnFocusInput
                      type="number"
                      step="0.01"
                      name={`partsMarkup__${r.jobId}`}
                      defaultValue={r.partsMarkup}
                      disabled={!editable}
                      aria-label={`Parts markup, ${r.jobName}`}
                      className={RATE_INPUT_CLASS}
                    />
                  </td>
                  <td className={`${BLOCK_EDGE} bg-sdc-blue-light/10 px-1 py-2 text-right text-xs text-sdc-navy`}>{wholeHours(r.etcEngineering)}</td>
                  <td className="bg-sdc-blue-light/10 px-1 py-2 text-right text-xs text-sdc-navy">{wholeHours(r.etcShop)}</td>
                  <td className="bg-sdc-blue-light/10 px-1 py-2 text-right text-xs text-sdc-navy">{currency(r.etcParts)}</td>
                  <td className={`${BLOCK_EDGE} bg-sdc-gray-50 px-1 py-2 text-right text-xs text-sdc-navy`}>{currency(r.totalEtcDollars)}</td>
                  <td className="bg-sdc-gray-50 px-1 py-2 text-right text-xs text-sdc-navy">{percent(r.percentOfTotal)}</td>
                  <td className={`${BLOCK_EDGE} bg-[#D6E4F0]/40 px-1 py-2 text-right text-xs text-sdc-navy`}>{currency(r.standardFeeEngineering)}</td>
                  <td className="bg-[#D6E4F0]/40 px-1 py-2 text-right text-xs text-sdc-navy">{currency(r.standardFeeShop)}</td>
                  <td className={`${BLOCK_EDGE} bg-[#F8D7DA]/40 px-2 py-2`}>
                    {editable ? (
                      <SelectOnFocusInput
                        type="number"
                        step="0.01"
                        name={`contingencyAmount__${r.jobId}`}
                        defaultValue={r.contingencyAmount ? r.contingencyAmount.toString() : ""}
                        placeholder="—"
                        aria-label={`Contingency amount, ${r.jobName}`}
                        className="w-20 [appearance:textfield] border-none bg-transparent px-1.5 py-1 text-right text-xs outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    ) : (
                      <span className="block px-1.5 py-1 text-right text-xs text-sdc-gray-500">
                        {r.contingencyAmount ? currency(r.contingencyAmount) : "—"}
                      </span>
                    )}
                  </td>
                  <td className={`${BLOCK_EDGE} bg-sdc-yellow-bg/60 px-1 py-2 text-right text-xs font-medium text-sdc-navy`}>
                    {currency(r.totalStandardFees)}
                  </td>
                  <td className={`${BLOCK_EDGE} px-2 py-2`}>
                    {editable ? (
                      <SelectOnFocusInput
                        type="text"
                        name={`notes__${r.jobId}`}
                        defaultValue={r.notes}
                        aria-label={`Notes, ${r.jobName}`}
                        className="w-48 border-none bg-transparent px-1.5 py-1 text-xs outline-none"
                      />
                    ) : (
                      <span className="block min-w-48 whitespace-nowrap px-1.5 py-1 text-xs text-sdc-gray-500" title={r.notes}>
                        {r.notes || "—"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={17} className="px-4 py-5 text-sdc-gray-400">
                    No jobs found for {month}.
                  </td>
                </tr>
              )}
              {rows.length > 0 && (
                <tr className="border-t-2 border-sdc-navy bg-sdc-gray-100 font-medium">
                  <td className="sticky left-0 z-10 bg-sdc-gray-100 px-3 py-2" colSpan={4}>
                    Total
                  </td>
                  <td className={`${BLOCK_EDGE} px-2 py-2`} colSpan={3}></td>
                  <td className={`${BLOCK_EDGE} px-2 py-2`} colSpan={3}></td>
                  <td className={`${BLOCK_EDGE} px-1 py-2 text-right text-xs text-sdc-navy`}>{currency(grand.totalEtcDollars)}</td>
                  <td className="px-1 py-2 text-right text-xs text-sdc-navy">{percent(grand.percentOfTotal)}</td>
                  <td className={`${BLOCK_EDGE} px-1 py-2 text-right text-xs text-sdc-navy`}>{currency(grand.standardFeeEngineering)}</td>
                  <td className="px-1 py-2 text-right text-xs text-sdc-navy">{currency(grand.standardFeeShop)}</td>
                  <td className={`${BLOCK_EDGE} px-1 py-2 text-right text-xs text-sdc-navy`}>
                    {grand.contingencyAmount ? currency(grand.contingencyAmount) : "—"}
                  </td>
                  <td className={`${BLOCK_EDGE} px-1 py-2 text-right text-xs font-semibold text-sdc-navy`}>{currency(grand.totalStandardFees)}</td>
                  <td className={`${BLOCK_EDGE} px-2 py-2`}></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {editable && rows.length > 0 && (
          <div className="mt-4">
            <button type="submit" className={`${BUTTON_PRIMARY} px-5 py-2.5`}>
              Save Rates
            </button>
          </div>
        )}
      </form>

      {/* "Standard Fees By Department" — sheet rows 71-108. Prev Pulled / New Added /
          Hours Worked come from Power BI (Refresh Pools); Pulled and Rate are the
          sheet's manual yellow cells; the rest are derived exactly like the sheet. */}
      <div className="w-fit max-w-full shrink-0">
        <h2 className="mb-2 font-heading text-base font-semibold tracking-tight text-sdc-navy">
          Standard Fees By Department — {month}
        </h2>
        {poolsCarriedFrom && (
          <p className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No pool data has been pulled for {month} yet — showing {poolsCarriedFrom}&apos;s figures as an estimate (Standard
            Fees above are allocated from these). Click &quot;Refresh Pools (Power BI)&quot; above to pull {month}&apos;s exact numbers.
          </p>
        )}
        <form action={savePools.bind(null, month)}>
          <div className="max-h-[calc(100vh-260px)] w-fit max-w-full overflow-auto border border-sdc-border bg-white shadow-sm select-none styled-scrollbar">
            <table className={`text-sm ${TABLE_GRID}`}>
              <colgroup>
                <col className="w-32" />
                <col className="w-28" />
                <col className="w-56" />
                <col className="w-28" />
              </colgroup>
              <thead className="sticky top-0 z-20 bg-white">
                <tr className={TABLE_HEADER_ROW}>
                  <th className="px-3 py-2">Billing Group</th>
                  <th className="px-3 py-2">Department</th>
                  <th className="px-3 py-2">Attribute</th>
                  <th className="px-3 py-2 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {/* Transposed to match the workbook's "Standard Fees By Department"
                    block: one attribute per row, grouped under Billing Group /
                    Department cells that span their attribute rows. Yellow rows
                    (Hours being pulled / Rate) are the manual editable cells. */}
                {(["Engineering", "Shop"] as const).flatMap((group) => {
                  const band = group === "Engineering" ? "bg-[#D9E7F5]" : "bg-[#FBE2D5]";
                  const depts = POOL_ROWS.filter((r) => r.group === group);
                  const groupSpan = depts.reduce((n, d) => n + (poolByCategory.get(d.category) ? 7 : 1), 0);
                  let firstOfGroup = true;

                  return depts.flatMap(({ category, dept, hint }) => {
                    const pool = poolByCategory.get(category);
                    const groupCell = (rowSpan: number) => (
                      <td rowSpan={rowSpan} className={`px-3 py-2 text-center font-medium text-sdc-navy ${band}`}>
                        {group}
                      </td>
                    );

                    if (!pool) {
                      const row = (
                        <tr key={category} className="hover:bg-sdc-blue-light/40">
                          {firstOfGroup && groupCell(groupSpan)}
                          <td className="px-3 py-2 text-center text-sdc-gray-700">{dept}</td>
                          <td colSpan={2} className="px-3 py-2 text-sdc-gray-400">
                            No pool data for {month} — use &quot;Refresh Pools (Power BI)&quot;.
                          </td>
                        </tr>
                      );
                      firstOfGroup = false;
                      return [row];
                    }

                    const available = Number(pool.hoursAvailable);
                    const pulled = Number(pool.hoursPulledThisMonth);
                    const newEtc = available - pulled;
                    const hours = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

                    const attrs: { label: string; node: React.ReactNode; yellow?: boolean; bold?: boolean }[] = [
                      { label: "Previous Month Pulled Hours", node: hours(Number(pool.previousMonthPulledHours)) },
                      { label: "New Hours Added this Month", node: hours(Number(pool.newHoursAddedThisMonth)) },
                      { label: "Hours Available", node: hours(available), bold: true },
                      { label: "Hours Worked this Month", node: hours(Number(pool.hoursWorkedThisMonth)) },
                      {
                        label: "Hours being pulled this month",
                        yellow: true,
                        node: poolsEditable ? (
                          <SelectOnFocusInput
                            type="number"
                            step="0.01"
                            name={`pulled__${category}`}
                            defaultValue={pulled.toString()}
                            title={hint}
                            aria-label={`Hours being pulled this month, ${group} ${dept}`}
                            className="w-24 [appearance:textfield] border-none bg-transparent px-1.5 py-1 text-right text-xs outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                        ) : (
                          <span className="text-xs text-sdc-gray-500">{hours(pulled)}</span>
                        ),
                      },
                      { label: "New ETC Hours", node: hours(newEtc), bold: true },
                      { label: "Standard Fee", node: currency(Number(pool.standardFee)), bold: true },
                    ];

                    const rows = attrs.map((a, ai) => (
                      <tr key={`${category}-${a.label}`} className="hover:bg-sdc-blue-light/40">
                        {firstOfGroup && ai === 0 && groupCell(groupSpan)}
                        {ai === 0 && (
                          <td rowSpan={attrs.length} className="px-3 py-2 text-center text-sdc-gray-700">
                            {dept}
                          </td>
                        )}
                        <td className="px-3 py-1.5 text-sdc-gray-700">{a.label}</td>
                        <td className={`px-3 py-1.5 text-right text-xs text-sdc-navy ${a.yellow ? "bg-sdc-yellow-bg/60" : ""} ${a.bold ? "font-semibold" : ""}`}>
                          {a.node}
                        </td>
                      </tr>
                    ));
                    firstOfGroup = false;
                    return rows;
                  });
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-sdc-navy bg-sdc-gray-100 text-xs font-medium">
                  <td colSpan={3} className="px-3 py-2 text-right">
                    <span className="mr-6 rounded bg-[#D9E7F5] px-2 py-0.5 text-sdc-navy">
                      Engineering Total: {currency(engineeringTotal)}
                    </span>
                    <span className="rounded bg-[#FBE2D5] px-2 py-0.5 text-sdc-navy">
                      Shop Total: {currency(shopTotal)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-sdc-navy">
                    {currency(engineeringTotal + shopTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {poolsEditable && effectivePools.length > 0 && (
            <div className="mt-2">
              <button type="submit" className={BUTTON_SECONDARY}>
                Save Pools
              </button>
            </div>
          )}
        </form>
      </div>
      </div>
    </div>
  );
}
