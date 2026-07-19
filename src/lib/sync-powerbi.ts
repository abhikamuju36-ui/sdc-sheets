import { prisma } from "@/lib/prisma";
import { VALID_JOB_TYPES, etcActiveJobFilter } from "@/lib/job-filters";
import { runDax } from "@/lib/powerbi-client";
import { ETC_TRACKED_CODES, PARTS_COST_SECTION } from "@/lib/sections";
import { calcHoursLeft, round2, isMonthLocked } from "@/lib/etc";
import { getPartsCostSpentByJob } from "@/lib/sync-totaleto";
import { fetchJobHoursRows, hoursByJobSection, latestWorkDate, type JobHoursRow } from "@/lib/sharepoint-hours";

// Actual hours worked per job per month, upserted into JobMonthlyActualHours
// (the job-level rollup the dashboard / job detail use). Now summed directly
// from the SharePoint Paylocity export (all tracked sections per job per
// month) instead of Power BI — same underlying data, no dataset dependency.
export async function syncActualHours(): Promise<{
  rowsUpserted: number;
  jobsNotFound: number;
  rowsSkippedOverridden: number;
}> {
  const rows = await fetchJobHoursRows();
  // Sum every tracked section to a per-job, per-month total.
  const byJobMonth = new Map<string, number>(); // `${jobId}::${YYYY-MM}` -> hours
  for (const r of rows) {
    const monthStr = `${r.year}-${String(r.month).padStart(2, "0")}`;
    const key = `${r.jobId}::${monthStr}`;
    byJobMonth.set(key, (byJobMonth.get(key) ?? 0) + r.hours);
  }

  let rowsUpserted = 0;
  let jobsNotFound = 0;
  let rowsSkippedOverridden = 0;

  for (const [key, hours] of byJobMonth) {
    const [jobId, monthStr] = key.split("::");
    const job = await prisma.job.findUnique({ where: { jobId } });
    if (!job) {
      jobsNotFound++;
      continue;
    }

    // Mirrors the legacy "Actual Hours Override" tab: a manually corrected
    // month must not be silently clobbered by the next sync.
    const existing = await prisma.jobMonthlyActualHours.findUnique({
      where: { jobId_month: { jobId: job.id, month: monthStr } },
      select: { overridden: true },
    });
    if (existing?.overridden) {
      rowsSkippedOverridden++;
      continue;
    }

    await prisma.jobMonthlyActualHours.upsert({
      where: { jobId_month: { jobId: job.id, month: monthStr } },
      update: { actualHours: hours, syncedAt: new Date() },
      create: { jobId: job.id, month: monthStr, actualHours: hours, source: "sharepoint" },
    });
    rowsUpserted++;
  }

  await syncHoursRefreshedThrough(rows);

  return { rowsUpserted, jobsNotFound, rowsSkippedOverridden };
}

