import { prisma } from "@/lib/prisma";
import { runDax } from "@/lib/powerbi-client";
import { ETC_TRACKED_CODES, PARTS_COST_SECTION } from "@/lib/sections";
import { calcHoursLeft, suggestNewEtc, round2, hasPublishedHistory, groupStandardFeesRows } from "@/lib/etc";

// Refreshes historical ETC months from Power BI's "ETC Historical *" measure
// family — the same numbers the Job Hours Report's "ETC Historical Hours"
// visual renders (unfiltered):
//
//   [ETC Historical Hours Prior Month]  -> Prior ETC
//   [ETC Historical Hours]              -> New ETC (submitted snapshot;
//                                          BLANK where never submitted)
//   [ETC Historical Hours Left]         -> Prior - real hours worked, so
//                                          real Worked = Prior - Left
//   (+ "ETC Historical Costs *" twins for the Parts Cost block, per job)
//
// The live [Hours Actual, Est to Date] measure cannot serve historical
// periods (its backing calculated column errors out), which is why history
// goes through these measures instead of syncHoursWorkedFromPowerBi.
//
// Period mapping (verified by chaining against live-synced local data):
// 'Estimated to Complete Period'[ETC Name] "May 2026" IS app month
// "2026-05". The period's Begin Date is one month later (May's ETC gets
// filled out in early June) — always map by ETC Name, never by Begin Date.
//
// Ownership rule — which system's numbers win for a month:
// - A month is APP-OWNED (never overwritten here) when any of its entries
//   carry real in-app work: submittedAt / enteredById (submitted in the
//   app), newEtcDraft (manager mid-edit), or needsReview=true (in-progress
//   month whose workflow the live sync owns).
// - Every other month that Power BI has a period for is PBI-OWNED history
//   and is wiped + rewritten from the measures, so re-running always
//   converges on what Power BI currently reports (including the still-open
//   PBI period, which keeps accruing hours until their team closes it).
//
// Known gap (found 2026-07-14, see the June 2026 data-correction incident):
// Power BI only publishes a month's "ETC Historical *" archive several
// weeks after month-end (April by 5/11, May by 6/10, June by 7/08 — all
// observed from the real Excel exports). If a month gets Submitted & Locked
// in the app (e.g. during testing, or before managers finish their real
// review) *before* Power BI has published its archive for it, that month
// becomes permanently app-owned and this function will never again try to
// reconcile it against Power BI's real numbers, even once the archive shows
// up — silently freezing whatever the live/auto-suggested values were at
// submit time. This function can't safely auto-overwrite an app-owned month
// (a genuine manager correction must never be clobbered), but it now
// detects the situation and reports it via `monthsOwnedWithPbiHistoryNow`
// so an admin can see it in the audit log and decide whether to reopen and
// re-run "Sync History" for that specific month.
export async function syncEtcHistoryFromPowerBi(): Promise<{
  monthsRefreshed: string[];
  monthsSkippedAppOwned: string[];
  monthsOwnedWithPbiHistoryNow: string[];
  entriesWritten: number;
  unsubmittedFilled: number;
  poolMonthsRefreshed: string[];
  poolRowsWritten: number;
  poolMonthsOwnedWithPbiHistoryNow: string[];
}> {
  const periods = (await runDax(`EVALUATE 'Estimated to Complete Period'`)) as {
    "Estimated to Complete Period[ETC Name]": string;
  }[];
  const candidates = periods
    .map((p) => {
      const name = p["Estimated to Complete Period[ETC Name]"];
      return { name, month: etcNameToMonth(name) };
    })
    .sort((a, b) => a.month.localeCompare(b.month));

  // App-owned months, per the ownership rule above.
  const ownedRows = await prisma.etcEntry.findMany({
    where: {
      OR: [{ submittedAt: { not: null } }, { enteredById: { not: null } }, { newEtcDraft: { not: null } }, { needsReview: true }],
    },
    distinct: ["month"],
    select: { month: true },
  });
  const appOwned = new Set(ownedRows.map((r) => r.month));

  const jobs = await prisma.job.findMany({ select: { id: true, jobId: true } });
  const jobByJobId = new Map(jobs.map((j) => [j.jobId, j]));

  const monthsRefreshed: string[] = [];
  const monthsSkippedAppOwned: string[] = [];
  const monthsOwnedWithPbiHistoryNow: string[] = [];
  let entriesWritten = 0;
  let unsubmittedFilled = 0;

  for (const period of candidates) {
    if (appOwned.has(period.month)) {
      monthsSkippedAppOwned.push(period.month);
      // Existence check: has Power BI's archive shown up for this month
      // since it was locked in the app? If so, the app's numbers may be
      // stale/wrong (see the gap noted above) — flag it rather than
      // silently trusting whatever is already stored.
      const historyRows = (await runDax(`
        EVALUATE
        SUMMARIZECOLUMNS(
          'Job'[Job Id],
          FILTER(ALL('Estimated to Complete Period'), 'Estimated to Complete Period'[ETC Name] = "${period.name}"),
          "NewEtc", [ETC Historical Hours]
        )
      `)) as { "Job[Job Id]": string; NewEtc: number | null }[];
      if (hasPublishedHistory(historyRows)) monthsOwnedWithPbiHistoryNow.push(period.month);
      continue;
    }

    const [hoursRows, costRows] = await Promise.all([
      runDax(`
        EVALUATE
        SUMMARIZECOLUMNS(
          'Job'[Job Id], 'Function Hierarchy'[Section-Function Code],
          FILTER(ALL('Estimated to Complete Period'), 'Estimated to Complete Period'[ETC Name] = "${period.name}"),
          "PriorEtc", [ETC Historical Hours Prior Month],
          "NewEtc", [ETC Historical Hours],
          "Left", [ETC Historical Hours Left]
        )
      `) as Promise<
        { "Job[Job Id]": string; "Function Hierarchy[Section-Function Code]": string; PriorEtc: number | null; NewEtc: number | null; Left: number | null }[]
      >,
      runDax(`
        EVALUATE
        SUMMARIZECOLUMNS(
          'Job'[Job Id],
          FILTER(ALL('Estimated to Complete Period'), 'Estimated to Complete Period'[ETC Name] = "${period.name}"),
          "PriorEtc", [ETC Historical Costs Prior Month],
          "NewEtc", [ETC Historical Costs],
          "Left", [ETC Historical Costs Left]
        )
      `) as Promise<{ "Job[Job Id]": string; PriorEtc: number | null; NewEtc: number | null; Left: number | null }[]>,
    ]);

    const newEntries: {
      jobId: number;
      section: string;
      month: string;
      priorEtc: number;
      hoursWorked: number;
      hoursLeftCalc: number;
      newEtc: number;
      needsReview: boolean;
    }[] = [];

    const addRow = (rawJobId: string | null, section: string, r: { PriorEtc: number | null; NewEtc: number | null; Left: number | null }) => {
      if (rawJobId == null) return;
      const priorEtc = round2(r.PriorEtc ?? 0);
      const left = round2(r.Left ?? 0);
      const hoursWorked = round2(priorEtc - left);
      // A fully empty combo (never estimated, no work) isn't history worth storing.
      if (priorEtc === 0 && hoursWorked === 0 && (r.NewEtc ?? 0) === 0) return;
      const job = jobByJobId.get(String(Number(rawJobId)));
      if (!job) return;

      let newEtc: number;
      if (r.NewEtc == null) {
        // Never submitted in the source — hold the app's own suggestion so
        // the row still renders as closed history.
        newEtc = round2(suggestNewEtc(priorEtc, hoursWorked));
        unsubmittedFilled++;
      } else {
        newEtc = round2(r.NewEtc);
      }

      newEntries.push({
        jobId: job.id,
        section,
        month: period.month,
        priorEtc,
        hoursWorked,
        hoursLeftCalc: round2(calcHoursLeft(priorEtc, hoursWorked)),
        newEtc,
        needsReview: false,
      });
    };

    for (const r of hoursRows) {
      const section = r["Function Hierarchy[Section-Function Code]"];
      if (section == null || !ETC_TRACKED_CODES.has(section)) continue;
      addRow(r["Job[Job Id]"], section, r);
    }
    for (const r of costRows) addRow(r["Job[Job Id]"], PARTS_COST_SECTION, r);

    // Only replace the month when Power BI actually returned data for it —
    // an empty period (e.g. "Aug 2025" exists in the dimension but has no
    // history rows) must not wipe anything.
    if (newEntries.length === 0) continue;

    await prisma.$transaction(
      async (tx) => {
        await tx.etcEntry.deleteMany({ where: { month: period.month } });
        await tx.etcEntry.createMany({ data: newEntries });
      },
      { timeout: 30000 },
    );

    monthsRefreshed.push(period.month);
    entriesWritten += newEntries.length;
  }

  const pools = await syncCategoryPoolHistory(new Map(candidates.map((p) => [p.name, p.month])), appOwned);

  return { monthsRefreshed, monthsSkippedAppOwned, monthsOwnedWithPbiHistoryNow, entriesWritten, unsubmittedFilled, ...pools };
}

