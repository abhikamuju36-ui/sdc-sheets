"use client";

import { useEffect, useRef, useState } from "react";
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
const FONT_VAR = "--etc-font-size";
const ROW_KEY = "etc-grid-row-py";
const COL_KEY = "etc-grid-col-px";
const FONT_KEY = "etc-grid-font-size";
const DEFAULT_ROW_PX = 4;
const DEFAULT_COL_PX = 4;
const DEFAULT_FONT_PX = 10;
const MIN_PX = 0;
const MAX_PX = 16;
const STEP_PX = 2;
// Text size bounds — 10px is the grid's original hardcoded text-[10px].
const MIN_FONT_PX = 4;
const MAX_FONT_PX = 24;
const STEP_FONT_PX = 1;

function clamp(n: number): number {
  return Math.min(MAX_PX, Math.max(MIN_PX, n));
}
function clampFont(n: number): number {
  return Math.min(MAX_FONT_PX, Math.max(MIN_FONT_PX, n));
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
// Set both the CSS var and its localStorage key in one shot.
function persistVar(cssVar: string, storageKey: string, px: number) {
  document.documentElement.style.setProperty(cssVar, `${px}px`);
  window.localStorage.setItem(storageKey, String(px));
}
// Font-size derived row/column padding, so the cell box grows to fit the text
// instead of clipping it. At the 10px default this yields the grid's original
// 4px padding; it scales ~1:1 above that and floors at the gridlines below.
function paddingForFont(fontPx: number): number {
  return clamp(fontPx - 6);
}
// Text size is the master control: it sets the font AND re-derives row height /
// column width from it (the density steppers below then fine-tune on top).
function setFont(px: number) {
  const nextFont = clampFont(px);
  const pad = paddingForFont(nextFont);
  persistVar(FONT_VAR, FONT_KEY, nextFont);
  persistVar(ROW_VAR, ROW_KEY, pad);
  persistVar(COL_VAR, COL_KEY, pad);
  return nextFont;
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

  // Restore saved text size + density once on mount (same as GridZoomControls).
  useEffect(() => {
    const savedFont = window.localStorage.getItem(FONT_KEY);
    const savedRow = window.localStorage.getItem(ROW_KEY);
    const savedCol = window.localStorage.getItem(COL_KEY);
    if (savedFont != null) document.documentElement.style.setProperty(FONT_VAR, `${clampFont(Number(savedFont))}px`);
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

  // Uncontrolled native <details>: the browser adds/removes `open` on the DOM
  // element as the user toggles it. If React hydrates while it's already open,
  // its VDOM (no `open`) mismatches the DOM (`open=""`) — a benign dev warning.
  // suppressHydrationWarning silences just that attribute check.
  return (
    <details ref={detailsRef} suppressHydrationWarning className="group relative inline-block">
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

        <p className="mt-1 border-t border-sdc-border px-1.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-sdc-gray-400">Text size</p>
        <FontSizeInput />

        <p className="mt-1 border-t border-sdc-border px-1.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-sdc-gray-400">Density</p>
        <DensityStepper label="Row height" onDecrease={() => stepDensity(ROW_VAR, ROW_KEY, DEFAULT_ROW_PX, -STEP_PX)} onIncrease={() => stepDensity(ROW_VAR, ROW_KEY, DEFAULT_ROW_PX, STEP_PX)} />
        <DensityStepper label="Column width" onDecrease={() => stepDensity(COL_VAR, COL_KEY, DEFAULT_COL_PX, -STEP_PX)} onIncrease={() => stepDensity(COL_VAR, COL_KEY, DEFAULT_COL_PX, STEP_PX)} />
      </div>
    </details>
  );
}

// Word-style numeric font-size box: type a value (or use the step arrows) to
// set the grid text size directly. Local state seeds from the persisted CSS var
// on mount; commit on Enter/blur so a half-typed number never applies mid-keystroke.
function FontSizeInput() {
  const [value, setValue] = useState<string>(String(DEFAULT_FONT_PX));

  useEffect(() => {
    setValue(String(currentValue(FONT_VAR, DEFAULT_FONT_PX)));
  }, []);

  function commit(raw: string) {
    const n = Number(raw);
    const applied = setFont(Number.isFinite(n) ? n : DEFAULT_FONT_PX);
    setValue(String(applied));
  }

  return (
    <div className="flex items-center justify-between gap-3 px-1.5 py-1 text-sm">
      <span>Font size</span>
      <input
        type="number"
        min={MIN_FONT_PX}
        max={MAX_FONT_PX}
        step={STEP_FONT_PX}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label="Grid font size in pixels"
        title={`Grid text size (${MIN_FONT_PX}–${MAX_FONT_PX} px)`}
        className="w-16 rounded border border-sdc-border bg-white px-2 py-1 text-center text-sm text-sdc-navy outline-none focus:border-sdc-blue"
      />
    </div>
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
