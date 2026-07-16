"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { VALID_JOB_TYPES, isSdcCustomer } from "@/lib/job-filters";

const HOURS_PREFIX = "quoted__";
const FIELD_PREFIX = "jobField__";
const NEW_ROW_FIELD_PREFIX = "newRow__";
const NEW_ROW_HOURS_PREFIX = "newRowHours__";

// Job-level text/date fields that don't need special parsing/validation
// beyond "trim, empty string means null".
const PLAIN_FIELDS = ["jobName", "customer", "status"] as const;
const DATE_FIELDS = ["startDate", "completeDate"] as const;
const MONEY_FIELDS = ["costQuoted", "costActualHistorical"] as const;
type PlainField = (typeof PLAIN_FIELDS)[number];
type DateField = (typeof DATE_FIELDS)[number];
type MoneyField = (typeof MONEY_FIELDS)[number];

// Saves every edited cell from the Projects grid — quoted hours by section
// AND the job-level fields (Job Name, Customer, Type, Status, Start/Complete
// Date, Cost Quoted, Cost Actual) — in one submission. Only cells whose
// value actually changed get written; Customer and Cost Quoted also get
// flagged manually-edited so the next TotalETO/Power BI sync can't silently
// overwrite a manager's correction (same pattern as quotedHoursManuallyEdited
// below) — those two are the only job fields either sync ever touches.
export async function saveQuotedHours(formData: FormData) {
  await Promise.all([saveHoursCells(formData), saveJobFields(formData), saveNewRows(formData)]);
  revalidatePath("/quoted");
}

async function saveHoursCells(formData: FormData) {
  const edits: { jobId: number; section: string; quotedHours: number }[] = [];

  for (const [key, rawValue] of formData.entries()) {
    if (!key.startsWith(HOURS_PREFIX)) continue;
    const rest = key.slice(HOURS_PREFIX.length);
    const sepIndex = rest.indexOf("__");
    if (sepIndex === -1) continue;
    const jobId = Number(rest.slice(0, sepIndex));
    const section = rest.slice(sepIndex + 2);
    if (!Number.isInteger(jobId)) continue;

    const raw = String(rawValue).trim();
    const quotedHours = raw === "" ? 0 : Number(raw);
    if (!Number.isInteger(quotedHours) || quotedHours < 0) {
      throw new Error(`Quoted hours must be a whole number — got "${raw}" for job ${jobId}, section ${section}.`);
    }
    edits.push({ jobId, section, quotedHours });
  }

  if (edits.length === 0) return;

  const existing = await prisma.estimatedHours.findMany({
    where: { OR: edits.map((e) => ({ jobId: e.jobId, section: e.section })) },
    select: { jobId: true, section: true, quotedHours: true },
  });
  const existingByKey = new Map(existing.map((e) => [`${e.jobId}::${e.section}`, Number(e.quotedHours)]));

  // The grid only ever displays/accepts whole numbers (see wholeHours() in
  // page.tsx) — its <input defaultValue> is Math.round(current). Compare
  // against the ROUNDED current value, not the raw one: otherwise an
  // untouched cell holding a fractional Power-BI-synced value (e.g. 40.33)
  // reads back as "changed" the moment ANY other cell on the page is saved
  // (the whole grid is one <form>, so every hours cell resubmits its
  // rendered value regardless of which one the manager actually edited),
  // silently truncating its precision and permanently locking it out of
  // future syncs via quotedHoursManuallyEdited.
  const changed = edits.filter((e) => {
    const current = existingByKey.get(`${e.jobId}::${e.section}`) ?? 0;
    return Math.round(current) !== e.quotedHours;
  });

  if (changed.length === 0) return;

  await prisma.$transaction(
    changed.map((e) =>
      prisma.estimatedHours.upsert({
        where: { jobId_section: { jobId: e.jobId, section: e.section } },
        update: { quotedHours: e.quotedHours, quotedHoursManuallyEdited: true },
        create: {
          jobId: e.jobId,
          section: e.section,
          quotedHours: e.quotedHours,
          actualHistoricalHours: 0,
          estimateToCompleteHours: 0,
          quotedHoursManuallyEdited: true,
        },
      })
    )
  );

  await logAudit({
    action: "quoted.saveQuotedHours",
    entityType: "EstimatedHours",
    summary: `Updated quoted hours for ${changed.length} job/section cell${changed.length === 1 ? "" : "s"}`,
    metadata: { changed },
  });
}

