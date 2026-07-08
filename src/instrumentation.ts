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

  const { syncActualHoursFromPowerBi } = await import("@/lib/sync-powerbi");

  const runSync = async () => {
    try {
      const result = await syncActualHoursFromPowerBi();
      console.log(
        `[auto-sync] Power BI actual hours: ${result.rowsUpserted} rows upserted, ${result.jobsNotFound} jobs not found, ${result.rowsSkippedOverridden} overridden rows preserved`
      );
    } catch (err) {
      console.error("[auto-sync] Power BI actual hours sync failed:", err);
    }
  };

  runSync();
  setInterval(runSync, SYNC_INTERVAL_MS);
}
