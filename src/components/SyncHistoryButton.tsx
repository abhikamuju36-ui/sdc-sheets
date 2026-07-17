"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { syncEtcHistory, type SyncHistoryResult } from "@/lib/etc-actions";

const INITIAL_STATE: SyncHistoryResult = { monthsRefreshed: 0, reconciledMonths: [], entriesReconciled: 0, poolEntriesReconciled: 0 };

// Sync History used to only report reconciliation in the audit log — an
// admin had to go looking for it. useActionState surfaces the same result
// returned by syncEtcHistory as a toast right here instead, same
// true->false pending transition trick as RunReportButton (server actions
// have no other "it finished" signal once the page revalidates).
export function SyncHistoryButton({ className }: { className?: string }) {
  const [state, formAction, pending] = useActionState(syncEtcHistory, INITIAL_STATE);
  const wasPending = useRef(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (wasPending.current && !pending) {
      const fieldsReconciled = state.entriesReconciled + state.poolEntriesReconciled;
      const message =
        state.reconciledMonths.length > 0
          ? `Sync complete — reconciled ${fieldsReconciled} display field(s) for ${state.reconciledMonths.join(", ")} (submitted decisions/dollars unchanged).`
          : `Sync complete — ${state.monthsRefreshed} historical month(s) refreshed from Power BI.`;
      setToast(message);
      const timer = setTimeout(() => setToast(null), 7000);
      return () => clearTimeout(timer);
    }
    wasPending.current = pending;
  }, [pending, state]);

  return (
    <form action={formAction}>
      <button
        type="submit"
        className={className}
        disabled={pending}
        title="Re-pull all past months from Power BI's ETC Historical measures. Months submitted in this app are never overwritten — only their display-only fields (Hours Worked/Prior ETC) self-heal if Power BI's archive changes after the fact."
      >
        {pending ? "Syncing…" : "Sync History"}
      </button>
      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex max-w-md items-center gap-2 rounded-lg bg-sdc-navy px-4 py-3 text-sm font-medium text-white shadow-lg"
        >
          <span className="text-sdc-lime">✓</span> {toast}
        </div>
      )}
    </form>
  );
}