// Actual hours worked per job PER SECTION for `month`, overwriting
// EtcEntry.hoursWorked directly — the per-department grain the ETC grid
// needs. Always overwrites on refresh; "Hours Worked" is meant to always
// reflect the source, not be independently typed in.
//
// Source is now the Paylocity hours export read straight from SharePoint
// (sharepoint-hours.ts) — no Power BI. Verified 2026-07-19 to reproduce
// PBI's [Hours Actual] by job/section to the hundredth (May 2026, 127/127).
//
// When there are hours in a tracked section the job has no entry for (work
// charged to a section that was never quoted, so startMonth didn't seed it),
// the entry is CREATED rather than the hours silently dropped. Prior ETC for
// these comes from the previous month's entry if one exists, else 0.
export async function syncHoursWorked(month: string): Promise<{ rowsUpdated: number; rowsSkipped: number }> {
  // Re-checked here, not just trusted from the caller's earlier check — this
  // sync does one DB round-trip per row, so it can run long enough for a
  // manager to Submit and Lock this exact month mid-sync. A locked month is
  // frozen history (same rule as submitMonth/clearMonth/syncPowerBiForEtc)
  // and must never be rewritten by a background refresh.
  const monthEntriesAtStart = await prisma.etcEntry.findMany({ where: { month }, select: { needsReview: true } });
  const monthStartedAtStart = monthEntriesAtStart.length > 0;
  if (monthStartedAtStart && isMonthLocked(monthEntriesAtStart)) {
    return { rowsUpdated: 0, rowsSkipped: 0 };
  }

  const [year, monthNum] = month.split("-").map(Number);
  const spentByKey = hoursByJobSection(await fetchJobHoursRows(), year, monthNum);

  let rowsUpdated = 0;
  let rowsSkipped = 0;

  for (const [key, hours] of spentByKey) {
    const [jobId, section] = key.split("::");
    if (!ETC_TRACKED_CODES.has(section)) continue; // ignore codes the ETC grid doesn't track

    const job = await prisma.job.findUnique({ where: { jobId } });
    if (!job) {
      rowsSkipped++;
      continue;
    }

    const entry = await prisma.etcEntry.findUnique({
      where: { jobId_section_month: { jobId: job.id, section, month } },
    });

    if (!entry) {
      // Unquoted-section hours: create the entry so the work is visible, but
      // only for jobs the grid actually shows, only once the month has been
      // started, and only when there are real hours to show. Also refuses to
      // add a fresh needsReview row into a month that's already fully locked
      // — that would silently "unlock" it (isMonthLocked requires every
      // entry to be reviewed) behind the manager's back.
      const qualifies =
        job.status === "Active" && job.completeDate === null && VALID_JOB_TYPES.includes(job.type as (typeof VALID_JOB_TYPES)[number]);
      if (!monthStartedAtStart || !qualifies || hours === 0) {
        rowsSkipped++;
        continue;
      }

      // Re-checked per-row, right before creating: monthStartedAtStart is a
      // top-of-function snapshot, and this loop can run long enough for the
      // month to have been fully locked since — a fresh needsReview:true row
      // would silently "unlock" it the moment it lands.
      const monthEntriesNow = await prisma.etcEntry.findMany({ where: { month }, select: { needsReview: true } });
      if (isMonthLocked(monthEntriesNow)) {
        rowsSkipped++;
        continue;
      }

      const priorEntry = await prisma.etcEntry.findUnique({
        where: { jobId_section_month: { jobId: job.id, section, month: previousMonth(month) } },
        select: { newEtc: true },
      });
      const priorEtc = priorEntry ? Number(priorEntry.newEtc) : 0;

      await prisma.etcEntry.create({
        data: {
          jobId: job.id,
          section,
          month,
          priorEtc,
          hoursWorked: hours,
          hoursLeftCalc: round2(calcHoursLeft(priorEtc, hours)),
          newEtc: priorEtc,
          needsReview: true,
        },
      });
      rowsUpdated++;
      continue;
    }

    // Re-checked per-row: this specific entry could have been submitted
    // (needsReview -> false) since the loop started, even if the month as a
    // whole wasn't locked yet at the top-of-function check.
    if (!entry.needsReview) {
      rowsSkipped++;
      continue;
    }

    const priorEtc = Number(entry.priorEtc);
    // newEtc is deliberately NOT written here — it's manager-entered
    // (submitMonth falls back to the suggestion only at submission time).
    // Hours Left is always the plain Prior ETC − Hours Worked difference.
    await prisma.etcEntry.update({
      where: { id: entry.id },
      data: {
        hoursWorked: hours,
        hoursLeftCalc: round2(calcHoursLeft(priorEtc, hours)),
      },
    });
    rowsUpdated++;
  }

  return { rowsUpdated, rowsSkipped };
}

