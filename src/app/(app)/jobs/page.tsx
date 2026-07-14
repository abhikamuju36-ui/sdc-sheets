import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { validJobTypeFilter, compareJobIds } from "@/lib/job-filters";
import { PageTitle } from "@/components/ui/Typography";
import { card, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/classnames";

const STATUS_FILTERS = [
  { key: "all", label: "All", status: undefined },
  { key: "active", label: "Active", status: "Active" },
  { key: "completed", label: "Completed", status: "Complete" },
];

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q, status } = await searchParams;

  const where: Prisma.JobWhereInput = { ...validJobTypeFilter };
  if (q) {
    where.OR = [
      { jobName: { contains: q } },
      { jobId: { contains: q } },
    ];
  }
  if (status) where.status = status;

  const jobs = await prisma.job.findMany({
    where,
    include: { _count: { select: { estimatedHours: true } } },
  });
  jobs.sort((a, b) => compareJobIds(a.jobId, b.jobId)); // numeric, not lexicographic

  const exportQs = new URLSearchParams();
  if (q) exportQs.set("q", q);
  if (status) exportQs.set("status", status);

  const statusLinks = STATUS_FILTERS.map((f) => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (f.status) qs.set("status", f.status);
    const query = qs.toString();
    return {
      key: f.key,
      label: f.label,
      href: `/jobs${query ? `?${query}` : ""}`,
      active: (f.status ?? "") === (status ?? ""),
    };
  });

  return (
    <div className="w-full max-w-[1440px] px-8 py-10 md:px-13 md:py-11">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <PageTitle>Jobs</PageTitle>
          <p className="text-sm text-sdc-gray-600">{jobs.length} job{jobs.length === 1 ? "" : "s"}</p>
        </div>
        <div className="flex shrink-0 gap-2.5">
          <a href={`/api/jobs/export?${exportQs.toString()}`} className={BUTTON_SECONDARY}>
            Export CSV
          </a>
          <Link href="/jobs/new" className={BUTTON_PRIMARY}>
            + New Job
          </Link>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2.5">
        <form className="flex flex-1 gap-2.5">
          <input type="hidden" name="status" value={status ?? ""} />
          <div className="flex flex-1 items-center gap-2.5 rounded-lg border border-sdc-border bg-white px-3.5">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sdc-gray-400">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Search by Job Id or name…"
              className="flex-1 border-none bg-transparent py-2.5 text-sm text-sdc-navy outline-none placeholder:text-sdc-gray-400"
            />
          </div>
          <button type="submit" className={BUTTON_PRIMARY}>
            Search
          </button>
        </form>
        <div className="flex gap-1 rounded-lg bg-sdc-gray-100 p-1">
          {statusLinks.map((f) => (
            <Link
              key={f.key}
              href={f.href}
              className={`rounded-md px-4 py-1.5 text-[13px] font-semibold whitespace-nowrap transition-colors ${
                f.active ? "bg-sdc-blue text-white shadow-sm" : "text-sdc-gray-600 hover:text-sdc-navy"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      <div className={`${card("p-0")} overflow-x-auto`}>
        <div className="grid min-w-[900px] grid-cols-[40px_76px_minmax(240px,1fr)_180px_110px_120px] items-center gap-4 border-b border-sdc-border-soft bg-sdc-gray-50/60 px-6 py-3">
          {["#", "Job Id", "Job Name", "Customer", "Type", "Status"].map((h) => (
            <span key={h} className="text-[11px] font-semibold tracking-wider text-sdc-gray-400 uppercase">
              {h}
            </span>
          ))}
        </div>
        {jobs.length === 0 && <p className="px-6 py-5 text-sm text-sdc-gray-400">No jobs match this filter.</p>}
        <div className="divide-y divide-sdc-border-soft">
          {jobs.map((job, i) => {
            const noUpstreamData = job._count.estimatedHours === 0 && job.totEtoSyncedAt == null;
            return (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className="grid min-w-[900px] grid-cols-[40px_76px_minmax(240px,1fr)_180px_110px_120px] items-center gap-4 px-6 py-3 text-sm transition-colors hover:bg-sdc-blue-light/40"
            >
              <span className="text-sdc-gray-400 tabular-nums">{i + 1}</span>
              <span className="font-mono text-sdc-gray-500 tabular-nums">{job.jobId}</span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-semibold text-sdc-navy">{job.jobName}</span>
                {noUpstreamData && (
                  <span
                    title="No TotalETO or Power BI data has synced for this job yet — check the Job Id matches upstream, or try syncing again."
                    className="shrink-0 rounded-full bg-sdc-yellow-bg px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap text-sdc-yellow-text"
                  >
                    No PBI/ETO data yet
                  </span>
                )}
              </span>
              <span className="truncate text-sdc-gray-600">{job.customer ?? "—"}</span>
              <span className="text-sdc-gray-600">{job.type ?? "—"}</span>
              <span
                className={`flex items-center gap-1.5 text-[12.5px] font-semibold ${
                  job.status === "Complete" ? "text-sdc-green-text" : "text-sdc-blue"
                }`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${job.status === "Complete" ? "bg-sdc-green" : "bg-sdc-blue"}`} />
                {job.status}
              </span>
            </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
