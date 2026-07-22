"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

// Consolidated "View" dropdown for the Monthly ETC toolbar — merges what used
// to be three separate buttons (Columns, Billable, Grid Size) into one menu:
//   • Section columns  -> `dept` param (Engineering/Shop)
//   • Job Name column  -> `jobname` param ("0" = hidden)
//   • Billable rows    -> `billables` param (Billable/Non-Billable)
//   • Density          -> --etc-row-py / --etc-col-px CSS vars (localStorage)
// URL-param logic mirrors DeptColumnFilter/MultiSelectFilter; the density
// steppers mirror GridZoomControls (CSS custom properties on :root, persisted
// to localStorage, no React state so they survive the grid's key={month}
// remounts). Kept ETC-only; the Projects tab still uses the standalone pieces.
const GROUPS = ["Engineering", "Shop"] as const;
const BILLABLE = ["Billable", "Non-Billable"] as const;

const ROW_VAR = "--etc-row-py";
const COL_VAR = "--etc-col-px";
const ROW_KEY = "etc-grid-row-py";
const COL_KEY = "etc-grid-col-px";
const DEFAULT_ROW_PX = 4;
const DEFAULT_COL_PX = 4;
const MIN_PX = 0;
const MAX_PX = 16;
const STEP_PX = 2;

function clamp(n: number): number {
  return Math.min(MAX_PX, Math.max(MIN_PX, n));
}
function currentValue(cssVar: string, defaultPx: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  const n = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(n) ? n : defaultPx;
}
function stepDensity(cssVar: string, storageKey: string, defaultPx: number, delta: number) {
  const next = clamp(currentValue(cssVar, defaultPx) + delta);
  document.documentElement.style.setProperty(cssVar, `${next}px`);
  window.localStorage.setItem(storageKey, String(next));
}

export function EtcViewMenu({
  selectedGroups,
  showJobName,
  selectedBillables,
}: {
  selectedGroups: string[];
  showJobName: boolean;
  selectedBillables: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const groupSet = new Set(selectedGroups.length ? selectedGroups : GROUPS);
  const billableSet = new Set(selectedBillables);
  const groupsFiltered = GROUPS.some((g) => !groupSet.has(g));
  const billableFiltered = BILLABLE.some((b) => !billableSet.has(b));
  const anyFilterActive = groupsFiltered || billableFiltered || !showJobName;

  // Restore saved density once on mount (same as GridZoomControls).
  useEffect(() => {
    const savedRow = window.localStorage.getItem(ROW_KEY);
    const savedCol = window.localStorage.getItem(COL_KEY);
    if (savedRow != null) document.documentElement.style.setProperty(ROW_VAR, `${clamp(Number(savedRow))}px`);
    if (savedCol != null) document.documentElement.style.setProperty(COL_VAR, `${clamp(Number(savedCol))}px`);
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (detailsRef.current?.open && !detailsRef.current.contains(e.target as Node)) detailsRef.current.open = false;
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  function push(qs: URLSearchParams) {
    router.push(`${pathname}?${qs.toString()}`, { scroll: false });
  }

  function toggleGroup(group: string) {
    const next = new Set(groupSet);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    const qs = new URLSearchParams(searchParams.toString());
    // Both (or none) selected is the default full grid — never collapse to zero.
    if (next.size === 0 || next.size === GROUPS.length) qs.delete("dept");
    else qs.set("dept", GROUPS.filter((g) => next.has(g)).join(","));
    push(qs);
  }

  function toggleJobName() {
    const qs = new URLSearchParams(searchParams.toString());
    if (showJobName) qs.set("jobname", "0");
    else qs.delete("jobname");
    push(qs);
  }

  function toggleBillable(value: string) {
    const next = new Set(billableSet);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("billables", Array.from(next).join(","));
    push(qs);
  }

  return (
    <details ref={detailsRef} className="group relative inline-block">
      <summary
        className={`flex list-none cursor-pointer select-none items-center gap-1.5 rounded-md border px-3.5 py-1.5 text-sm font-medium shadow-sm ${
          anyFilterActive ? "border-sdc-blue bg-sdc-blue-light text-sdc-blue-dark" : "border-sdc-border bg-white text-sdc-navy hover:bg-sdc-blue-light"
        }`}
      >
        View
        {anyFilterActive && " (filtered)"}
        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 opacity-70 transition-transform duration-150 group-open:rotate-180">
          <path d="M3.5 6 L8 10.5 L12.5 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="absolute left-0 top-full z-30 mt-2 w-56 rounded-lg border border-sdc-border bg-white p-2 shadow-lg">
        <p className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-sdc-gray-400">Section columns</p>
        {GROUPS.map((g) => (
          <label key={g} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-sdc-gray-100">
            <input type="checkbox" checked={groupSet.has(g)} onChange={() => toggleGroup(g)} className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{g}</span>
          </label>
        ))}
        <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-sdc-gray-100">
          <input type="checkbox" checked={showJobName} onChange={toggleJobName} className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">Job Name column</span>
        </label>

        <p className="mt-1 border-t border-sdc-border px-1.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-sdc-gray-400">Rows</p>
        {BILLABLE.map((b) => (
          <label key={b} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-sdc-gray-100">
            <input type="checkbox" checked={billableSet.has(b)} onChange={() => toggleBillable(b)} className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{b}</span>
          </label>
        ))}

        <p className="mt-1 border-t border-sdc-border px-1.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-sdc-gray-400">Density</p>
        <DensityStepper label="Row height" onDecrease={() => stepDensity(ROW_VAR, ROW_KEY, DEFAULT_ROW_PX, -STEP_PX)} onIncrease={() => stepDensity(ROW_VAR, ROW_KEY, DEFAULT_ROW_PX, STEP_PX)} />
        <DensityStepper label="Column width" onDecrease={() => stepDensity(COL_VAR, COL_KEY, DEFAULT_COL_PX, -STEP_PX)} onIncrease={() => stepDensity(COL_VAR, COL_KEY, DEFAULT_COL_PX, STEP_PX)} />
      </div>
    </details>
  );
}

function DensityStepper({ label, onDecrease, onIncrease }: { label: string; onDecrease: () => void; onIncrease: () => void }) {
  const btn = "flex h-6 w-6 items-center justify-center rounded border border-sdc-border bg-white font-semibold leading-none text-sdc-navy hover:bg-sdc-blue-light";
  return (
    <div className="flex items-center justify-between gap-3 px-1.5 py-1 text-sm">
      <span>{label}</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onDecrease} className={btn} aria-label={`Decrease ${label.toLowerCase()}`}>−</button>
        <button type="button" onClick={onIncrease} className={btn} aria-label={`Increase ${label.toLowerCase()}`}>+</button>
      </div>
    </div>
  );
}