// "Parts Cost" — a real block in the sheet (Prior ETC / Money Spent Month /
// Money Left / New ETC / Diff, in dollars, no Engineering/Shop split).
// Modeled as an EtcEntry row with section = PARTS_COST_SECTION rather than a
// new table, since the shape matches the hours departments exactly.
//
// Money Spent Month comes DIRECTLY from TotalETO now (getPartsCostSpentByJob),
// not Power BI — verified 2026-07-19 to match Power BI's [Part Cost Purchased]
// to the dollar for every real project job, and it removes the last
// PBI/gateway dependency for the live month. Prior ETC is the app's own prior-
// month confirmed New ETC (the authoritative running balance now that the
// monthly review lives in the app); no prior entry -> opens at 0.
// Creates the row if it doesn't exist yet (unlike the hours sync, which only
// updates existing rows) since Parts Cost has no EstimatedHours-seeded
// counterpart from startMonth().
export async function syncPartsCost(month: string): Promise<{ rowsUpserted: number }> {
  // Same re-check as syncHoursWorkedFromPowerBi: a locked month must never be
  // rewritten, even if it got locked after the caller's own check but before
  // (or during) this function's run.
  const monthEntriesAtStart = await prisma.etcEntry.findMany({ where: { month }, select: { needsReview: true } });
  if (monthEntriesAtStart.length > 0 && isMonthLocked(monthEntriesAtStart)) {
    return { rowsUpserted: 0 };
  }

  const [year, monthNum] = month.split("-").map(Number);
  const monthStart = new Date(Date.UTC(year, monthNum - 1, 1));
  const monthEndExclusive = new Date(Date.UTC(year, monthNum, 1));
  const spentByJobId = await getPartsCostSpentByJob(monthStart, monthEndExclusive);

  const jobs = await prisma.job.findMany({ where: etcActiveJobFilter, select: { id: true, jobId: true } });

  // Prior ETC = the app's own prior-month confirmed Parts New ETC (same chain
  // rule as hours and pools). No prior entry -> opens at 0 (a brand-new job's
  // Parts New ETC is manager-entered anyway).
  const priorMonthParts = await prisma.etcEntry.findMany({
    where: { month: previousMonth(month), section: PARTS_COST_SECTION },
    select: { jobId: true, newEtc: true },
  });
  const priorAppByJobPk = new Map(priorMonthParts.map((e) => [e.jobId, Number(e.newEtc)]));

  let rowsUpserted = 0;

  // One PARTS_COST row per active job that has either an opening balance or
  // money spent this month — skip the all-zero jobs (nothing to show), same
  // spirit as the history backfill's skip rule.
  for (const job of jobs) {
    const priorEtc = priorAppByJobPk.get(job.id) ?? 0;
    const moneySpent = spentByJobId.get(job.jobId) ?? 0;

    const existing = await prisma.etcEntry.findUnique({
      where: { jobId_section_month: { jobId: job.id, section: PARTS_COST_SECTION, month } },
      select: { needsReview: true },
    });

    if (existing) {
      // Re-checked per-row, same reason as syncHoursWorkedFromPowerBi: this
      // entry could have been submitted since the loop started.
      if (!existing.needsReview) continue;
    } else {
      if (priorEtc === 0 && moneySpent === 0) continue; // nothing worth a row yet
      // A brand-new needsReview:true row would silently "unlock" an otherwise
      // fully-locked month — refuse if the month is locked right now.
      const monthEntriesNow = await prisma.etcEntry.findMany({ where: { month }, select: { needsReview: true } });
      if (isMonthLocked(monthEntriesNow)) continue;
    }

    await prisma.etcEntry.upsert({
      where: { jobId_section_month: { jobId: job.id, section: PARTS_COST_SECTION, month } },
      // newEtc deliberately not written — same manager-entered rule as hours.
      update: {
        priorEtc,
        hoursWorked: moneySpent,
        hoursLeftCalc: round2(calcHoursLeft(priorEtc, moneySpent)),
      },
      create: {
        jobId: job.id,
        section: PARTS_COST_SECTION,
        month,
        priorEtc,
        hoursWorked: moneySpent,
        hoursLeftCalc: round2(calcHoursLeft(priorEtc, moneySpent)),
        newEtc: priorEtc,
        needsReview: true,
      },
    });
    rowsUpserted++;
  }

  return { rowsUpserted };
}

