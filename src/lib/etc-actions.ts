"use server";

import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { calcHoursLeft, suggestNewEtc, isMonthLocked, round2, prevMonth, nextMonth, isValidMonth, isSafeForLiveEtcSync } from "@/lib/etc";
import { etcActiveJobFilter } from "@/lib/job-filters";
import { syncActualHours, syncHoursWorked, syncPartsCost } from "@/lib/sync-powerbi";
import { syncEtcHistoryFromPowerBi } from "@/lib/sync-etc-history";
import { ETC_TRACKED_CODES, PARTS_COST_SECTION } from "@/lib/sections";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";

// Submit and Lock's confirmation gate — an "are you sure" step before
// freezing a month's numbers, not a real access boundary, so the password is
// fixed rather than env-configurable. Checked here (not client-side) so it
// can't be read out of the page JS bundle.
const SUBMIT_LOCK_PASSWORD = "sdcautomation";

function safeEqual(a: string, b: string): boolean {
  const da = createHmac("sha256", "cmp").update(a).digest();
  const db = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(da, db);
}

// The sheet physically had one working month; the app must not let an
// arbitrary past/future month be seeded out of order — Prior ETC carries
// forward from the previous month's New ETC, so seeding ahead of an
// unsubmitted month would bake in-flight numbers into history. Re-seeding an
// already-started month is always fine (that's what Refresh does).
async function assertMonthSeedable(month: string): Promise<void> {
  const alreadyStarted = (await prisma.etcEntry.count({ where: { month } })) > 0;
  if (alreadyStarted) return;

  const latest = await prisma.etcEntry.findFirst({ orderBy: { month: "desc" }, select: { month: true } });
  if (!latest) return; // very first month ever — anything goes

  const latestEntries = await prisma.etcEntry.findMany({ where: { month: latest.month }, select: { needsReview: true } });
  if (!isMonthLocked(latestEntries)) {
    throw new Error(`${latest.month} is still in progress — submit and lock it before starting a new month.`);
  }
  const expected = nextMonth(latest.month);
  if (month !== expected) {
    throw new Error(`The next ETC month after ${latest.month} is ${expected} — months must be started in order.`);
  }
}

// Deletes unsubmitted entries the grid can never render — either the job no
// longer qualifies (completed, deactivated, or type-invalidated since
// seeding), or the section isn't one the grid tracks (relics from before the
// section list matched the real sheet). The app-side equivalent of the
// sheet's Refresh deleting rows for jobs gone from the source. Confirmed
// history (needsReview=false) is never pruned.
async function pruneStaleEntries(month: string): Promise<number> {
  const qualifying = await prisma.job.findMany({ where: etcActiveJobFilter, select: { id: true } });
  // Zero qualifying jobs means something is wrong upstream (empty Job table,
  // broken filter) — `notIn: []` would delete EVERY unsubmitted entry. Bail.
  if (qualifying.length === 0) return 0;
  const result = await prisma.etcEntry.deleteMany({
    where: {
      month,
      needsReview: true,
      OR: [
        { jobId: { notIn: qualifying.map((j) => j.id) } },
        { section: { notIn: [...ETC_TRACKED_CODES, PARTS_COST_SECTION] } },
      ],
    },
  });
  return result.count;
}

// Seeds one EtcEntry per Active job's EstimatedHours section for `month`, carrying
// Prior ETC forward from the previous month's confirmed New ETC (or the original
// quoted Estimate to Complete if this job has no prior month yet). Idempotent and
// safe to re-run: already-submitted entries for `month` are left untouched, and
// not-yet-submitted ones get their Prior ETC refreshed in case EstimatedHours changed.
//
// Only seeds the 13 departments the real "Managers Fill Out" sheet actually
// tracks (ETC_SECTIONS) — confirmed by decoding its header formulas; PM,
// Manufacturing, and the whole Warranty phase have no ETC column there.
export async function startMonth(month: string, _formData: FormData) {
  await seedMonth(month);
  await logAudit({ action: "etc.startMonth", entityType: "EtcMonth", entityId: month, summary: `Started ETC month ${month}` });
  revalidatePath("/etc");
}