function parseDate(raw: string): Date | null {
  if (raw === "") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date "${raw}".`);
  return d;
}

function parseMoney(raw: string, field: string, label: number | string): number | null {
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid ${field} "${raw}" for ${typeof label === "number" ? `job ${label}` : label}.`);
  }
  return n;
}

async function saveJobFields(formData: FormData) {
  // jobId -> field -> raw string value, collected from every jobField__ input present.
  const byJob = new Map<number, Map<string, string>>();
  for (const [key, rawValue] of formData.entries()) {
    if (!key.startsWith(FIELD_PREFIX)) continue;
    const rest = key.slice(FIELD_PREFIX.length);
    const sepIndex = rest.indexOf("__");
    if (sepIndex === -1) continue;
    const jobId = Number(rest.slice(0, sepIndex));
    const field = rest.slice(sepIndex + 2);
    if (!Number.isInteger(jobId)) continue;
    if (!byJob.has(jobId)) byJob.set(jobId, new Map());
    byJob.get(jobId)!.set(field, String(rawValue));
  }
  if (byJob.size === 0) return;

  const jobIds = [...byJob.keys()];
  const currentJobs = await prisma.job.findMany({
    where: { id: { in: jobIds } },
    select: {
      id: true,
      jobName: true,
      customer: true,
      type: true,
      status: true,
      startDate: true,
      completeDate: true,
      costQuoted: true,
      costActualHistorical: true,
      billable: true,
    },
  });
  const currentById = new Map(currentJobs.map((j) => [j.id, j]));

  const updates: { id: number; data: Record<string, unknown> }[] = [];
  const changedFieldSummaries: string[] = [];

  for (const [jobId, fields] of byJob) {
    const current = currentById.get(jobId);
    if (!current) continue;
    const data: Record<string, unknown> = {};

    for (const field of PLAIN_FIELDS) {
      if (!fields.has(field)) continue;
      const raw = fields.get(field)!.trim();
      if (field === "jobName" && raw === "") throw new Error(`Job Name cannot be blank for job ${jobId}.`);
      const nextValue: string | null = field === "jobName" ? raw : raw === "" ? null : raw;
      if (nextValue !== (current[field as PlainField] ?? null)) {
        data[field] = nextValue;
        if (field === "customer") data.customerManuallyEdited = true;
      }
    }

    if (fields.has("type")) {
      const raw = fields.get("type")!.trim();
      if (!VALID_JOB_TYPES.includes(raw as (typeof VALID_JOB_TYPES)[number])) {
        throw new Error(`Invalid Type "${raw}" for job ${jobId} — must be one of ${VALID_JOB_TYPES.join(", ")}.`);
      }
      if (raw !== current.type) data.type = raw;
    }

    const effectiveCustomer = "customer" in data ? (data.customer as string | null) : current.customer;
    if (isSdcCustomer(effectiveCustomer)) {
      // SDC's own internal projects are never billable — this wins over
      // whatever the dropdown was submitted as.
      if (current.billable !== false) data.billable = false;
    } else if (fields.has("billable")) {
      const raw = fields.get("billable")!.trim();
      if (raw !== "Billable" && raw !== "Non-Billable") {
        throw new Error(`Invalid Billable value "${raw}" for job ${jobId} — must be "Billable" or "Non-Billable".`);
      }
      const nextValue = raw === "Billable";
      if (nextValue !== current.billable) data.billable = nextValue;
    }

    for (const field of DATE_FIELDS) {
      if (!fields.has(field)) continue;
      const nextValue = parseDate(fields.get(field)!.trim());
      const currentValue = current[field as DateField];
      const currentIso = currentValue ? currentValue.toISOString().slice(0, 10) : null;
      const nextIso = nextValue ? nextValue.toISOString().slice(0, 10) : null;
      if (nextIso !== currentIso) data[field] = nextValue;
    }

    for (const field of MONEY_FIELDS) {
      if (!fields.has(field)) continue;
      const nextValue = parseMoney(fields.get(field)!.trim(), field, jobId);
      const currentValue = current[field as MoneyField] != null ? Number(current[field as MoneyField]) : null;
      if (nextValue !== currentValue) {
        data[field] = nextValue;
        if (field === "costQuoted") data.costQuotedManuallyEdited = true;
      }
    }

    if (Object.keys(data).length > 0) {
      updates.push({ id: jobId, data });
      changedFieldSummaries.push(`job ${jobId}: ${Object.keys(data).filter((k) => !k.endsWith("ManuallyEdited")).join(", ")}`);
    }
  }

  if (updates.length === 0) return;

  await prisma.$transaction(updates.map((u) => prisma.job.update({ where: { id: u.id }, data: u.data })));

  await logAudit({
    action: "quoted.saveJobFields",
    entityType: "Job",
    summary: `Updated fields on ${updates.length} job${updates.length === 1 ? "" : "s"}`,
    metadata: { changed: changedFieldSummaries },
  });
}