interface CategoryPoolRow {
  "Standard Fees[Billing Group]": string;
  "Standard Fees[Department]": string;
  PrevPulled: number | null;
  HoursQuoted: number | null;
  HoursActual: number | null;
}

const POOL_CATEGORY: Record<string, "ENGINEERING_PM" | "ENGINEERING_WARRANTY" | "SHOP_MANUFACTURING" | "SHOP_WARRANTY"> = {
  "Engineering|PM": "ENGINEERING_PM",
  "Engineering|Warranty": "ENGINEERING_WARRANTY",
  "Shop|Manufacturing": "SHOP_MANUFACTURING",
  "Shop|Warranty": "SHOP_WARRANTY",
};

function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const MONTH_NUM_TO_NAME = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

// "2026-07" -> "Jul 2026", matching 'Estimated to Complete Period'[ETC Name]'s
// format exactly (see sync-etc-history.ts's etcNameToMonth, the inverse).
function monthToEtcName(month: string): string {
  const [year, monthNum] = month.split("-").map(Number);
  return `${MONTH_NUM_TO_NAME[monthNum - 1]} ${year}`;
}

// Refreshes the company-wide "Standard Fees By Department" category pools,
// scoped to the requested month's ETC period. Filter by [ETC Name], NEVER
// [ETC Begin Date] — confirmed live (see sync-etc-history.ts's own verified
// mapping, and re-confirmed directly against Power BI during a 2026-07-16
// audit: "May 2026"'s Begin Date is 2026-06-01, a full month later).
// [ETC Begin Date] = DATE(year, month, 1) silently pulls the PREVIOUS
// month's HoursQuoted/HoursActual and stores them mislabeled as the current
// month — this filter used to do exactly that; fixed to match by name.
//
// Excel-free data flow (the workbook's Export-tab write-back loop is retired):
// - "Previous Month Pulled Hours" (misleading name) = OUR OWN prior month's
//   NEW ETC HOURS — the remaining pool balance, not the pulled amount.
//   Verified against the real 'Standard Fees' archive 2026-07-17: across all
//   28 archived month-pairs, 22 match prior-month New ETC exactly and ZERO
//   match prior-month Hours Pulled (the 6 outliers are small manual Excel
//   tweaks). Power BI's own column is used only as a fallback when no local
//   prior-month row exists (e.g. the very first month).
// - New Hours Added (sold-job quotes) and Hours Worked (Paylocity) still come
//   from Power BI — genuinely external data.
// - "Hours being pulled this month" and "Rate" are manual decisions. Existing
//   values are preserved on refresh; a NEW month row gets the sheet's own
//   documented defaults: PM pulls 450, the others pull Hours Worked This
//   Month, and Rate carries forward from the prior month (170/140 failing that).
// Derived fields mirror the sheet: Available = Prev + Added,
// New ETC = Available - Pulled, Standard Fee = New ETC x Rate.
export async function syncCategoryPoolsFromPowerBi(month: string): Promise<{ poolsUpserted: number }> {
  const etcName = monthToEtcName(month);
  const dax = `
    EVALUATE
    SUMMARIZECOLUMNS(
      'Standard Fees'[Billing Group],
      'Standard Fees'[Department],
      FILTER(ALL('Estimated to Complete Period'), 'Estimated to Complete Period'[ETC Name] = "${etcName}"),
      "PrevPulled", [Standard Fees - Monthly Process - Previous Month Pulled Hours],
      "HoursQuoted", [Standard Fees - Monthly Process - Hours Quoted by ETC Period],
      "HoursActual", [Standard Fees - Monthly Process - Hours Actual by ETC Period]
    )
  `;
  const rows = (await runDax(dax)) as CategoryPoolRow[];

  const priorPools = await prisma.categoryPool.findMany({ where: { month: previousMonth(month) } });
  const priorByCategory = new Map(priorPools.map((p) => [p.category, p]));

  let poolsUpserted = 0;

  for (const row of rows) {
    const category = POOL_CATEGORY[`${row["Standard Fees[Billing Group]"]}|${row["Standard Fees[Department]"]}`];
    if (!category) continue;

    const prior = priorByCategory.get(category);
    // The ledger chain carries the REMAINING POOL BALANCE forward: this
    // month's starting hours = prior month's New ETC Hours (see the archive
    // verification note above — NOT prior month's pulled hours, despite the
    // column's name). PBI's echo is only a first-month fallback.
    const previousMonthPulledHours = prior ? Number(prior.newEtcHours) : row.PrevPulled ?? 0;
    const newHoursAddedThisMonth = row.HoursQuoted ?? 0;
    const hoursWorkedThisMonth = row.HoursActual ?? 0;
    const hoursAvailable = round2(previousMonthPulledHours + newHoursAddedThisMonth);

    const existing = await prisma.categoryPool.findUnique({
      where: { category_month: { category, month } },
      select: { hoursPulledThisMonth: true, rate: true },
    });
    // Sheet margin notes: PM "Defaults to 450", the rest "Defaults to Hours
    // Worked This Month". Rate carries forward from the prior month.
    const defaultPulled = category === "ENGINEERING_PM" ? 450 : round2(hoursWorkedThisMonth);
    const hoursPulledThisMonth = existing ? Number(existing.hoursPulledThisMonth) : defaultPulled;
    const rate = existing
      ? Number(existing.rate)
      : prior
        ? Number(prior.rate)
        : category.startsWith("ENGINEERING")
          ? 170
          : 140;
    const newEtcHours = round2(hoursAvailable - hoursPulledThisMonth);
    const standardFee = round2(newEtcHours * rate);

    await prisma.categoryPool.upsert({
      where: { category_month: { category, month } },
      update: {
        previousMonthPulledHours,
        newHoursAddedThisMonth,
        hoursAvailable,
        hoursWorkedThisMonth,
        newEtcHours,
        standardFee,
        source: "power_bi",
      },
      create: {
        category,
        month,
        previousMonthPulledHours,
        newHoursAddedThisMonth,
        hoursAvailable,
        hoursWorkedThisMonth,
        hoursPulledThisMonth,
        newEtcHours,
        rate,
        standardFee,
        source: "power_bi",
      },
    });
    poolsUpserted++;
  }

  return { poolsUpserted };
}

