import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { VALID_JOB_TYPES } from "@/lib/job-filters";
import { PageTitle } from "@/components/ui/Typography";
import { card, INPUT, LABEL, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/classnames";

async function createJob(formData: FormData) {
  "use server";
  const jobId = String(formData.get("jobId"));
  const jobName = String(formData.get("jobName"));
  const type = String(formData.get("type"));
  const poStartDateRaw = formData.get("poStartDate");
  const poStartDate = poStartDateRaw ? new Date(String(poStartDateRaw)) : null;

  const job = await prisma.job.create({
    data: { jobId, jobName, type, poStartDate, source: "manual" },
  });

  redirect(`/jobs/${job.id}`);
}

export default function NewJobPage() {
  return (
    <div className="mx-auto w-full max-w-lg p-8">
      <PageTitle className="mb-6">New Job</PageTitle>
      <form action={createJob} className="space-y-4">
        <div className={`${card("p-5")} space-y-4`}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-sdc-gray-400">Job Info</p>
          <div>
            <label className={LABEL}>Job Id</label>
            <input name="jobId" required className={`mt-1 w-full ${INPUT}`} />
          </div>
          <div>
            <label className={LABEL}>Job Name</label>
            <input name="jobName" required className={`mt-1 w-full ${INPUT}`} />
          </div>
          <div>
            <label className={LABEL}>PO Start Date</label>
            <input type="date" name="poStartDate" className={`mt-1 w-full ${INPUT}`} />
          </div>
        </div>

        <div className={`${card("p-5")} space-y-4`}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-sdc-gray-400">Classification</p>
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
            <p className="mt-1 text-[11px] text-sdc-gray-400">Required — select a job type before saving.</p>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Link href="/jobs" className={BUTTON_SECONDARY}>
            Cancel
          </Link>
          <button type="submit" className={BUTTON_PRIMARY}>
            Create Job
          </button>
        </div>
      </form>
      <p className="mt-4 text-xs text-sdc-gray-400">
        Manual entry today (source=&quot;manual&quot;). Once the upstream job/estimate source is
        confirmed, jobs can be auto-synced instead — this form stays as a fallback/override.
      </p>
    </div>
  );
}
