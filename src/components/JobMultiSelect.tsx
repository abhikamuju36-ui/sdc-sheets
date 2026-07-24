"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { INPUT } from "@/components/ui/classnames";

// Searchable multi-select for the Job Hour Details job slicer. Keyed by Job Id
// (numeric, comma-safe), so selecting multiple jobs aggregates the dashboard —
// mirroring the Power BI job slicer. Writes ?jobs=<jobId,jobId,…>.
type JobOpt = { id: number; jobId: string; jobName: string };

export function JobMultiSelect({ jobs, selected }: { jobs: JobOpt[]; selected: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (detailsRef.current?.open && !detailsRef.current.contains(e.target as Node)) detailsRef.current.open = false;
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) => j.jobId.includes(q) || j.jobName.toLowerCase().includes(q));
  }, [jobs, query]);

  function navigate(next: Set<string>) {
    const qs = new URLSearchParams(searchParams.toString());
    if (next.size === 0) qs.delete("jobs");
    else qs.set("jobs", [...next].join(","));
    qs.delete("job"); // drop the legacy single-job param
    router.push(`${pathname}?${qs.toString()}`);
  }

  function toggle(jobId: string) {
    const next = new Set(selectedSet);
    if (next.has(jobId)) next.delete(jobId);
    else next.add(jobId);
    navigate(next);
  }

  const summary =
    selected.length === 0
      ? "Select jobs…"
      : selected.length === 1
        ? (() => { const j = jobs.find((x) => x.jobId === selected[0]); return j ? `${j.jobId} — ${j.jobName}` : selected[0]; })()
        : `${selected.length} jobs selected`;

  return (
    <details ref={detailsRef} className="group relative inline-block">
      <summary className="flex w-72 cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-sdc-border bg-white px-3 py-2 text-sm font-medium text-sdc-navy shadow-sm hover:bg-sdc-blue-light">
        <span className="truncate">{summary}</span>
        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 opacity-70 transition-transform duration-150 group-open:rotate-180">
          <path d="M3.5 6 L8 10.5 L12.5 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="absolute right-0 top-full z-40 mt-2 w-80 rounded-lg border border-sdc-border bg-white p-2 shadow-lg">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search job # or name…"
          className={`${INPUT} mb-2 w-full`}
          autoFocus
        />
        <div className="mb-1 flex items-center justify-between px-1 text-[11px] text-sdc-gray-400">
          <span>{selected.length} selected</span>
          {selected.length > 0 && (
            <button type="button" onClick={() => navigate(new Set())} className="hover:text-sdc-navy">Clear all</button>
          )}
        </div>
        {selected.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1 border-b border-sdc-border-soft pb-2">
            {selected.map((jobId) => {
              const j = jobs.find((x) => x.jobId === jobId);
              const label = j ? `${j.jobId} — ${j.jobName}` : jobId;
              return (
                <span key={jobId} className="inline-flex max-w-full items-center gap-1 rounded-full bg-sdc-blue-light px-2 py-0.5 text-[11px] font-medium text-sdc-blue-dark">
                  <span className="truncate">{label}</span>
                  <button
                    type="button"
                    onClick={() => toggle(jobId)}
                    aria-label={`Remove ${label}`}
                    className="shrink-0 rounded-full leading-none text-sdc-blue-dark/70 hover:bg-sdc-blue/20 hover:text-sdc-blue-dark"
                  >
                    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                    </svg>
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <div className="max-h-80 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-sdc-gray-400">No jobs match.</p>
          ) : (
            filtered.map((j) => (
              <label key={j.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-sdc-gray-100">
                <input type="checkbox" checked={selectedSet.has(j.jobId)} onChange={() => toggle(j.jobId)} className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate"><span className="font-mono text-sdc-gray-500">{j.jobId}</span> — {j.jobName}</span>
              </label>
            ))
          )}
        </div>
      </div>
    </details>
  );
}
