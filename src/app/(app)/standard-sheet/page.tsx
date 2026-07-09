import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { validJobTypeFilter, compareJobIds } from "@/lib/job-filters";
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
import type { Prisma } from "@prisma/client";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, TABLE_HEADER_ROW, TABLE_GRID } from "@/components/ui/classnames";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PillLinks } from "@/components/ui/PillLinks";
import { SelectOnFocusInput } from "@/components/SelectOnFocusInput";

const RATE_INPUT_CLASS =
  "w-16 [appearance:textfield] border-none bg-transparent px-1.5 py-1 text-right text-xs outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none disabled:text-sdc-gray-400";

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

async function saveRates(formData: FormData) {
  "use server";
  const jobIds = formData.getAll("jobId").map((v) => Number(v));

  const rates = jobIds.map((jobId) => ({
    jobId,
    engrRate: Number(formData.get(`engrRate__${jobId}`)),
    shopRate: Number(formData.get(`shopRate__${jobId}`)),
    partsMarkup: Number(formData.get(`partsMarkup__${jobId}`)),
    contingencyAmount: Number(formData.get(`contingencyAmount__${jobId}`)) || 0,
    notes: String(formData.get(`notes__${jobId}`) ?? ""),
  }));

  await Promise.all(
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
  const contingencyRate = Number(formData.get("contingencyRate"));
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
  await assertMonthNotSubmitted(month);
  const categories = ["ENGINEERING_PM", "ENGINEERING_WARRANTY", "SHOP_MANUFACTURING", "SHOP_WARRANTY"] as const;
  const changes: Record<string, unknown>[] = [];

  for (const category of categories) {
    const pool = await prisma.categoryPool.findUnique({ where: { category_month: { category, month } } });
    if (!pool) continue; // pool rows come from Refresh Pools (Power BI) or migration

    const hoursPulledThisMonth = Number(formData.get(`pulled__${category}`)) || 0;
    const rate = Number(formData.get(`rate__${category}`)) || 0;
    const newEtcHours = Number(pool.hoursAvailable) - hoursPulledThisMonth;
    const standardFee = newEtcHours * rate;

    await prisma.categoryPool.update({
      where: { id: pool.id },
      data: { hoursPulledThisMonth, rate, newEtcHours, standardFee },
    });
    changes.push({ category, hoursPulledThisMonth, rate, newEtcHours, standardFee });
  }

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
  await assertMonthNotSubmitted(month);
  const session = await auth();
  const user = session?.user?.email
    ? await prisma.user.findUnique({ where: { email: session.user.email } })
    : null;

  const jobs = await prisma.job.findMany({
    where: { ...validJobTypeFilter, status: "Active", completeDate: null },
    select: { id: true, executionRate: true },
  });
  const [etcByJob, pools, setting] = await Promise.all([
    getExecutionEtcByJob(jobs.map((j) => j.id), month),
    prisma.categoryPool.findMany({ where: { month } }),
    prisma.standardSheetSetting.findUnique({ where: { id: 1 } }),
  ]);
  const contingencyRate = setting ? Number(setting.contingencyRate) : 1.2;
  const poolTotals = {
    engineeringPM: Number(pools.find((p) => p.category === "ENGINEERING_PM")?.standardFee ?? 0),
    engineeringWarranty: Number(pools.find((p) => p.category === "ENGINEERING_WARRANTY")?.standardFee ?? 0),
    shopManufacturing: Number(pools.find((p) => p.category === "SHOP_MANUFACTURING")?.standardFee ?? 0),
    shopWarranty: Number(pools.find((p) => p.category === "SHOP_WARRANTY")?.standardFee ?? 0),
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
      where: { ...validJobTypeFilter, status: "Active", completeDate: null },
      select: { id: true, jobId: true, jobName: true, status: true, executionRate: true },
    });
    jobs.sort((a, b) => compareJobIds(a.jobId, b.jobId)); // numeric, not lexicographic
    const etcByJob = await getExecutionEtcByJob(jobs.map((j) => j.id), month);
    const poolTotals = {
      engineeringPM: Number(pools.find((p) => p.category === "ENGINEERING_PM")?.standardFee ?? 0),
      engineeringWarranty: Number(pools.find((p) => p.category === "ENGINEERING_WARRANTY")?.standardFee ?? 0),
      shopManufacturing: Number(pools.find((p) => p.category === "SHOP_MANUFACTURING")?.standardFee ?? 0),
      shopWarranty: Number(pools.find((p) => p.category === "SHOP_WARRANTY")?.standardFee ?? 0),
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

  // "Standard Fees By Department" block (sheet rows 71-108), one display row
  // per category. Order matches the sheet; the manual-cell default hints come
  // from the sheet's own margin notes.
  const POOL_ROWS = [
    { category: "ENGINEERING_PM", group: "Engineering", dept: "PM", hint: "Defaults to 450" },
    { category: "ENGINEERING_WARRANTY", group: "Engineering", dept: "Warranty", hint: "Defaults to Hours Worked This Month" },
    { category: "SHOP_MANUFACTURING", group: "Shop", dept: "Manufacturing", hint: "Defaults to Hours Worked This Month" },
    { category: "SHOP_WARRANTY", group: "Shop", dept: "Warranty", hint: "Defaults to Hours Worked This Month" },
  ] as const;
  const poolByCategory = new Map(pools.map((p) => [p.category, p]));
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
      <p className="mb-4 text-sm text-sdc-gray-400">
        Month-scoped Standard Sheet — Execution ETC pulls that month&apos;s Monthly ETC entries; Total ETC,
        % Total, Standard Fees, and Total Standard Fees mirror the workbook&apos;s columns L/M/O/P/T.
        Submitting a month freezes it, like the old archive tabs.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-sdc-gray-500">Month:</span>
        {allMonths.length === 0 && <span className="text-xs text-sdc-gray-400">no ETC history yet</span>}
        <PillLinks
          items={allMonths.map((m) => ({
            key: m,
            label: submittedMonths.has(m) ? `${m} ✓` : m,
            href: `/standard-sheet?month=${m}`,
            active: m === month,
          }))}
        />
        {!allMonths.includes(month) && <StatusBadge variant="active">{month} (current, no entries)</StatusBadge>}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
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
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <form className="flex gap-2 rounded-xl border border-sdc-border bg-white p-3 shadow-sm">
          <input type="hidden" name="month" value={month} />
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search by Job Id or name…"
            className="w-64 rounded-lg border border-sdc-border px-3 py-2 text-sm focus:border-sdc-blue focus:outline-none"
          />
          <button type="submit" className="rounded-lg bg-sdc-navy px-4 py-2 text-sm font-medium text-white">
            Search
          </button>
        </form>

        {editable && (
          <form action={refreshPools.bind(null, month)}>
            <button type="submit" className={BUTTON_SECONDARY}>
              Refresh Pools (Power BI)
            </button>
          </form>
        )}

        {editable && (
          <form action={saveContingencyRate} className="flex items-center gap-2 rounded-xl border border-sdc-border bg-white p-3 shadow-sm">
            <label className="text-xs font-medium text-sdc-gray-400">Global Contingency Rate</label>
            <SelectOnFocusInput
              type="number"
              step="0.01"
              name="contingencyRate"
              defaultValue={contingencyRate.toString()}
              className="w-16 rounded-md border border-sdc-border px-1.5 py-1 text-right text-sm outline-none focus:border-sdc-blue"
            />
            <button type="submit" className={BUTTON_SECONDARY}>
              Save
            </button>
          </form>
        )}
      </div>

      {/* "Standard Fees By Department" — sheet rows 71-108. Prev Pulled / New Added /
          Hours Worked come from Power BI (Refresh Pools); Pulled and Rate are the
          sheet's manual yellow cells; the rest are derived exactly like the sheet. */}
      <div className="mb-6">
        <h2 className="mb-2 font-heading text-base font-semibold tracking-tight text-sdc-navy">
          Standard Fees By Department — {month}
        </h2>
        <form action={savePools.bind(null, month)}>
          <div className="overflow-x-auto border border-sdc-border bg-white shadow-sm">
            <table className={`text-sm ${TABLE_GRID}`}>
              <thead>
                <tr className={TABLE_HEADER_ROW}>
                  <th className="px-3 py-2">Billing Group</th>
                  <th className="px-3 py-2">Department</th>
                  <th className="border-l border-sdc-border px-3 py-2 text-right">Previous Month Pulled Hours</th>
                  <th className="px-3 py-2 text-right">New Hours Added this Month</th>
                  <th className="px-3 py-2 text-right">Hours Available</th>
                  <th className="px-3 py-2 text-right">Hours Worked this Month</th>
                  <th className="bg-sdc-yellow-bg px-3 py-2 text-right">Hours being pulled this month</th>
                  <th className="px-3 py-2 text-right">New ETC Hours</th>
                  <th className="bg-sdc-yellow-bg px-3 py-2 text-right">Rate</th>
                  <th className="border-l border-sdc-border px-3 py-2 text-right">Standard Fee</th>
                </tr>
              </thead>
              <tbody>
                {POOL_ROWS.map(({ category, group, dept, hint }, i) => {
                  const pool = poolByCategory.get(category);
                  const groupBg = group === "Engineering" ? "bg-[#D9E7F5]" : "bg-[#FBE2D5]";
                  const zebra = i % 2 === 1 ? "bg-sdc-gray-50/60" : "";
                  if (!pool) {
                    return (
                      <tr key={category} className={zebra}>
                        <td className={`px-3 py-2 font-medium text-sdc-navy ${groupBg}`}>{group}</td>
                        <td className="px-3 py-2 text-sdc-gray-700">{dept}</td>
                        <td colSpan={8} className="px-3 py-2 text-sdc-gray-400">
                          No pool data for {month} — use &quot;Refresh Pools (Power BI)&quot;.
                        </td>
                      </tr>
                    );
                  }
                  const available = Number(pool.hoursAvailable);
                  const pulled = Number(pool.hoursPulledThisMonth);
                  const rate = Number(pool.rate);
                  const newEtc = available - pulled;
                  return (
                    <tr key={category} className={`hover:bg-sdc-blue-light/40 ${zebra}`}>
                      <td className={`px-3 py-2 font-medium text-sdc-navy ${groupBg}`}>{group}</td>
                      <td className="px-3 py-2 text-sdc-gray-700">{dept}</td>
                      <td className="px-3 py-2 text-right text-xs text-sdc-navy">
                        {Number(pool.previousMonthPulledHours).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-sdc-navy">
                        {Number(pool.newHoursAddedThisMonth).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-medium text-sdc-navy">{available.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-xs text-sdc-navy">
                        {Number(pool.hoursWorkedThisMonth).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className="bg-sdc-yellow-bg/60 px-3 py-2 text-right">
                        {editable ? (
                          <SelectOnFocusInput
                            type="number"
                            step="0.01"
                            name={`pulled__${category}`}
                            defaultValue={pulled.toString()}
                            title={hint}
                            aria-label={`Hours being pulled this month, ${group} ${dept}`}
                            className="w-20 [appearance:textfield] border-none bg-transparent px-1.5 py-1 text-right text-xs outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                        ) : (
                          <span className="text-xs text-sdc-gray-500">{pulled.toLocaleString()}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-medium text-sdc-navy">{newEtc.toLocaleString()}</td>
                      <td className="bg-sdc-yellow-bg/60 px-3 py-2 text-right">
                        {editable ? (
                          <SelectOnFocusInput
                            type="number"
                            step="0.01"
                            name={`rate__${category}`}
                            defaultValue={rate.toString()}
                            aria-label={`Rate, ${group} ${dept}`}
                            className="w-14 [appearance:textfield] border-none bg-transparent px-1.5 py-1 text-right text-xs outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                        ) : (
                          <span className="text-xs text-sdc-gray-500">{rate.toLocaleString()}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-semibold text-sdc-navy">
                        {currency(Number(pool.standardFee))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-sdc-navy bg-sdc-gray-100 text-xs font-medium">
                  <td colSpan={9} className="px-3 py-2 text-right">
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
          {editable && pools.length > 0 && (
            <div className="mt-2">
              <button type="submit" className={BUTTON_SECONDARY}>
                Save Pools
              </button>
            </div>
          )}
        </form>
      </div>

      <form action={saveRates}>
        <div className="overflow-x-auto border border-sdc-border bg-white shadow-sm">
          <table className={`text-sm ${TABLE_GRID}`}>
            <thead>
              <tr className={TABLE_HEADER_ROW}>
                <th rowSpan={3} className="sticky left-0 z-10 bg-white px-3 py-3 align-bottom">Job Id</th>
                <th rowSpan={3} className="px-3 py-3 align-bottom">Job Name</th>
                <th rowSpan={3} className="border-l border-sdc-border px-3 py-3 align-bottom">Job Status</th>
                <th colSpan={3} className="border-l border-sdc-border px-3 py-2 text-center">Execution Rates</th>
                <th colSpan={3} className="border-l border-sdc-border bg-sdc-blue-light/40 px-3 py-2 text-center text-sdc-blue-dark">Execution ETC</th>
                <th colSpan={2} className="border-l border-sdc-border bg-sdc-gray-100 px-3 py-2 text-center text-sdc-gray-700">Total ETC</th>
                <th colSpan={2} className="border-l border-sdc-border bg-[#D6E4F0] px-3 py-2 text-center text-sdc-blue-dark">Standard Fees</th>
                <th rowSpan={3} className="border-l border-sdc-border bg-[#F8D7DA] px-3 py-2 text-center text-red-800">Contingency</th>
                <th rowSpan={3} className="border-l border-sdc-border bg-sdc-yellow-bg px-3 py-3 text-center align-bottom">Total Standard Fees</th>
                <th rowSpan={3} className="border-l border-sdc-border px-3 py-3 align-bottom">Notes</th>
              </tr>
              <tr className={TABLE_HEADER_ROW}>
                <th className="border-l border-sdc-border px-2 py-2 text-center">ENGR</th>
                <th className="px-2 py-2 text-center">Shop</th>
                <th className="px-2 py-2 text-center">Parts</th>
                <th className="border-l border-sdc-border bg-sdc-blue-light/40 px-2 py-2 text-center text-sdc-blue-dark">Engineering</th>
                <th className="bg-sdc-blue-light/40 px-2 py-2 text-center text-sdc-blue-dark">Shop</th>
                <th className="bg-sdc-blue-light/40 px-2 py-2 text-center text-sdc-blue-dark">Parts</th>
                <th className="border-l border-sdc-border bg-sdc-gray-100 px-2 py-2 text-center text-sdc-gray-700">Total ETC</th>
                <th className="bg-sdc-gray-100 px-2 py-2 text-center text-sdc-gray-700">% Total</th>
                <th className="border-l border-sdc-border bg-[#D6E4F0] px-2 py-2 text-center text-sdc-blue-dark">Engineering</th>
                <th className="bg-[#D6E4F0] px-2 py-2 text-center text-sdc-blue-dark">Shop</th>
              </tr>
              <tr className={TABLE_HEADER_ROW}>
                <th className="border-l border-sdc-border px-2 py-1.5 text-center text-[10px]">All</th>
                <th className="px-2 py-1.5 text-center text-[10px]">All</th>
                <th className="px-2 py-1.5 text-center text-[10px]">All</th>
                <th className="border-l border-sdc-border bg-sdc-blue-light/40 px-2 py-1.5 text-center text-[10px] text-sdc-blue-dark">New ETC</th>
                <th className="bg-sdc-blue-light/40 px-2 py-1.5 text-center text-[10px] text-sdc-blue-dark">New ETC</th>
                <th className="bg-sdc-blue-light/40 px-2 py-1.5 text-center text-[10px] text-sdc-blue-dark">New ETC</th>
                <th className="border-l border-sdc-border bg-sdc-gray-100 px-2 py-1.5 text-[10px]"></th>
                <th className="bg-sdc-gray-100 px-2 py-1.5 text-[10px]"></th>
                <th className="border-l border-sdc-border bg-[#D6E4F0] px-2 py-1.5 text-center text-[10px] text-sdc-blue-dark">PM/Warranty</th>
                <th className="bg-[#D6E4F0] px-2 py-1.5 text-center text-[10px] text-sdc-blue-dark">MFG/Warranty</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.jobId} className={`hover:bg-sdc-blue-light/40 ${i % 2 === 1 ? "bg-sdc-gray-50/60" : ""}`}>
                  <td className={`sticky left-0 z-10 px-3 py-2 font-mono text-sdc-gray-400 ${i % 2 === 1 ? "bg-sdc-gray-50/60" : "bg-white"}`}>
                    {r.jobIdLabel}
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-2 font-medium text-sdc-navy" title={r.jobName}>
                    {r.jobName}
                  </td>
                  <td className="border-l border-sdc-border px-3 py-2 text-sdc-gray-400">{r.status}</td>
                  <td className="border-l border-sdc-border px-2 py-2">
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
                  <td className="border-l border-sdc-border bg-sdc-blue-light/10 px-2 py-2 text-right text-xs text-sdc-navy">{wholeHours(r.etcEngineering)}</td>
                  <td className="bg-sdc-blue-light/10 px-2 py-2 text-right text-xs text-sdc-navy">{wholeHours(r.etcShop)}</td>
                  <td className="bg-sdc-blue-light/10 px-2 py-2 text-right text-xs text-sdc-navy">{currency(r.etcParts)}</td>
                  <td className="border-l border-sdc-border bg-sdc-gray-50 px-2 py-2 text-right text-xs text-sdc-navy">{currency(r.totalEtcDollars)}</td>
                  <td className="bg-sdc-gray-50 px-2 py-2 text-right text-xs text-sdc-navy">{percent(r.percentOfTotal)}</td>
                  <td className="border-l border-sdc-border bg-[#D6E4F0]/40 px-2 py-2 text-right text-xs text-sdc-navy">{currency(r.standardFeeEngineering)}</td>
                  <td className="bg-[#D6E4F0]/40 px-2 py-2 text-right text-xs text-sdc-navy">{currency(r.standardFeeShop)}</td>
                  <td className="border-l border-sdc-border bg-[#F8D7DA]/40 px-2 py-2">
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
                  <td className="border-l border-sdc-border bg-sdc-yellow-bg/60 px-2 py-2 text-right text-xs font-medium text-sdc-navy">
                    {currency(r.totalStandardFees)}
                  </td>
                  <td className="border-l border-sdc-border px-2 py-2">
                    {editable ? (
                      <SelectOnFocusInput
                        type="text"
                        name={`notes__${r.jobId}`}
                        defaultValue={r.notes}
                        aria-label={`Notes, ${r.jobName}`}
                        className="w-32 border-none bg-transparent px-1.5 py-1 text-xs outline-none"
                      />
                    ) : (
                      <span className="block w-32 truncate px-1.5 py-1 text-xs text-sdc-gray-500" title={r.notes}>
                        {r.notes || "—"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={16} className="px-4 py-5 text-sdc-gray-400">
                    No jobs found for {month}.
                  </td>
                </tr>
              )}
              {rows.length > 0 && (
                <tr className="border-t-2 border-sdc-navy bg-sdc-gray-100 font-medium">
                  <td className="sticky left-0 z-10 bg-sdc-gray-100 px-3 py-2" colSpan={3}>
                    Total
                  </td>
                  <td className="border-l border-sdc-border px-2 py-2" colSpan={3}></td>
                  <td className="border-l border-sdc-border px-2 py-2" colSpan={3}></td>
                  <td className="border-l border-sdc-border px-2 py-2 text-right text-xs text-sdc-navy">{currency(grand.totalEtcDollars)}</td>
                  <td className="px-2 py-2 text-right text-xs text-sdc-navy">{percent(grand.percentOfTotal)}</td>
                  <td className="border-l border-sdc-border px-2 py-2 text-right text-xs text-sdc-navy">{currency(grand.standardFeeEngineering)}</td>
                  <td className="px-2 py-2 text-right text-xs text-sdc-navy">{currency(grand.standardFeeShop)}</td>
                  <td className="border-l border-sdc-border px-2 py-2 text-right text-xs text-sdc-navy">
                    {grand.contingencyAmount ? currency(grand.contingencyAmount) : "—"}
                  </td>
                  <td className="border-l border-sdc-border px-2 py-2 text-right text-xs font-semibold text-sdc-navy">{currency(grand.totalStandardFees)}</td>
                  <td className="border-l border-sdc-border px-2 py-2"></td>
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
    </div>
  );
}
