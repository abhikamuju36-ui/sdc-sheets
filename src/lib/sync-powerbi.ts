import { prisma } from "@/lib/prisma";
import { VALID_JOB_TYPES, etcActiveJobFilter } from "@/lib/job-filters";
import { runDax } from "@/lib/powerbi-client";
import { ETC_TRACKED_CODES, PARTS_COST_SECTION } from "@/lib/sections";
import { calcHoursLeft, round2, isMonthLocked } from "@/lib/etc";

interface HoursActualRow {
  "Job[Job Id]": string;
  "Date[Year]": number;
  "Date[Month]": number;
  ActualHours: number;
}

// Pulls actual hours worked per job per month from the live Power BI semantic
// model and upserts into JobMonthlyActualHours. Uses [Hours Actual, Est to
// Date] — the same measure the legacy "Monthly ETC Process" sheet's
// PivotTable used for its ETC math — rather than the plain [Hours Actual]
// measure. Confirmed via live query (2026-07-07) that the measure is
// self-contained (already scoped by the model's own Date[Is ETC to Date]
// logic, no extra filter needed) and that it can diverge from [Hours Actual]
// once the Paylocity feed lands entries dated past the current ETC cutoff —
// the two happened to match on that date only because no such entries existed yet.
export async function syncActualHoursFromPowerBi(): Promise<{
  rowsUpserted: number;
  jobsNotFound: number;
  rowsSkippedOverridden: number;
}> {
  const dax = `EVALUATE SUMMARIZECOLUMNS('Job'[Job Id], 'Date'[Year], 'Date'[Month], "ActualHours", [Hours Actual, Est to Date])`;
  const rows = (await runDax(dax)) as HoursActualRow[];

  let rowsUpserted = 0;
  let jobsNotFound = 0;
  let rowsSkippedOverridden = 0;

  for (const row of rows) {
    const rawJobId = row["Job[Job Id]"];
    const year = row["Date[Year]"];
    const month = row["Date[Month]"];
    const hours = row.ActualHours;
    if (rawJobId == null || year == null || month == null || hours == null) continue;

    // Job IDs in Power BI are zero-padded (e.g. "0788"); ours are not ("788").
    const jobId = String(Number(rawJobId));
    const job = await prisma.job.findUnique({ where: { jobId } });
    if (!job) {
      jobsNotFound++;
      continue;
    }

    const monthStr = `${year}-${String(month).padStart(2, "0")}`;

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
      create: { jobId: job.id, month: monthStr, actualHours: hours, source: "power_bi" },
    });
    rowsUpserted++;
  }

  await syncHoursRefreshedThrough();

  return { rowsUpserted, jobsNotFound, rowsSkippedOverridden };
}

interface HoursWorkedBySectionRow {
  "Job[Job Id]": string;
  "Function Hierarchy[Section-Function Code]": string;
  HoursActual: number;
}