// Creates every "+ Add Project" blank row the manager filled in. Job Id is
// the only required field — everything else has a safe default (Job Name
// falls back to the Job Id, Status to "Active", Type/dates/costs to null) —
// per explicit request, a missing Job Id blocks the WHOLE save with a clear
// error rather than silently skipping that row or inventing a placeholder.
async function saveNewRows(formData: FormData) {
  const fieldsByTemp = new Map<string, Map<string, string>>();
  const hoursByTemp = new Map<string, Map<string, string>>();

  for (const [key, rawValue] of formData.entries()) {
    if (key.startsWith(NEW_ROW_HOURS_PREFIX)) {
      const rest = key.slice(NEW_ROW_HOURS_PREFIX.length);
      const sepIndex = rest.indexOf("__");
      if (sepIndex === -1) continue;
      const tempId = rest.slice(0, sepIndex);
      const section = rest.slice(sepIndex + 2);
      if (!hoursByTemp.has(tempId)) hoursByTemp.set(tempId, new Map());
      hoursByTemp.get(tempId)!.set(section, String(rawValue));
    } else if (key.startsWith(NEW_ROW_FIELD_PREFIX)) {
      const rest = key.slice(NEW_ROW_FIELD_PREFIX.length);
      const sepIndex = rest.indexOf("__");
      if (sepIndex === -1) continue;
      const tempId = rest.slice(0, sepIndex);
      const field = rest.slice(sepIndex + 2);
      if (!fieldsByTemp.has(tempId)) fieldsByTemp.set(tempId, new Map());
      fieldsByTemp.get(tempId)!.set(field, String(rawValue));
    }
  }

  if (fieldsByTemp.size === 0) return;

  type NewRow = {
    jobId: string;
    jobName: string;
    customer: string | null;
    type: string | null;
    billable: boolean;
    status: string;
    startDate: Date | null;
    completeDate: Date | null;
    costQuoted: number | null;
    costActualHistorical: number | null;
    hours: { section: string; quotedHours: number }[];
  };

  // Validate every new row BEFORE creating anything — one bad row (missing
  // Job Id, invalid Type, duplicate Job Id) must reject the whole batch
  // rather than half-create some projects and silently drop others.
  const rows: NewRow[] = [];
  const seenJobIds = new Set<string>();

  for (const [tempId, fields] of fieldsByTemp) {
    const jobId = (fields.get("jobId") ?? "").trim();
    if (jobId === "") {
      throw new Error("Job Id is required to add a new project — enter a Job Id or remove the blank row before saving.");
    }
    if (!/^\d+$/.test(jobId)) {
      throw new Error(`Job Id must be a whole number — got "${jobId}".`);
    }
    if (seenJobIds.has(jobId)) {
      throw new Error(`Job Id "${jobId}" was entered more than once among the new rows you're adding.`);
    }
    seenJobIds.add(jobId);

    const jobNameRaw = (fields.get("jobName") ?? "").trim();
    const jobName = jobNameRaw === "" ? jobId : jobNameRaw;

    const customerRaw = (fields.get("customer") ?? "").trim();
    const customer = customerRaw === "" ? null : customerRaw;

    // Type is required, not just validated-if-present: the app's type-gating
    // policy (validJobTypeFilter in job-filters.ts) excludes null-type jobs
    // from every list/count/dashboard/export, so a job created here with no
    // Type would be written to the DB successfully, permanently reserve its
    // Job Id (the uniqueness check above queries unfiltered prisma.job), and
    // then never appear anywhere in the app again — no error, just silently
    // invisible history.
    const typeRaw = (fields.get("type") ?? "").trim();
    if (typeRaw === "") {
      throw new Error(`Type is required for new project "${jobId}" — select Custom, Duplicate, Hybrid, or Service.`);
    }
    if (!VALID_JOB_TYPES.includes(typeRaw as (typeof VALID_JOB_TYPES)[number])) {
      throw new Error(`Invalid Type "${typeRaw}" for new project "${jobId}".`);
    }
    const type = typeRaw;

    const billableRaw = (fields.get("billable") ?? "Billable").trim();
    if (billableRaw !== "Billable" && billableRaw !== "Non-Billable") {
      throw new Error(`Invalid Billable value "${billableRaw}" for new project "${jobId}" — must be "Billable" or "Non-Billable".`);
    }
    const billable = isSdcCustomer(customer) ? false : billableRaw === "Billable";

    const status = (fields.get("status") ?? "Active").trim() || "Active";
    const startDate = parseDate((fields.get("startDate") ?? "").trim());
    const completeDate = parseDate((fields.get("completeDate") ?? "").trim());
    const costQuoted = parseMoney((fields.get("costQuoted") ?? "").trim(), "Cost Quoted", `new project "${jobId}"`);
    const costActualHistorical = parseMoney((fields.get("costActualHistorical") ?? "").trim(), "Cost Actual", `new project "${jobId}"`);

    const hoursMap = hoursByTemp.get(tempId) ?? new Map();
    const hours: { section: string; quotedHours: number }[] = [];
    for (const [section, raw] of hoursMap) {
      const trimmed = raw.trim();
      if (trimmed === "") continue;
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`Quoted hours must be a whole number — got "${raw}" for new project "${jobId}", section ${section}.`);
      }
      if (n !== 0) hours.push({ section, quotedHours: n });
    }

    rows.push({ jobId, jobName, customer, type, billable, status, startDate, completeDate, costQuoted, costActualHistorical, hours });
  }

  if (rows.length === 0) return;

  const existing = await prisma.job.findMany({ where: { jobId: { in: rows.map((r) => r.jobId) } }, select: { jobId: true } });
  if (existing.length > 0) {
    throw new Error(`Job Id already in use: ${existing.map((e) => e.jobId).join(", ")}. Use a different Job Id.`);
  }

  const created = await prisma.$transaction(
    rows.map((r) =>
      prisma.job.create({
        data: {
          jobId: r.jobId,
          jobName: r.jobName,
          customer: r.customer,
          type: r.type,
          billable: r.billable,
          status: r.status,
          startDate: r.startDate,
          completeDate: r.completeDate,
          costQuoted: r.costQuoted,
          costActualHistorical: r.costActualHistorical,
          source: "manual",
          estimatedHours: r.hours.length
            ? { create: r.hours.map((h) => ({ section: h.section, quotedHours: h.quotedHours, quotedHoursManuallyEdited: true })) }
            : undefined,
        },
      })
    )
  );

  await logAudit({
    action: "quoted.addProject",
    entityType: "Job",
    summary: `Added ${created.length} new project${created.length === 1 ? "" : "s"} from the Projects tab`,
    metadata: { jobIds: created.map((j) => j.jobId) },
  });
}
