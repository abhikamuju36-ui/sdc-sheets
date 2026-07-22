import { PageTitle } from "@/components/ui/Typography";
import { card } from "@/components/ui/classnames";
import { JobHoursDashboard } from "@/components/JobHoursDashboard";
import { JobMultiSelect } from "@/components/JobMultiSelect";
import { listDashboardJobs, getJobHoursDashboard, defaultDashboardJobId } from "@/lib/job-hours-dashboard";
import { getJobPartsCost, type JobPartsCost } from "@/lib/sync-totaleto";
import { getExecutionEtcByJob } from "@/lib/execution-etc";
import { PartsCostSection } from "@/components/PartsCostSection";

// "Job Hour Details" — web recreation of the Power BI "Job Hours Report —
// Management Level" drillthrough. Supports one OR many jobs (aggregated), like
// the report's job slicer. Selected jobs travel in ?jobs=<jobId,jobId,…>.
export default async function JobHoursPage({
  searchParams,
}: {
  searchParams: Promise<{ jobs?: string; job?: string }>;
}) {
  const { jobs: jobsParam, job: legacyJobParam } = await searchParams;
  const jobs = await listDashboardJobs();
  const idByJobId = new Map(jobs.map((j) => [j.jobId, j.id]));

  // Selected Job Ids (e.g. "1135,1136"). Falls back to the legacy single ?job=
  // (internal id) param, then to the data-rich default.
  let selectedJobIds = (jobsParam ?? "").split(",").map((s) => s.trim()).filter((s) => idByJobId.has(s));
  if (selectedJobIds.length === 0 && legacyJobParam) {
    const j = jobs.find((x) => x.id === Number(legacyJobParam));
    if (j) selectedJobIds = [j.jobId];
  }
  if (selectedJobIds.length === 0) {
    const def = await defaultDashboardJobId();
    const j = jobs.find((x) => x.id === def);
    if (j) selectedJobIds = [j.jobId];
  }
  const selectedInternalIds = selectedJobIds.map((s) => idByJobId.get(s)!).filter((n) => n != null);
  const data = selectedInternalIds.length ? await getJobHoursDashboard(selectedInternalIds) : null;

  // Parts Cost — live from TotalETO — aggregated across every selected job, plus
  // the parts New ETC (Estimated to Purchase). Best-effort: a TotalETO hiccup
  // must not take down the hours dashboard.
  let parts: JobPartsCost | null = null;
  let partsEtc: number | null = null;
  if (data) {
    try {
      const perJob = await Promise.all(data.jobRefs.map((r) => getJobPartsCost(r.jobId).catch(() => null)));
      const lines = perJob.filter(Boolean).flatMap((r) => r!.lines);
      lines.sort((a, b) => (b.purchaseDate ?? "").localeCompare(a.purchaseDate ?? ""));
      const purchased = lines.reduce((s, l) => s + l.totalPrice, 0);
      const paid = lines.reduce((s, l) => s + l.invoicedAmount, 0);
      parts = { purchased, paid, leftToPay: purchased - paid, lines };
    } catch {
      parts = null;
    }
    if (data.kpis.latestEtcMonth) {
      try {
        const map = await getExecutionEtcByJob(data.jobRefs.map((r) => r.id), data.kpis.latestEtcMonth);
        partsEtc = data.jobRefs.reduce((s, r) => s + (map.get(r.id)?.parts ?? 0), 0);
      } catch {
        partsEtc = null;
      }
    }
  }

  return (
    <div className="w-full p-6 md:p-8">
      <div className="mb-1 flex flex-wrap items-end justify-between gap-4">
        <PageTitle>Job Hour Details</PageTitle>
        <div className="flex items-center gap-2">
          <span className="text-xs text-sdc-gray-500">Jobs</span>
          <JobMultiSelect jobs={jobs} selected={selectedJobIds} />
        </div>
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