async function seedMonth(month: string) {
  if (!isValidMonth(month)) {
    throw new Error(`"${month}" is not a valid ETC month (expected YYYY-MM).`);
  }
  await assertMonthSeedable(month);
  await pruneStaleEntries(month);

  // Must be the exact filter the grid renders with — a job seeded here but
  // hidden there leaves entries no form input can ever confirm.
  const jobs = await prisma.job.findMany({
    where: etcActiveJobFilter,
    include: { estimatedHours: true },
  });
  const jobIds = jobs.map((j) => j.id);

  await prisma.$transaction(
    async (tx) => {
      // Read INSIDE the transaction, not before it — this snapshot is what
      // decides which rows are safe to touch (existing.needsReview), so it
      // must be as fresh as possible relative to the writes below. Reading
      // it before the transaction started left a window where a concurrent
      // Submit and Lock (committing between the pre-read and this write)
      // wouldn't be reflected here, and this loop can run long enough
      // (every active job × tracked section, up to the 20s timeout) for
      // that window to matter.
      const [priorEntries, existingEntries] = await Promise.all([
        tx.etcEntry.findMany({ where: { month: prevMonth(month), jobId: { in: jobIds } } }),
        tx.etcEntry.findMany({ where: { month, jobId: { in: jobIds } } }),
      ]);
      const priorByKey = new Map(priorEntries.map((e) => [`${e.jobId}-${e.section}`, e]));
      const existingByKey = new Map(existingEntries.map((e) => [`${e.jobId}-${e.section}`, e]));

      for (const job of jobs) {
        for (const eh of job.estimatedHours) {
          if (!ETC_TRACKED_CODES.has(eh.section)) continue;
          const key = `${job.id}-${eh.section}`;
          const existing = existingByKey.get(key);
          if (existing && !existing.needsReview) continue; // already submitted — don't touch confirmed history

          const priorEntry = priorByKey.get(key);
          // No prior-month entry -> QUOTED hours, not estimate-to-complete:
          // the report's own [ETC Historical Hours Prior Month] measure
          // (SemanticModel TMDL, verified 2026-07-17) uses [Hours Quoted] for
          // a job whose Start Date falls in the prior period. The two are
          // usually equal for a brand-new job, but ETC can drift from quoted
          // before the job's first ETC month — quoted is the report's rule.
          const priorEtc = priorEntry ? Number(priorEntry.newEtc) : Number(eh.quotedHours);
          const hoursWorked = existing ? Number(existing.hoursWorked) : 0;

          await tx.etcEntry.upsert({
            where: { jobId_section_month: { jobId: job.id, section: eh.section, month } },
            // newEtc is deliberately NOT written here — it's a manager-entered
            // value (submitMonth falls back to the suggestion only at
            // submission time). Rows display the live suggestion as a
            // placeholder until then; nothing needs to overwrite the column
            // on every startMonth/Refresh Data click before that.
            update: {
              priorEtc,
              hoursLeftCalc: round2(calcHoursLeft(priorEtc, hoursWorked)),
            },
            create: {
              jobId: job.id,
              section: eh.section,
              month,
              priorEtc,
              hoursWorked: 0,
              hoursLeftCalc: priorEtc,
              newEtc: priorEtc,
              needsReview: true,
            },
          });
        }
      }
    },
    { timeout: 20000 },
  );

  revalidatePath("/etc");
}

