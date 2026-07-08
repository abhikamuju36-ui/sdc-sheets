"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { calcHoursLeft, suggestNewEtc, isMonthLocked, round2 } from "@/lib/etc";
import { validJobTypeFilter } from "@/lib/job-filters";
import { syncActualHoursFromPowerBi, syncHoursWorkedFromPowerBi, syncPartsCostFromPowerBi } from "@/lib/sync-powerbi";
import { ETC_TRACKED_CODES } from "@/lib/sections";
import { revalidatePath } from "next/cache";

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1); // m is 1-indexed; m-2 lands on the previous month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
  const jobs = await prisma.job.findMany({
    where: { status: "Active", ...validJobTypeFilter },
    include: { estimatedHours: true },
  });
  const jobIds = jobs.map((j) => j.id);

  const [priorEntries, existingEntries] = await Promise.all([
    prisma.etcEntry.findMany({ where: { month: prevMonth(month), jobId: { in: jobIds } } }),
    prisma.etcEntry.findMany({ where: { month, jobId: { in: jobIds } } }),
  ]);
  const priorByKey = new Map(priorEntries.map((e) => [`${e.jobId}-${e.section}`, e]));
  const existingByKey = new Map(existingEntries.map((e) => [`${e.jobId}-${e.section}`, e]));

  await prisma.$transaction(
    async (tx) => {
      for (const job of jobs) {
        for (const eh of job.estimatedHours) {
          if (!ETC_TRACKED_CODES.has(eh.section)) continue;
          const key = `${job.id}-${eh.section}`;
          const existing = existingByKey.get(key);
          if (existing && !existing.needsReview) continue; // already submitted — don't touch confirmed history

          const priorEntry = priorByKey.get(key);
          const priorEtc = priorEntry ? Number(priorEntry.newEtc) : Number(eh.estimateToCompleteHours);
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
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const entries = await prisma.etcEntry.findMany({ where: { month } });
  const updates: { id: number; priorEtc: number; hoursWorked: number; newEtc: number }[] = [];

  for (const entry of entries) {
    const rawHours = formData.get(`hoursWorked__${entry.id}`);
    if (rawHours === null || rawHours === "") {
      throw new Error(`Missing Hours Worked for entry ${entry.id} (section ${entry.section}).`);
    }
    const hoursWorked = Number(rawHours);
    if (!Number.isFinite(hoursWorked) || hoursWorked < 0) {
      throw new Error(`Invalid Hours Worked "${rawHours}" for entry ${entry.id} (section ${entry.section}).`);
    }

    const rawOverride = formData.get(`newEtcOverride__${entry.id}`);
    let newEtc: number;
    if (rawOverride !== null && rawOverride !== "") {
      const overrideVal = Number(rawOverride);
      if (!Number.isFinite(overrideVal) || overrideVal < 0) {
        throw new Error(`Invalid New ETC override "${rawOverride}" for entry ${entry.id} (section ${entry.section}).`);
      }
      newEtc = round2(overrideVal);
    } else {
      newEtc = round2(suggestNewEtc(Number(entry.priorEtc), hoursWorked));
    }

    updates.push({ id: entry.id, priorEtc: Number(entry.priorEtc), hoursWorked, newEtc });
  }

  await prisma.$transaction(
    async (tx) => {
      for (const u of updates) {
        await tx.etcEntry.update({
          where: { id: u.id },
          data: {
            hoursWorked: u.hoursWorked,
            hoursLeftCalc: round2(calcHoursLeft(u.priorEtc, u.hoursWorked)),
            newEtc: u.newEtc,
            needsReview: false,
            submittedAt: new Date(),
            ...(userId ? { enteredById: Number(userId) } : {}),
          },
        });
      }
    },
    { timeout: 20000 },
  );

  revalidatePath("/etc");
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

  revalidatePath("/etc");
}

// Parity with the original sheet's "Refresh Data" button: pulls the latest
// actual hours from Power BI. Updates the job-level rollup (for the
// dashboard/job-detail views) AND overwrites this month's EtcEntry.hoursWorked
// per section directly — Hours Worked is meant to always reflect Power BI,
// not be independently typed in. Recomputes Hours Left / suggested New ETC
// from the fresh value, but leaves needsReview untouched so a manager still
// confirms before it counts as submitted.
export async function syncPowerBiForEtc(month: string, _formData: FormData) {
  await syncActualHoursFromPowerBi();
  await syncHoursWorkedFromPowerBi(month);
  await syncPartsCostFromPowerBi(month);
  revalidatePath("/etc");
  revalidatePath("/");
}

// Parity with the original sheet's "Clear ETC" button: resets Hours Worked (and the
// derived New ETC) back to a fresh carry-forward state for every entry in `month`.
// Refuses to touch a locked (submitted) month — reopen it first if a genuine
// correction is needed, so a clear can never silently erase confirmed history.
export async function clearMonth(month: string, _formData: FormData) {
  const entries = await prisma.etcEntry.findMany({ where: { month } });
  if (isMonthLocked(entries)) {
    throw new Error(`${month} is already submitted — reopen it before clearing.`);
  }

  await prisma.$transaction(
    async (tx) => {
      for (const entry of entries) {
        const priorEtc = Number(entry.priorEtc);
        await tx.etcEntry.update({
          where: { id: entry.id },
          data: { hoursWorked: 0, hoursLeftCalc: priorEtc, newEtc: priorEtc },
        });
      }
    },
    { timeout: 20000 },
  );

  revalidatePath("/etc");
}
