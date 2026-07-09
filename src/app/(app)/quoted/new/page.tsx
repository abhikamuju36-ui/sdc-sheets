import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { VALID_JOB_TYPES } from "@/lib/job-filters";
import { SECTIONS, PHASE_GROUPS } from "@/lib/sections";
import { PageTitle } from "@/components/ui/Typography";
import { card, INPUT, LABEL, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/classnames";

function num(v: FormDataEntryValue | null): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function dateOrNull(v: FormDataEntryValue | null): Date | null {
  return v ? new Date(String(v)) : null;
}

async function createProject(formData: FormData) {
  "use server";
  const jobId = String(formData.get("jobId"));
  const jobName = String(formData.get("jobName"));
  const customer = formData.get("customer") ? String(formData.get("customer")) : null;
  const type = String(formData.get("type"));
  const status = String(formData.get("status") || "Active");
  const startDate = dateOrNull(formData.get("startDate"));
  const completeDate = dateOrNull(formData.get("completeDate"));
  const includeInTypeCalc = formData.get("includeInTypeCalc") === "on";
  const costQuotedRaw = formData.get("costQuoted");
  const costActualRaw = formData.get("costActualHistorical");
  const costQuoted = costQuotedRaw ? num(costQuotedRaw) : null;
  const costActualHistorical = costActualRaw ? num(costActualRaw) : null;

  const job = await prisma.job.create({
    data: {
      jobId,
      jobName,
      customer,
      type,
      status,
      startDate,
      completeDate,
      includeInTypeCalc,
      costQuoted,
      costActualHistorical,
      source: "manual",
    },
  });

  const hoursRows = SECTIONS.map((s) => ({
    jobId: job.id,
    section: s.code,
    quotedHours: num(formData.get(`quoted__${s.code}`)),
  })).filter((r) => r.quotedHours !== 0);

  if (hoursRows.length > 0) {
    await prisma.estimatedHours.createMany({ data: hoursRows });
  }

  redirect("/quoted");
}

export default function NewProjectPage() {
  return (
    <div className="mx-auto w-full max-w-3xl p-8">
      <PageTitle className="mb-6">Add Project</PageTitle>
      <form action={createProject} className="space-y-4">
        <div className={`${card("p-5")} grid grid-cols-2 gap-4`}>
          <p className="col-span-2 text-[11px] font-semibold uppercase tracking-wide text-sdc-gray-400">
            Project Info
          </p>
          <div>
            <label className={LABEL}>Job Id</label>
            <input name="jobId" required className={`mt-1 w-full ${INPUT}`} />
          </div>
          <div>
            <label className={LABEL}>Job Name / Description</label>
            <input name="jobName" required className={`mt-1 w-full ${INPUT}`} />
          </div>
          <div>
            <label className={LABEL}>Customer</label>
            <input name="customer" className={`mt-1 w-full ${INPUT}`} />
          </div>
          <div>
            <label className={LABEL}>
              Type <span className="text-red-600">*</span>
            </label>
            <select name="type" required className={`mt-1 w-full ${INPUT}`}>
              <option value="">Select a type…</option>
              {VALID_JOB_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL}>Status</label>
            <input name="status" list="status-options" defaultValue="Active" className={`mt-1 w-full ${INPUT}`} />
            <datalist id="status-options">
              <option value="Active" />
              <option value="Complete" />
            </datalist>
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-xs font-medium text-sdc-gray-700">
              <input type="checkbox" name="includeInTypeCalc" className="h-4 w-4 rounded border-sdc-border" />
              Include in Type Calc
            </label>
          </div>
          <div>
            <label className={LABEL}>Start Date</label>
            <input type="date" name="startDate" className={`mt-1 w-full ${INPUT}`} />
          </div>
          <div>
            <label className={LABEL}>Complete Date</label>
            <input type="date" name="completeDate" className={`mt-1 w-full ${INPUT}`} />
          </div>
          <div>
            <label className={LABEL}>Cost Quoted ($)</label>
            <input type="number" step="0.01" name="costQuoted" className={`mt-1 w-full ${INPUT}`} />
          </div>
          <div>
            <label className={LABEL}>Cost Actual Historical ($)</label>
            <input type="number" step="0.01" name="costActualHistorical" className={`mt-1 w-full ${INPUT}`} />
          </div>
        </div>

        <div className={`${card("p-5")} space-y-4`}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-sdc-gray-400">
            Quoted Hours by Section
          </p>
          {PHASE_GROUPS.map((g) => (
            <div key={g.phase}>
              <p className="mb-2 text-xs font-semibold text-sdc-navy">{g.phase}</p>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {SECTIONS.filter((s) => s.phase === g.phase).map((s) => (
                  <div key={s.code}>
                    <label className={LABEL}>
                      {s.name}
                      <span className="ml-1 font-mono text-[10px] text-sdc-gray-400">{s.code}</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      name={`quoted__${s.code}`}
                      defaultValue={0}
                      className={`mt-1 w-full ${INPUT}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-3">
          <Link href="/quoted" className={BUTTON_SECONDARY}>
            Cancel
          </Link>
          <button type="submit" className={BUTTON_PRIMARY}>
            Create Project
          </button>
        </div>
      </form>
    </div>
  );
}
