import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { validJobTypeFilter, compareJobIds } from "@/lib/job-filters";
import { PageTitle } from "@/components/ui/Typography";
import { PillLinks } from "@/components/ui/PillLinks";
import { card, INPUT, BUTTON_PRIMARY, BUTTON_SECONDARY, TABLE_HEADER_ROW, TABLE_ROW_HOVER, TABLE_GRID } from "@/components/ui/classnames";

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

  const jobs = await prisma.job.findMany({ where });
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
    <div className="mx-auto w-full max-w-6xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <PageTitle>Jobs</PageTitle>
          <p className="text-sm text-sdc-gray-600">{jobs.length} job{jobs.length === 1 ? "" : "s"}</p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/jobs/export?${exportQs.toString()}`} className={BUTTON_SECONDARY}>
            Export CSV
          </a>
          <Link href="/jobs/new" className={BUTTON_PRIMARY}>
            + New Job
          </Link>
        </div>
      </div>

      <div className={`${card("p-3")} mb-4 flex flex-wrap items-center gap-3`}>
        <form className="flex flex-1 gap-2">
          <input type="hidden" name="status" value={status ?? ""} />
          <input type="text" name="q" defaultValue={q} placeholder="Search by Job Id or name…" className={`flex-1 ${INPUT}`} />
          <button type="submit" className={BUTTON_PRIMARY}>
            Search
          </button>
        </form>
        <PillLinks items={statusLinks} />
      </div>

      <div className="overflow-hidden border border-sdc-border bg-white shadow-sm">
        <table className={`w-full text-sm ${TABLE_GRID}`}>
          <thead>
            <tr className={TABLE_HEADER_ROW}>
              <th className="px-4 py-3">Job Id</th>
              <th className="px-4 py-3">Job Name</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-5 text-sdc-gray-400">
                  No jobs match this filter.
                </td>
              </tr>
            )}
            {jobs.map((job, i) => (
              <tr key={job.id} className={`${TABLE_ROW_HOVER} ${i % 2 === 1 ? "bg-sdc-gray-50/60" : ""}`}>
                <td className="px-4 py-2 font-mono text-sdc-gray-400">
                  <Link href={`/jobs/${job.id}`} className="hover:underline">
                    {job.jobId}
                  </Link>
                </td>
                <td className="px-4 py-2 font-medium text-sdc-navy">
                  <Link href={`/jobs/${job.id}`} className="hover:underline">
                    {job.jobName}
                  </Link>
                </td>
                <td className="px-4 py-2 text-sdc-gray-600">{job.customer ?? "—"}</td>
                <td className="px-4 py-2 text-sdc-gray-600">{job.type ?? "—"}</td>
                <td
                  className={`px-4 py-2 font-medium ${
                    job.status === "Complete" ? "text-sdc-green-text" : "text-sdc-blue-dark"
                  }`}
                >
                  {job.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
