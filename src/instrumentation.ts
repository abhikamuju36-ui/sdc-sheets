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

  const { syncActualHoursFromPowerBi, syncHoursWorkedFromPowerBi } = await import("@/lib/sync-powerbi");
  const { prisma } = await import("@/lib/prisma");
  const { isMonthLocked } = await import("@/lib/etc");

  const runSync = async () => {
    try {
      const result = await syncActualHoursFromPowerBi();
      console.log(
        `[auto-sync] Power BI actual hours: ${result.rowsUpserted} rows upserted, ${result.jobsNotFound} jobs not found, ${result.rowsSkippedOverridden} overridden rows preserved`
      );
    } catch (err) {
      console.error("[auto-sync] Power BI actual hours sync failed:", err);
    }

    // Keeps the Monthly ETC grid's per-section "Hours Worked Month" column
    // live without waiting for a manual Run Report click — same PBI measure
    // Run Report already pulls, just on the same 10-minute cadence as the
    // job-level sync above. Scoped to the single latest month and skipped
    // entirely once it's locked (submitted) — a locked month is frozen
    // history and must never be touched outside an explicit admin reopen.
    try {
      const latest = await prisma.etcEntry.findFirst({ orderBy: { month: "desc" }, select: { month: true } });
      if (!latest) return;
      const entries = await prisma.etcEntry.findMany({ where: { month: latest.month }, select: { needsReview: true } });
      if (isMonthLocked(entries)) return;

      const result = await syncHoursWorkedFromPowerBi(latest.month);
      console.log(`[auto-sync] ETC hours worked (${latest.month}): ${result.rowsUpdated} rows updated, ${result.rowsSkipped} skipped`);
    } catch (err) {
      console.error("[auto-sync] ETC hours worked sync failed:", err);
    }
  };

  runSync();
  setInterval(runSync, SYNC_INTERVAL_MS);
}