const POOL_CATEGORY: Record<string, "ENGINEERING_PM" | "ENGINEERING_WARRANTY" | "SHOP_MANUFACTURING" | "SHOP_WARRANTY"> = {
  "Engineering|PM": "ENGINEERING_PM",
  "Engineering|Warranty": "ENGINEERING_WARRANTY",
  "Shop|Manufacturing": "SHOP_MANUFACTURING",
  "Shop|Warranty": "SHOP_WARRANTY",
};

interface StandardFeesRow {
  "Standard Fees[ETC Period Key]": number;
  "Standard Fees[Billing Group]": string;
  "Standard Fees[Department]": string;
  "Standard Fees[Previous Month Pulled Hours]": number | null;
  "Standard Fees[New Hours Added this Month]": number | null;
  "Standard Fees[Hours Available]": number | null;
  "Standard Fees[Hours Worked this Month]": number | null;
  "Standard Fees[Hours being pulled this month]": number | null;
  "Standard Fees[New ETC Hours]": number | null;
  "Standard Fees[Rate]": number | null;
  "Standard Fees[Standard Fee]": number | null;
}

// Backfills the "Standard Fees By Department" category pools for historical
// months from Power BI's 'Standard Fees' table — the archive of every pool
// submission (one row per department per ETC period, all fields included:
// Prev Pulled / New Added / Available / Worked / Pulled / New ETC / Rate /
// Fee). Same ownership rule as the ETC entries above, plus: a month whose
// standard sheet was submitted in-app (StandardSheetSnapshot exists) is
// app-owned and never overwritten.
async function syncCategoryPoolHistory(
  monthByPeriodName: Map<string, string>,
  etcAppOwned: Set<string>,
): Promise<{ poolMonthsRefreshed: string[]; poolRowsWritten: number; poolMonthsOwnedWithPbiHistoryNow: string[] }> {
  const [sfRows, periodKeyRows, snapshotMonths] = await Promise.all([
    runDax(`EVALUATE 'Standard Fees'`) as Promise<StandardFeesRow[]>,
    runDax(`
      EVALUATE SELECTCOLUMNS('Estimated to Complete Period', "Key", 'Estimated to Complete Period'[ETC Period Key], "Name", 'Estimated to Complete Period'[ETC Name])
    `) as Promise<{ Key: number; Name: string }[]>,
    prisma.standardSheetSnapshot.findMany({ distinct: ["month"], select: { month: true } }),
  ]);

  const monthByKey = new Map(periodKeyRows.map((p) => [p.Key, monthByPeriodName.get(p.Name)]));
  const appOwnedPoolMonths = new Set([...etcAppOwned, ...snapshotMonths.map((s) => s.month)]);

  // Same gap as the ETC ownership rule above: once a month has a
  // StandardSheetSnapshot (or app-owned EtcEntry), it's skipped here forever,
  // even after Power BI later publishes real 'Standard Fees' archive rows for
  // it. Flag that case instead of silently trusting a frozen submission.
  const { rowsByMonth, ownedWithHistoryNow: poolMonthsOwnedWithPbiHistoryNow } = groupStandardFeesRows(
    sfRows,
    (r) => monthByKey.get(r["Standard Fees[ETC Period Key]"]),
    appOwnedPoolMonths
  );

  const poolMonthsRefreshed: string[] = [];
  let poolRowsWritten = 0;

  for (const [month, rows] of [...rowsByMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const data = rows.flatMap((r) => {
      const category = POOL_CATEGORY[`${r["Standard Fees[Billing Group]"]}|${r["Standard Fees[Department]"]}`];
      if (!category) return [];
      return [
        {
          category,
          month,
          previousMonthPulledHours: round2(r["Standard Fees[Previous Month Pulled Hours]"] ?? 0),
          newHoursAddedThisMonth: round2(r["Standard Fees[New Hours Added this Month]"] ?? 0),
          hoursAvailable: round2(r["Standard Fees[Hours Available]"] ?? 0),
          hoursWorkedThisMonth: round2(r["Standard Fees[Hours Worked this Month]"] ?? 0),
          hoursPulledThisMonth: round2(r["Standard Fees[Hours being pulled this month]"] ?? 0),
          newEtcHours: round2(r["Standard Fees[New ETC Hours]"] ?? 0),
          rate: round2(r["Standard Fees[Rate]"] ?? 0),
          standardFee: round2(r["Standard Fees[Standard Fee]"] ?? 0),
          source: "power_bi_history",
        },
      ];
    });
    if (data.length === 0) continue;

    await prisma.$transaction(async (tx) => {
      await tx.categoryPool.deleteMany({ where: { month } });
      await tx.categoryPool.createMany({ data });
    });
    poolMonthsRefreshed.push(month);
    poolRowsWritten += data.length;
  }

  return { poolMonthsRefreshed, poolRowsWritten, poolMonthsOwnedWithPbiHistoryNow };
}

const MONTH_NAME_TO_NUM: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

// "Aug 2025" -> "2025-08"
function etcNameToMonth(name: string): string {
  const [mon, year] = name.split(" ");
  const mm = MONTH_NAME_TO_NUM[mon];
  if (!mm) throw new Error(`Unrecognized ETC period name: "${name}"`);
  return `${year}-${mm}`;
}
