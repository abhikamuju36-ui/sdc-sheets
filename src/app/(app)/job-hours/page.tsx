import { PageTitle } from "@/components/ui/Typography";
import { card, INPUT } from "@/components/ui/classnames";
import { JobHoursDashboard } from "@/components/JobHoursDashboard";
import { listDashboardJobs, getJobHoursDashboard, defaultDashboardJobId } from "@/lib/job-hours-dashboard";
import { getJobPartsCost, type JobPartsCost } from "@/lib/sync-totaleto";
import { getExecutionEtcByJob } from "@/lib/execution-etc";
import { PartsCostSection } from "@/components/PartsCostSection";

// "Job Hour Details" — web recreation of the Power BI "Job Hours Report —
// Management Level" drillthrough dashboard, scoped to one job. Phase 1: the
// hours half (KPIs, per-section matrix, Estimate-to-Complete-vs-Actual and
// by-Billing-Group charts). Parts Cost half is Phase 2.
export default async function JobHoursPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const { job: jobParam } = await searchParams;
  const jobs = await listDashboardJobs();
  const selectedId = jobParam ? Number(jobParam) : (await defaultDashboardJobId()) ?? jobs[0]?.id;
  const data = selectedId ? await getJobHoursDashboard(selectedId) : null;

  // Parts Cost — live from TotalETO — plus the parts New ETC (Estimated to
  // Purchase) for the latest ETC month. Both best-effort: a TotalETO hiccup must
  // not take down the hours dashboard.
  let parts: JobPartsCost | null = null;
  let partsEtc: number | null = null;
  if (data) {
    try {
      parts = await getJobPartsCost(data.job.jobId);
    } catch {
      parts = null;
    }
    if (data.kpis.latestEtcMonth) {
      try {
        const map = await getExecutionEtcByJob([data.job.id], data.kpis.latestEtcMonth);
        partsEtc = map.get(data.job.id)?.parts ?? null;
      } catch {
        partsEtc = null;
      }
    }
  }

  return (
    <div className="w-full p-6 md:p-8">
      <div className="mb-1 flex flex-wrap items-end justify-between gap-4">
        <PageTitle>Job Hour Details</PageTitle>
        <form method="get" className="flex items-center gap-2">
          <label className="text-xs text-sdc-gray-500" htmlFor="job">Job</label>
          <select
            id="job"
            name="job"
            defaultValue={selectedId ? String(selectedId) : ""}
            className={`${INPUT} min-w-64`}
            // Auto-submit on change so picking a job reloads the dashboard.
            // (Progressive enhancement: a Go button also submits.)
          >
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.jobId} — {j.jobName}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-sdc-blue px-3 py-2 text-sm font-medium text-white">Go</button>
        </form>
      </div>
      <p className="mb-5 text-sm text-sdc-gray-600">
        Quoted vs actual vs estimate-to-complete hours by section and billing group, per job.
      </p>

      {data ? (
        <>
          <div className={`${card("p-4")} mb-5`}>
            <p className="text-lg font-semibold text-sdc-navy">
              {data.job.jobId} — {data.job.jobName}
            </p>
            <p className="text-xs text-sdc-gray-500">
              {data.job.customer ?? "—"} · {data.job.status}
            </p>
          </div>
          <JobHoursDashboard data={data} />
          <PartsCostSection parts={parts} estimatedToPurchase={partsEtc} />
        </>
      ) : (
        <div className={card("p-8")}>
          <p className="text-center text-sdc-gray-500">No job data available.</p>
        </div>
      )}
    </div>
  );
}
