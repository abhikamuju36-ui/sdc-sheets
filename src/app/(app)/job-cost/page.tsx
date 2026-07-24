import { PageTitle } from "@/components/ui/Typography";
import { card } from "@/components/ui/classnames";
import { listDashboardJobs } from "@/lib/job-hours-dashboard";
import { getJobBom, type JobBom } from "@/lib/job-bom";
import { JobCostPicker } from "@/components/JobCostPicker";
import { JobBomMatrix } from "@/components/JobBomMatrix";

// "Job Cost" — native recreation of the Power BI "Job Status, Job" BOM cost
// hierarchy. Single job, expandable assembly/part tree with rolled-up costs
// pulled live from the Assembly table in the Power BI dataset (see job-bom.ts).
export default async function JobCostPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const { job } = await searchParams;
  const jobs = await listDashboardJobs();
  const selected = job && jobs.some((j) => j.jobId === job) ? job : (jobs[0]?.jobId ?? "");

  let bom: JobBom | null = null;
  let error: string | null = null;
  if (selected) {
    try {
      bom = await getJobBom(selected);
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not load the BOM from Power BI.";
    }
  }

  return (
    <div className="w-full p-6 md:p-8">
      <div className="mb-1 flex flex-wrap items-end justify-between gap-4">
        <PageTitle>Job Cost</PageTitle>
        <div className="flex items-center gap-2">
          <span className="text-xs text-sdc-gray-500">Job</span>
          <JobCostPicker jobs={jobs} selected={selected} />
        </div>
      </div>
      <p className="mb-5 text-sm text-sdc-gray-600">
        Bill-of-materials cost hierarchy — assemblies and parts with rolled-up costs and quantities, pulled live from Total ETO via Power BI.
      </p>

      {!selected ? (
        <div className={card("p-8")}><p className="text-center text-sdc-gray-500">No jobs available.</p></div>
      ) : error ? (
        <div className={card("p-8")}><p className="text-center text-sdc-gray-500">Couldn&apos;t load the BOM: {error}</p></div>
      ) : bom && bom.roots.length ? (
        <>
          <p className="mb-3 text-xs text-sdc-gray-400">{bom.rowCount.toLocaleString()} BOM lines</p>
          <JobBomMatrix bom={bom} />
        </>
      ) : (
        <div className={card("p-8")}><p className="text-center text-sdc-gray-500">No BOM found for this job.</p></div>
      )}
    </div>
  );
}