// Bulk-confirms every entry in `month` in one atomic transaction. Validates every
// row before writing anything — a single bad value rejects the whole submission
// rather than leaving the month half-confirmed.
export async function submitMonth(month: string, formData: FormData) {
  const submittedPassword = String(formData.get("submitLockPassword") ?? "");
  if (!safeEqual(submittedPassword, SUBMIT_LOCK_PASSWORD)) {
    throw new Error("Incorrect password — Submit and Lock was not run.");
  }

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const allEntries = await prisma.etcEntry.findMany({ where: { month } });

  // A locked month is frozen history — a stale tab re-POSTing this form (or a
  // direct action call) must never silently rewrite it. Same guard as
  // syncPowerBiForEtc/clearMonth; reopenMonth (admin-only) is the way back in.
  if (isMonthLocked(allEntries)) {
    throw new Error(`${month} is already submitted and locked — reopen it first if a correction is needed.`);
  }

  // A reopened HISTORICAL month (a newer month exists) is a correction pass,
  // not a live workflow: its job universe is its own entries, period. The
  // current-month branch below prunes entries whose jobs dropped out of
  // TODAY's etcActiveJobFilter — correct for the in-progress month (the grid
  // renders that same filter, so pruned rows had no form inputs), but on a
  // reopened historical month it silently deleted real history for jobs that
  // completed since (proven live 2026-07-14: re-submitting a reopened April
  // shrank it 366 → 323 rows / 43 → 36 jobs before the data was restored
  // from the source workbook). getEtcMonthJobWhere applies the same
  // historical rule to what the grid renders, so grid and submit agree.
  const latest = await prisma.etcEntry.findFirst({ orderBy: { month: "desc" }, select: { month: true } });
  const isHistorical = latest != null && month < latest.month;

  const renderable = (section: string) => section === PARTS_COST_SECTION || ETC_TRACKED_CODES.has(section);
  let staleIds: number[] = [];
  let entries: typeof allEntries;
  if (isHistorical) {
    // Never delete anything from history; lock every entry the month has.
    entries = allEntries.filter((e) => renderable(e.section));
  } else {
    // Scope to the same job universe the grid renders — entries on jobs that
    // stopped qualifying since the last Refresh have no form inputs and must
    // be pruned (if unsubmitted) rather than fail validation. Confirmed
    // entries on since-hidden jobs are history and are left untouched.
    const qualifying = await prisma.job.findMany({ where: etcActiveJobFilter, select: { id: true } });
    const qualifyingIds = new Set(qualifying.map((j) => j.id));
    staleIds = allEntries.filter((e) => e.needsReview && (!qualifyingIds.has(e.jobId) || !renderable(e.section))).map((e) => e.id);
    entries = allEntries.filter((e) => qualifyingIds.has(e.jobId) && renderable(e.section));
  }

  // Never let a submission reduce a month to nothing — an empty confirm with
  // stale deletions would erase the month instead of locking it.
  if (entries.length === 0) {
    throw new Error(`Nothing to submit for ${month} — no entries on currently active jobs.`);
  }

  const inputs: { id: number; hoursWorked: number; override: number | null }[] = [];

  for (const entry of entries) {
    const rawHours = formData.get(`hoursWorked__${entry.id}`);
    if (rawHours === null || rawHours === "") {
      // On a historical correction pass, an entry hidden from the grid (e.g.
      // its job is type-gated out of rendering) simply keeps its stored Hours
      // Worked AND its stored New ETC instead of failing the whole submission.
      if (isHistorical) {
        inputs.push({ id: entry.id, hoursWorked: Number(entry.hoursWorked), override: round2(Number(entry.newEtc)) });
        continue;
      }
      throw new Error(`Missing Hours Worked for entry ${entry.id} (section ${entry.section}).`);
    }
    const hoursWorked = Number(rawHours);
    if (!Number.isFinite(hoursWorked) || hoursWorked < 0) {
      throw new Error(`Invalid Hours Worked "${rawHours}" for entry ${entry.id} (section ${entry.section}).`);
    }

    const rawOverride = formData.get(`newEtcOverride__${entry.id}`);
    let override: number | null = null;
    if (rawOverride !== null && rawOverride !== "") {
      const overrideVal = Number(rawOverride);
      if (!Number.isFinite(overrideVal) || overrideVal < 0) {
        throw new Error(`Invalid New ETC override "${rawOverride}" for entry ${entry.id} (section ${entry.section}).`);
      }
      override = round2(overrideVal);
    } else if (isHistorical) {
      // Historical correction pass: an untouched New ETC cell renders EMPTY
      // (the original submit consumed its draft), so "no override" here means
      // "keep the manager's confirmed value" — NOT "recompute the suggestion",
      // which would silently erase every manager override in the month on a
      // no-changes resubmit. To change a historical cell, type the new value.
      override = round2(Number(entry.newEtc));
    }

    inputs.push({ id: entry.id, hoursWorked, override });
  }

  // Prior ETC is re-read INSIDE the transaction: a concurrent Run Report can
  // rewrite priorEtc between the validation read above and the write below,
  // and the suggestion/Hours Left must be computed from what actually gets
  // locked, not a stale pre-read.
  const updates = await prisma.$transaction(
    async (tx) => {
      if (staleIds.length > 0) {
        await tx.etcEntry.deleteMany({ where: { id: { in: staleIds } } });
      }
      const fresh = await tx.etcEntry.findMany({ where: { id: { in: inputs.map((i) => i.id) } } });
      const freshById = new Map(fresh.map((e) => [e.id, e]));
      const written: { id: number; priorEtc: number; hoursWorked: number; newEtc: number }[] = [];
      for (const u of inputs) {
        const entry = freshById.get(u.id);
        if (!entry) continue; // deleted since validation — nothing to lock
        const priorEtc = Number(entry.priorEtc);
        const newEtc = u.override ?? round2(suggestNewEtc(priorEtc, u.hoursWorked));
        await tx.etcEntry.update({
          where: { id: u.id },
          data: {
            hoursWorked: u.hoursWorked,
            hoursLeftCalc: round2(calcHoursLeft(priorEtc, u.hoursWorked)),
            newEtc,
            newEtcDraft: null, // draft is consumed by the submission
            needsReview: false,
            submittedAt: new Date(),
            ...(userId ? { enteredById: Number(userId) } : {}),
          },
        });
        written.push({ id: u.id, priorEtc, hoursWorked: u.hoursWorked, newEtc });
      }
      return written;
    },
    { timeout: 20000 },
  );

  const entryById = new Map(entries.map((e) => [e.id, e]));
  await logAudit({
    action: "etc.submitMonth",
    entityType: "EtcMonth",
    entityId: month,
    summary: `Submitted ${updates.length} ETC entr${updates.length === 1 ? "y" : "ies"} for ${month}`,
    metadata: {
      staleDeleted: staleIds.length,
      entries: updates.map((u) => ({
        jobId: entryById.get(u.id)?.jobId,
        section: entryById.get(u.id)?.section,
        priorEtc: u.priorEtc,
        hoursWorked: u.hoursWorked,
        newEtc: u.newEtc,
      })),
    },
  });

  revalidatePath("/etc");
}

