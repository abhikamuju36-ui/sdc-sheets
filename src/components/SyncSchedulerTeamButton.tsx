"use client";

import { useState, useTransition } from "react";
import { syncSchedulerTeamAction } from "@/lib/employee-actions";
import type { TeamSyncResult } from "@/lib/sync-scheduler-team";
import { BUTTON_SECONDARY } from "@/components/ui/classnames";

// Pulls the team grouping from the SDC Scheduler and shows a report of what
// was updated and which names couldn't be matched (so they can be renamed to
// line up). The sync itself lives server-side; this just triggers it and
// renders the result.
export function SyncSchedulerTeamButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TeamSyncResult | null>(null);

  function run() {
    startTransition(async () => {
      setResult(await syncSchedulerTeamAction());
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={pending}
        title="Update each employee's group from the SDC Scheduler's team list (the source of truth for grouping)."
        className={BUTTON_SECONDARY}
      >
        {pending ? "Syncing…" : "Sync grouping from Scheduler"}
      </button>

      {result && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setResult(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-xl border border-sdc-border bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {!result.ok ? (
              <>
                <p className="mb-2 font-heading text-lg font-bold text-sdc-navy">Sync unavailable</p>
                <p className="text-sm text-sdc-gray-600">{result.reason}</p>
              </>
            ) : (
              <>
                <p className="mb-1 font-heading text-lg font-bold text-sdc-navy">Grouping synced from Scheduler</p>
                <p className="mb-4 text-sm text-sdc-gray-600">
                  <strong className="text-sdc-navy">{result.updated.length}</strong> updated ·{" "}
                  <strong className="text-sdc-navy">{result.unchanged}</strong> already matched
                </p>

                {result.updated.length > 0 && (
                  <div className="mb-4">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sdc-gray-400">Regrouped</p>
                    <ul className="space-y-0.5 text-sm">
                      {result.updated.map((u) => (
                        <li key={u.name} className="text-sdc-navy">
                          {u.name}: <span className="text-sdc-gray-500">{u.from ?? "—"}</span> → <span className="font-medium">{u.to}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.unmatchedEtc.length > 0 && (
                  <div className="mb-4">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#8A6D00]">
                      In ETC, not matched on the Scheduler ({result.unmatchedEtc.length})
                    </p>
                    <p className="mb-1 text-[11px] text-sdc-gray-500">
                      Rename these to match the Scheduler exactly (e.g. Michael → Mike) and re-run, or they simply aren&apos;t on the Scheduler roster.
                    </p>
                    <p className="text-sm text-sdc-gray-700">{result.unmatchedEtc.join(", ")}</p>
                  </div>
                )}

                {result.unmatchedScheduler.length > 0 && (
                  <div className="mb-4">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#8A6D00]">
                      On the Scheduler, not matched in ETC ({result.unmatchedScheduler.length})
                    </p>
                    <p className="text-sm text-sdc-gray-700">{result.unmatchedScheduler.join(", ")}</p>
                  </div>
                )}
              </>
            )}

            <div className="mt-2 flex justify-end">
              <button type="button" onClick={() => setResult(null)} className={BUTTON_SECONDARY}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
