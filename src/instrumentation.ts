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

  const { syncActualHoursFromPowerBi, syncHoursWorkedFromPowerBi, syncPartsCostFromPowerBi, syncCategoryPoolsFromPowerBi, syncQuotedFromPowerBi } =
    await import("@/lib/sync-powerbi");
  const { prisma } = await import("@/lib/prisma");
  const { isMonthLocked } = await import("@/lib/etc");

  // Quoted hours change far less often than actuals — refresh them hourly
  // rather than every cycle (each run queries every job's quoted matrix).
  let cyclesSinceQuotedSync = Number.MAX_SAFE_INTEGER; // first cycle always syncs

  const runSync = async () => {
    try {
      const result = await syncActualHoursFromPowerBi();
      console.log(
        `[auto-sync] Power BI actual hours: ${result.rowsUpserted} rows upserted, ${result.jobsNotFound} jobs not found, ${result.rowsSkippedOverridden} overridden rows preserved`
      );
    } catch (err) {
      console.error("[auto-sync] Power BI actual hours sync failed:", err);
    }

    // Keep the current (latest, unlocked) ETC month fully live — the same
    // pulls a manual Run Report does, on the auto cadence: per-section Hours
    // Worked, the Parts Cost block, and the Standard Fees pools. A locked
    // month is frozen history and is never touched outside an admin reopen.
    try {
      const latest = await prisma.etcEntry.findFirst({ orderBy: { month: "desc" }, select: { month: true } });
      if (!latest) return;
      const entries = await prisma.etcEntry.findMany({ where: { month: latest.month }, select: { needsReview: true } });
      if (isMonthLocked(entries)) return;

      const result = await syncHoursWorkedFromPowerBi(latest.month);
      console.log(`[auto-sync] ETC hours worked (${latest.month}): ${result.rowsUpdated} rows updated, ${result.rowsSkipped} skipped`);

      const parts = await syncPartsCostFromPowerBi(latest.month);
      console.log(`[auto-sync] Parts cost (${latest.month}): ${parts.rowsUpserted} rows upserted`);

      // Pools: only while the month's standard sheet is still open (no
      // snapshot) and not a PBI-archive backfill — the same guards the
      // manual Refresh Pools action enforces. A no-op until Power BI's
      // period for the month exists; it self-populates the moment it does.
      const [snapshot, historicalPool] = await Promise.all([
        prisma.standardSheetSnapshot.findFirst({ where: { month: latest.month }, select: { id: true } }),
        prisma.categoryPool.findFirst({ where: { month: latest.month, source: "power_bi_history" }, select: { id: true } }),
      ]);
      if (!snapshot && !historicalPool) {
        const pools = await syncCategoryPoolsFromPowerBi(latest.month);
        console.log(`[auto-sync] Category pools (${latest.month}): ${pools.poolsUpserted} upserted`);
      }
    } catch (err) {
      console.error("[auto-sync] ETC current-month sync failed:", err);
    }

    // Quoted hours + estimate-to-complete (Projects grid), hourly.
    try {
      cyclesSinceQuotedSync++;
      if (cyclesSinceQuotedSync >= 6) {
        const quoted = await syncQuotedFromPowerBi();
        console.log(`[auto-sync] Quoted hours: ${JSON.stringify(quoted)}`);
        cyclesSinceQuotedSync = 0;
      }
    } catch (err) {
      console.error("[auto-sync] Quoted hours sync failed:", err);
    }
  };

  runSync();
  setInterval(runSync, SYNC_INTERVAL_MS);
}