// Autosaves a typed-but-unsubmitted New ETC override so it survives Refresh
// Data, navigation, and browser crashes — parity with the sheet, whose Refresh
// script skipped non-empty New ETC cells. Revalidates /etc so the derived
// server-rendered numbers (Total New ETC, Standard Fees) reflect the draft;
// the grid cells themselves are client components with their own state, so
// the re-render doesn't reset what the manager is typing.
export async function saveNewEtcDraft(entryId: number, value: number | null): Promise<void> {
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`Invalid New ETC draft value "${value}".`);
  }

  const entry = await prisma.etcEntry.findUnique({ where: { id: entryId }, select: { needsReview: true } });
  if (!entry) throw new Error(`ETC entry ${entryId} not found.`);
  if (!entry.needsReview) throw new Error(`Entry ${entryId} is already submitted — reopen the month to change it.`);

  await prisma.etcEntry.update({
    where: { id: entryId },
    data: { newEtcDraft: value === null ? null : round2(value) },
  });

  revalidatePath("/etc");

  await logAudit({
    action: "etc.saveNewEtcDraft",
    entityType: "EtcEntry",
    entityId: entryId,
    summary: `Draft New ETC ${value === null ? "cleared" : `set to ${round2(value)}`} on entry ${entryId}`,
    metadata: { value },
  });
}

