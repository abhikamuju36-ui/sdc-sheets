import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { syncFromTotalEto } from "@/lib/sync-totaleto";
import { syncActualHoursFromPowerBi, syncQuotedFromPowerBi } from "@/lib/sync-powerbi";
import { validJobTypeFilter } from "@/lib/job-filters";
import { PageTitle, SectionTitle } from "@/components/ui/Typography";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { card, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/classnames";

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function runTotalEtoSync() {
  "use server";
  await syncFromTotalEto();
  revalidatePath("/");
}

async function runPowerBiSync() {
  "use server";
  await syncActualHoursFromPowerBi();
  revalidatePath("/");
}

async function runQuotedSync() {
  "use server";
  await syncQuotedFromPowerBi();
  revalidatePath("/");
  revalidatePath("/quoted");
}

function formatSynced(d: Date | null | undefined) {
  return d ? `Synced ${d.toISOString().slice(0, 16).replace("T", " ")}` : "Never synced";
}

function formatDataThrough(d: Date | null | undefined) {
  return d ? `data thru ${d.toISOString().slice(0, 10)}` : null;
}

export default async function Home() {
  const [
    jobCount,
    activeCount,
    employeeCount,
    needsReviewCount,
    recentJobs,
    lastTotalEtoSync,
    lastPowerBiSync,
    lastQuotedSync,
    hoursActualFreshness,
  ] = await Promise.all([
    prisma.job.count({ where: validJobTypeFilter }),
    prisma.job.count({ where: { status: "Active", ...validJobTypeFilter } }),
    prisma.employee.count({ where: { active: true } }),
    prisma.etcEntry.count({ where: { needsReview: true } }),
    prisma.job.findMany({ where: validJobTypeFilter, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.job.findFirst({ where: { totEtoSyncedAt: { not: null } }, orderBy: { totEtoSyncedAt: "desc" }, select: { totEtoSyncedAt: true } }),
    prisma.jobMonthlyActualHours.findFirst({ orderBy: { syncedAt: "desc" }, select: { syncedAt: true } }),
    prisma.estimatedHours.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    prisma.powerBiFreshness.findUnique({ where: { source: "hours_actual" }, select: { refreshedThrough: true } }),
  ]);

  const stats = [
    { label: "Total Jobs", value: jobCount, href: "/jobs" },
    { label: "Active Jobs", value: activeCount, href: "/jobs" },
    { label: "Active Employees", value: employeeCount, href: null },
    { label: "ETC Entries Needing Review", value: needsReviewCount, href: null, alert: needsReviewCount > 0 },
  ];

  const syncRows = [
    { label: "Jobs from TotalETO", action: runTotalEtoSync, lastSynced: lastTotalEtoSync?.totEtoSyncedAt, dataThrough: null },
    {
      label: "Actual hours from Power BI",
      action: runPowerBiSync,
      lastSynced: lastPowerBiSync?.syncedAt,
      dataThrough: hoursActualFreshness?.refreshedThrough,
    },
    { label: "Quoted hours & cost from Power BI", action: runQuotedSync, lastSynced: lastQuotedSync?.updatedAt, dataThrough: null },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl p-8">
      <div className="mb-8">
        <PageTitle>Dashboard</PageTitle>
        <p className="text-sm text-sdc-gray-600">Estimate-to-complete tracking for active SDC projects</p>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => {
          const cardEl = (
            <div
              className={
                s.alert
                  ? `${card("p-5")} border-sdc-yellow bg-sdc-yellow-bg/40 transition-shadow hover:shadow-md`
                  : `${card("p-5")} transition-shadow hover:shadow-md`
              }
            >
              <p className={`text-3xl font-bold ${s.alert ? "text-sdc-yellow-text" : "text-sdc-blue"}`}>{s.value}</p>
              <p className={`mt-1 text-xs font-medium ${s.alert ? "text-sdc-yellow-text" : "text-sdc-gray-600"}`}>{s.label}</p>
            </div>
          );
          return s.href ? (
            <Link key={s.label} href={s.href}>
              {cardEl}
            </Link>
          ) : (
            <div key={s.label}>{cardEl}</div>
          );
        })}
      </div>

      <div className="mb-6 flex gap-3">
        <Link href="/jobs" className={BUTTON_PRIMARY}>
          Manage Jobs
        </Link>
        <Link href="/jobs/new" className={BUTTON_SECONDARY}>
          + New Job
        </Link>
      </div>

      <div className={`${card("p-5")} mb-6`}>
        <SectionTitle>Data Sync</SectionTitle>
        <p className="mb-1 mt-1 text-xs text-sdc-gray-600">Same sources the original spreadsheet used.</p>
        <div className="divide-y divide-sdc-border-soft">
          {syncRows.map((row) => (
            <div key={row.label} className="flex items-center justify-between py-3">
              <p className="text-sm font-medium text-sdc-gray-700">{row.label}</p>
              <div className="flex items-center gap-3">
                <span className="text-right text-[11px] text-sdc-gray-400">
                  {formatSynced(row.lastSynced)}
                  {formatDataThrough(row.dataThrough) && (
                    <>
                      <br />
                      <span title="How current the underlying Power BI feed itself is, not when the app last asked">
                        {formatDataThrough(row.dataThrough)}
                      </span>
                    </>
                  )}
                </span>
                <form action={row.action}>
                  <button type="submit" className={`${BUTTON_PRIMARY} px-3 py-1.5 text-xs`}>
                    Sync
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={card("p-0")}>
        <div className="border-b border-sdc-border-soft px-5 py-3">
          <SectionTitle>Recently Added Jobs</SectionTitle>
        </div>
        <div className="divide-y divide-sdc-border-soft">
          {recentJobs.length === 0 && <p className="p-5 text-sm text-sdc-gray-400">No jobs yet.</p>}
          {recentJobs.map((job) => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className="flex items-center justify-between px-5 py-3 text-sm transition-colors hover:bg-sdc-blue-light/40"
            >
              <span>
                <span className="font-mono text-sdc-gray-400">#{job.jobId}</span>{" "}
                <span className="font-medium text-sdc-navy">{job.jobName}</span>
              </span>
              <StatusBadge variant={job.status === "Complete" ? "complete" : "active"}>{job.status}</StatusBadge>
            </Link>
          ))}
        </div>
      </div>

      <p className="mt-3 text-xs text-sdc-gray-400">Current ETC month: {currentMonth()}</p>
    </div>
  );
}