// How current the underlying Paylocity feed itself is (distinct from when the
// app last asked) — the freshness figure managers see. Now the latest Work
// Date in the SharePoint hours export (the direct equivalent of the old
// [Hours Refreshed Thru] measure). Takes the already-fetched rows so it
// doesn't re-download.
async function syncHoursRefreshedThrough(rows: JobHoursRow[]): Promise<void> {
  const refreshedThrough = latestWorkDate(rows);
  if (!refreshedThrough) return;

  await prisma.powerBiFreshness.upsert({
    where: { source: "hours_actual" },
    update: { refreshedThrough: new Date(refreshedThrough), checkedAt: new Date() },
    create: { source: "hours_actual", refreshedThrough: new Date(refreshedThrough) },
  });
}

interface HoursEstimatedRow {
  "Hours Estimated[Job Id]": string;
  "Hours Estimated[Section-Function Code]": string;
  "Hours Estimated[Hours Quoted]": number | null;
  "Hours Estimated[Hours Estimated to Complete]": number | null;
}

interface CostEstimatedRow {
  "Cost Estimated[Job Id]": string;
  "Cost Estimated[Cost Quoted]": number | null;
}

// Pulls Quoted hours by section + Estimate-to-Complete hours from the live
// 'Hours Estimated' table, and Cost Quoted from 'Cost Estimated' — confirmed
// matching the spreadsheet's frozen "Estimated Hours" tab migration exactly
// (e.g. Job 788 Cost Quoted = 538,610 in both). Cost Actual Historical has no
// equivalent single measure in this model, so it is intentionally left as the
// frozen migration value rather than guessed at.
//
// Only updates jobs that already exist with a valid Type — never creates new
// jobs (same policy as the TotalETO sync), since this data alone can't
// classify a job's Type.
export async function syncQuotedFromPowerBi(): Promise<{
  sectionsUpdated: number;
  jobsUpdated: number;
  jobsNotFound: number;
}> {
  const [hoursRows, costRows] = await Promise.all([
    runDax(`EVALUATE 'Hours Estimated'`) as Promise<HoursEstimatedRow[]>,
    runDax(`EVALUATE 'Cost Estimated'`) as Promise<CostEstimatedRow[]>,
  ]);

  const validJobs = await prisma.job.findMany({
    where: { type: { in: [...VALID_JOB_TYPES] } },
    select: { id: true, jobId: true, costQuotedManuallyEdited: true },
  });
  const jobByJobId = new Map(validJobs.map((j) => [j.jobId, j]));

  // Rows a manager has hand-edited on the Projects tab must not have that
  // edit silently overwritten by this sync — quotedHours is skipped for
  // those; estimateToCompleteHours still refreshes either way.
  const manuallyEditedKeys = new Set(
    (await prisma.estimatedHours.findMany({ where: { quotedHoursManuallyEdited: true }, select: { jobId: true, section: true } })).map(
      (e) => `${e.jobId}::${e.section}`
    )
  );

  let sectionsUpdated = 0;
  let jobsNotFoundCount = 0;
  const notFoundJobIds = new Set<string>();

  for (const row of hoursRows) {
    const rawJobId = row["Hours Estimated[Job Id]"];
    const section = row["Hours Estimated[Section-Function Code]"];
    const quotedHours = row["Hours Estimated[Hours Quoted]"];
    const estimateToCompleteHours = row["Hours Estimated[Hours Estimated to Complete]"];
    if (rawJobId == null || section == null) continue;

    const jobId = String(Number(rawJobId));
    const job = jobByJobId.get(jobId);
    if (!job) {
      notFoundJobIds.add(jobId);
      continue;
    }
    if ((quotedHours ?? 0) === 0 && (estimateToCompleteHours ?? 0) === 0) continue;

    const isManuallyEdited = manuallyEditedKeys.has(`${job.id}::${section}`);
    await prisma.estimatedHours.upsert({
      where: { jobId_section: { jobId: job.id, section } },
      update: {
        ...(isManuallyEdited ? {} : { quotedHours: quotedHours ?? 0 }),
        estimateToCompleteHours: estimateToCompleteHours ?? 0,
      },
      create: {
        jobId: job.id,
        section,
        quotedHours: quotedHours ?? 0,
        actualHistoricalHours: 0,
        estimateToCompleteHours: estimateToCompleteHours ?? 0,
      },
    });
    sectionsUpdated++;
  }

  let jobsUpdated = 0;
  for (const row of costRows) {
    const rawJobId = row["Cost Estimated[Job Id]"];
    const costQuoted = row["Cost Estimated[Cost Quoted]"];
    if (rawJobId == null || costQuoted == null) continue;

    const jobId = String(Number(rawJobId));
    const job = jobByJobId.get(jobId);
    if (!job) {
      notFoundJobIds.add(jobId);
      continue;
    }

    if (job.costQuotedManuallyEdited) continue;
    await prisma.job.update({ where: { id: job.id }, data: { costQuoted } });
    jobsUpdated++;
  }

  jobsNotFoundCount = notFoundJobIds.size;
  return { sectionsUpdated, jobsUpdated, jobsNotFound: jobsNotFoundCount };
}
