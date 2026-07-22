"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Consolidated "Sync" dropdown for the Monthly ETC toolbar — merges the two
// upstream data-pull actions (Refresh Data + Sync History) that were separate
// buttons. It's a thin wrapper: the caller passes the already-formed action
// controls as children (a <form> with RunReportButton for Refresh, and the
// SyncHistoryButton), so all of their existing gating, pending state, and
// toasts are preserved untouched — this only groups them under one menu.
// Renders nothing if there are no children to show (e.g. locked month for a
// non-admin), so the toolbar doesn't carry an empty dropdown.
export function EtcSyncMenu({ children }: { children: ReactNode }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (detailsRef.current?.open && !detailsRef.current.contains(e.target as Node)) detailsRef.current.open = false;
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <details ref={detailsRef} className="group relative inline-block">
      <summary className="flex list-none cursor-pointer select-none items-center gap-1.5 rounded-lg bg-sdc-blue px-5 py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(21,116,196,0.25),0_4px_10px_rgba(21,116,196,0.18)] transition-all hover:bg-sdc-blue-dark">
        Sync Data
        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 opacity-80 transition-transform duration-150 group-open:rotate-180">
          <path d="M3.5 6 L8 10.5 L12.5 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="absolute left-0 top-full z-30 mt-2 flex w-max min-w-[200px] flex-col gap-2 rounded-lg border border-sdc-border bg-white p-2.5 shadow-lg">
        {children}
      </div>
    </details>
  );
}