// Admin-only: re-opens a locked (fully-submitted) month for editing.
export async function reopenMonth(month: string, _formData: FormData) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "ADMIN") {
    throw new Error("Only an admin can reopen a submitted month.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.etcEntry.updateMany({ where: { month }, data: { needsReview: true } });
  });

  await logAudit({ action: "etc.reopenMonth", entityType: "EtcMonth", entityId: month, summary: `Reopened ETC month ${month}` });

  revalidatePath("/etc");
}

// Parity with the original sheet's "Refresh Data" button, which did everything
// in one click: added/removed job rows AND pulled the latest hours. So this
// seeds the month first if needed (seedMonth is idempotent — submitted entries
// are never touched), then pulls actual hours from Power BI. Updates the
// job-level rollup (for the dashboard/job-detail views) AND overwrites this
// month's EtcEntry.hoursWorked per section directly — Hours Worked is meant to
// always reflect Power BI, not be independently typed in. Recomputes Hours
// Left / suggested New ETC from the fresh value, but leaves needsReview
// untouched so a manager still confirms before it counts as submitted.
//
// Found 2026-07-14 (see the June data-correction incident): reopening an
// already-closed month and running this seeds/re-syncs it against TODAY's
// etcActiveJobFilter and TODAY's raw Power BI actuals — wrong on both counts
// for a month that's already closed. seedMonth's prune step deletes entries
// for jobs that have since completed (real history, gone), its re-seed step
// adds entries for jobs that only became active after that month closed (never
// really part of it), and the "actual hours" sync overwrites Hours Worked with
// today's raw system totals instead of whatever was reconciled/manager-signed
// for that month — proven by directly reopening a corrected historical month
// and running this: 42 real entries were deleted, 62 wrong ones were added,
// twice (once each on the April and June corrections; the live measure
// happily returns real-looking data for a past month, it's just the wrong
// data for it). This only ever belongs on the single currently-open month —
// historical corrections belong in "Sync History" or manual entry instead.
async function assertCurrentEtcMonth(month: string): Promise<void> {
  const latest = await prisma.etcEntry.findFirst({ orderBy: { month: "desc" }, select: { month: true } });
  if (!isSafeForLiveEtcSync(month, latest?.month ?? null)) {
    throw new Error(
      `${month} is not the current ETC month (${latest!.month} is) — Run Report and Clear ETC only belong on the single currently-open month and would corrupt this one. Reopen ${month} and correct entries by hand, or use "Sync History" to refresh it from Power BI's historical archive instead.`
    );
  }
}

export async function syncPowerBiForEtc(month: string, _formData: FormData) {
  // A submitted month is a frozen snapshot — refresh must never rewrite its
  // Hours Worked/Parts Cost. Reopen it first if a genuine correction is needed.
  const entries = await prisma.etcEntry.findMany({ where: { month }, select: { needsReview: true } });
  if (isMonthLocked(entries)) {
    throw new Error(`${month} is already submitted and locked — its numbers are frozen. Reopen it first if a correction is needed.`);
  }
  await assertCurrentEtcMonth(month);

  await seedMonth(month);
  await syncActualHours();
  await syncHoursWorked(month);
  await syncPartsCost(month);
  await logAudit({ action: "etc.syncPowerBiForEtc", entityType: "EtcMonth", entityId: month, summary: `Refreshed Power BI data for ETC month ${month}` });
  revalidatePath("/etc");
  revalidatePath("/");
}

export type SyncHistoryResult = {
  monthsRefreshed: number;
  reconciledMonths: string[];
  entriesReconciled: number;
  poolEntriesReconciled: number;
};