// Pulls actual hours worked per job PER SECTION for `month` and overwrites
// EtcEntry.hoursWorked directly — unlike syncActualHoursFromPowerBi (which
// only updates the job-level JobMonthlyActualHours rollup), this is the
// per-department grain the ETC grid itself needs. Confirmed live that the
// model can be sliced by 'Function Hierarchy'[Section-Function Code] the
// same way 'Hours Estimated' already is. Always overwrites on refresh — the
// manager's "Hours Worked" is meant to always reflect Power BI, not be
// independently typed in.
//
// When Power BI reports hours in a tracked section the job has no entry for
// (work charged to a section that was never quoted, so startMonth didn't seed
// it), the entry is CREATED rather than the hours silently dropped — the
// sheet's pivot copy showed such hours, and the app must too. Prior ETC for
// these comes from the previous month's entry if one exists, else 0.
export async function syncHoursWorkedFromPowerBi(month: string): Promise<{ rowsUpdated: number; rowsSkipped: number }> {
  // Re-checked here, not just trusted from the caller's earlier check — this
  // sync does one DB round-trip per Power BI row, so it can run long enough
  // for a manager to Submit and Lock this exact month mid-sync. A locked
  // month is frozen history (same rule as submitMonth/clearMonth/
  // syncPowerBiForEtc) and must never be rewritten by a background refresh.
  const monthEntriesAtStart = await prisma.etcEntry.findMany({ where: { month }, select: { needsReview: true } });
  const monthStartedAtStart = monthEntriesAtStart.length > 0;
  if (monthStartedAtStart && isMonthLocked(monthEntriesAtStart)) {
    return { rowsUpdated: 0, rowsSkipped: 0 };
  }

  const [year, monthNum] = month.split("-").map(Number);
  // 'Date' isn't a groupby column here, so the month filter has to be passed
  // as a filter-table argument to SUMMARIZECOLUMNS, not applied afterward
  // with FILTER() — the earlier version of this query errored with "A single
  // value for column 'Year' ... cannot be determined" for exactly that reason.
  const dax = `
    EVALUATE
    SUMMARIZECOLUMNS(
      'Job'[Job Id], 'Function Hierarchy'[Section-Function Code],
      FILTER(ALL('Date'), 'Date'[Year] = ${year} && 'Date'[Month] = ${monthNum}),
      "HoursActual", [Hours Actual, Est to Date]
    )
  `;
  const rows = (await runDax(dax)) as HoursWorkedBySectionRow[];

  let rowsUpdated = 0;
  let rowsSkipped = 0;

  for (const row of rows) {
    const rawJobId = row["Job[Job Id]"];
    const section = row["Function Hierarchy[Section-Function Code]"];
    const hours = row.HoursActual;
    if (rawJobId == null || section == null || hours == null) continue;
    if (!ETC_TRACKED_CODES.has(section)) continue; // ignore codes the ETC grid doesn't track

    const jobId = String(Number(rawJobId));
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

interface PriorEtcCostRow {
  "Job[Job Id]": string;
  PriorEtcCost: number;
}

interface PartCostActualRow {
  "Job[Job Id]": string;
  PartCostActual: number;
}

// "Parts Cost" — a real block in the sheet (Prior ETC / Money Spent Month /
// Money Left / New ETC / Diff, in dollars, no Engineering/Shop split).
// Modeled as an EtcEntry row with section = PARTS_COST_SECTION rather than a
// new table, since the shape matches the hours departments exactly.
//
// Prior ETC Cost is NOT month-sliced in the model (confirmed: the sheet's own
// GETPIVOTDATA call for it has no date filter) — it's a live running balance,
// re-pulled fresh every refresh rather than carried forward locally the way
// hours' Prior ETC is. Money Spent Month uses [Part Cost Actual ETC to Date],
// grouped by month the same way [Hours Actual, Est to Date] already is.
// Creates the row if it doesn't exist yet (unlike the hours sync, which only
// updates existing rows) since Parts Cost has no EstimatedHours-seeded
// counterpart from startMonth().
export async function syncPartsCostFromPowerBi(month: string): Promise<{ rowsUpserted: number }> {
  // Same re-check as syncHoursWorkedFromPowerBi: a locked month must never be
  // rewritten, even if it got locked after the caller's own check but before
  // (or during) this function's run.
  const monthEntriesAtStart = await prisma.etcEntry.findMany({ where: { month }, select: { needsReview: true } });
  if (monthEntriesAtStart.length > 0 && isMonthLocked(monthEntriesAtStart)) {
    return { rowsUpserted: 0 };
  }

  const [year, monthNum] = month.split("-").map(Number);

  const [priorRows, actualRows] = await Promise.all([
    runDax(`EVALUATE SUMMARIZECOLUMNS('Job'[Job Id], "PriorEtcCost", [ETC Monthly Process - Prior ETC Cost])`) as Promise<
      PriorEtcCostRow[]
    >,
    runDax(`
      EVALUATE
      SUMMARIZECOLUMNS(
        'Job'[Job Id],
        FILTER(ALL('Date'), 'Date'[Year] = ${year} && 'Date'[Month] = ${monthNum}),
        "PartCostActual", [Part Cost Actual ETC to Date]
      )
    `) as Promise<PartCostActualRow[]>,
  ]);

  const spentByJobId = new Map(
    actualRows.filter((r) => r["Job[Job Id]"] != null).map((r) => [String(Number(r["Job[Job Id]"])), r.PartCostActual ?? 0])
  );

  const jobs = await prisma.job.findMany({ where: etcActiveJobFilter, select: { id: true, jobId: true } });
  const jobByJobId = new Map(jobs.map((j) => [j.jobId, j]));

  let rowsUpserted = 0;

  for (const row of priorRows) {
    const rawJobId = row["Job[Job Id]"];
    if (rawJobId == null || row.PriorEtcCost == null) continue;

    const jobId = String(Number(rawJobId));
    const job = jobByJobId.get(jobId);
    if (!job) continue;

    const priorEtc = row.PriorEtcCost;
    const moneySpent = spentByJobId.get(jobId) ?? 0;

    // Re-checked per-row, same reason as syncHoursWorkedFromPowerBi: this
    // specific entry could have been submitted since the loop started. For a
    // brand-new row (no existing entry), check the month as a whole instead
    // — a fresh needsReview:true row would silently "unlock" an otherwise
    // fully-locked month.
    const existing = await prisma.etcEntry.findUnique({
      where: { jobId_section_month: { jobId: job.id, section: PARTS_COST_SECTION, month } },
      select: { needsReview: true },
    });
    if (existing) {
      if (!existing.needsReview) continue;
    } else {
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
// - Previous Month Pulled Hours = OUR OWN prior month's "Hours being pulled"
//   (the Power BI measure only ever echoed back what Excel submitted; the app
//   is the source of truth now). Power BI's value is used only as a fallback
//   when no local prior-month row exists (e.g. the very first month).
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
    // App is the source of truth for the pulled-hours ledger; PBI's echo of
    // the old Excel submissions is only a first-month fallback.
    const previousMonthPulledHours = prior ? Number(prior.hoursPulledThisMonth) : row.PrevPulled ?? 0;
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

// How current the underlying Paylocity/actuals feed itself is (distinct from
// when the app last asked) — the same [Hours Refreshed Thru] measure the
// legacy workbooks queried to show managers data freshness. Piggybacks on
// the actual-hours sync rather than being queried separately, since it's
// cheap and only meaningful right after a sync anyway.
async function syncHoursRefreshedThrough(): Promise<void> {
  const rows = (await runDax(`EVALUATE ROW("RefreshedThru", [Hours Refreshed Thru])`)) as { RefreshedThru: string | null }[];
  const refreshedThrough = rows[0]?.RefreshedThru;
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
