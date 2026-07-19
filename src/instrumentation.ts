const SYNC_INTERVAL_MS = 10 * 60 * 1000;

// Runs once when the Next.js server process starts. Guarded against
// re-registering on hot reload / multiple invocations in dev.
export async function register() {
  // instrumentation.ts's register() runs in both the Node.js and Edge
  // runtimes (the latter for proxy.ts/middleware) — the Power BI client's
  // Node-only imports (os, path, the native MSAL cache module) can't load
  // under Edge, so skip entirely there.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as typeof globalThis & { __pbiAutoSyncStarted?: boolean };
  if (g.__pbiAutoSyncStarted) return;
  g.__pbiAutoSyncStarted = true;

  const { syncActualHours, syncHoursWorked, syncPartsCost } = await import("@/lib/sync-powerbi");
  const { prisma } = await import("@/lib/prisma");
  const { isMonthLocked } = await import("@/lib/etc");

  // Every data source below is now direct — SharePoint (Paylocity hours) and
  // TotalETO (parts) — with no Power BI dataset in the loop. Quoted hours are
  // owned by the app (Projects tab) so they're no longer pulled; the pool
  // "New Hours Added" driver and the on-demand history/pool backfills remain
  // as separate admin tools.
  const runSync = async () => {
    try {
      const result = await syncActualHours();
      console.log(
        `[auto-sync] Actual hours (SharePoint): ${result.rowsUpserted} upserted, ${result.jobsNotFound} jobs not found, ${result.rowsSkippedOverridden} overridden preserved`
      );
    } catch (err) {
      console.error("[auto-sync] Actual hours sync failed:", err);
    }

    // Keep the current (latest, unlocked) ETC month live — the same pulls a
    // manual Run Report does: per-section Hours Worked (SharePoint) and the
    // Parts Cost block (TotalETO). A locked month is frozen history and is
    // never touched outside an admin reopen.
    try {
      const latest = await prisma.etcEntry.findFirst({ orderBy: { month: "desc" }, select: { month: true } });
      if (!latest) return;
      const entries = await prisma.etcEntry.findMany({ where: { month: latest.month }, select: { needsReview: true } });
      if (isMonthLocked(entries)) return;

      const result = await syncHoursWorked(latest.month);
      console.log(`[auto-sync] ETC hours worked (${latest.month}): ${result.rowsUpdated} updated, ${result.rowsSkipped} skipped`);

      const parts = await syncPartsCost(latest.month);
      console.log(`[auto-sync] Parts cost (${latest.month}): ${parts.rowsUpserted} upserted`);
    } catch (err) {
      console.error("[auto-sync] ETC current-month sync failed:", err);
    }
  };

  runSync();
  setInterval(runSync, SYNC_INTERVAL_MS);
}