// Re-pulls every Power BI-owned historical month from the "ETC Historical *"
// measures so past months always match the source report. Months with real
// in-app work (submitted / mid-edit / in progress) are never touched — the
// app is the source of truth for those. For an app-owned month Power BI has
// since published an archive for, only its display-only fact fields (Hours
// Worked/Prior ETC on EtcEntry; Previous Pulled/New Added/Available/Worked
// on CategoryPool) are reconciled — every submitted decision (New ETC,
// hoursPulledThisMonth, rate, and the frozen dollar figures derived from
// them) is left exactly as the manager submitted it. Safe to run any time.
//
// Takes/returns the (state, formData) shape useActionState expects — see
// SyncHistoryButton, which surfaces this result as a toast instead of the
// reconciliation only being visible in the audit log.
export async function syncEtcHistory(_prevState: SyncHistoryResult | null, _formData: FormData): Promise<SyncHistoryResult> {
  const result = await syncEtcHistoryFromPowerBi();
  const reconciledMonths = [...new Set([...result.monthsOwnedWithPbiHistoryNow, ...result.poolMonthsOwnedWithPbiHistoryNow])];
  const reconciledNote =
    reconciledMonths.length > 0
      ? ` — reconciled display fields for locked month(s) now published by Power BI: ${reconciledMonths.join(", ")} (${result.entriesReconciled} EtcEntry + ${result.poolEntriesReconciled} pool fields updated; all submitted decisions/dollars untouched)`
      : "";
  await logAudit({
    action: "etc.syncEtcHistory",
    entityType: "EtcMonth",
    summary: `Refreshed ${result.monthsRefreshed.length} historical ETC months from Power BI (${result.entriesWritten} rows)${reconciledNote}`,
    metadata: result,
  });
  revalidatePath("/etc");
  revalidatePath("/");
  return {
    monthsRefreshed: result.monthsRefreshed.length,
    reconciledMonths,
    entriesReconciled: result.entriesReconciled,
    poolEntriesReconciled: result.poolEntriesReconciled,
  };
}

// Parity with the original sheet's "Clear ETC" script, which blanked only the
// New ETC columns and left Hours Worked alone: resets every entry's New ETC
// back to the system suggestion and re-flags it for review, keeping the
// Power BI-sourced Hours Worked in place. Refuses to touch a locked
// (submitted) month — reopen it first if a genuine correction is needed, so a
// clear can never silently erase confirmed history.
export async function clearMonth(month: string, _formData: FormData) {
  const entriesBefore = await prisma.etcEntry.findMany({ where: { month }, select: { needsReview: true } });
  if (isMonthLocked(entriesBefore)) {
    throw new Error(`${month} is already submitted — reopen it before clearing.`);
  }
  // Clearing a reopened HISTORICAL month would overwrite every manager-
  // confirmed New ETC with the recomputed suggestion — erasing exactly the
  // overrides that made it history. Clear belongs to the live workflow only.
  await assertCurrentEtcMonth(month);

  let clearedCount = 0;
  await prisma.$transaction(
    async (tx) => {
      // Re-read and re-check INSIDE the transaction: a Submit and Lock can
      // commit between the check above and this write (its own transaction
      // runs up to 20s), and clearing a just-locked month would flip every
      // confirmed entry back to needsReview and wipe the manager's
      // overrides. Same pattern as seedMonth's in-tx snapshot.
      const entries = await tx.etcEntry.findMany({ where: { month } });
      if (isMonthLocked(entries)) {
        throw new Error(`${month} was submitted while the clear was running — nothing was changed.`);
      }
      clearedCount = entries.length;
      for (const entry of entries) {
        const priorEtc = Number(entry.priorEtc);
        const hoursWorked = Number(entry.hoursWorked);
        await tx.etcEntry.update({
          where: { id: entry.id },
          data: {
            hoursLeftCalc: round2(calcHoursLeft(priorEtc, hoursWorked)),
            newEtc: round2(suggestNewEtc(priorEtc, hoursWorked)),
            newEtcDraft: null, // the sheet's Clear wiped typed New ETC cells too
            needsReview: true,
          },
        });
      }
    },
    { timeout: 20000 },
  );

  await logAudit({
    action: "etc.clearMonth",
    entityType: "EtcMonth",
    entityId: month,
    summary: `Cleared New ETC on ${clearedCount} entr${clearedCount === 1 ? "y" : "ies"} for ${month}`,
  });

  revalidatePath("/etc");
}
