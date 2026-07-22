"use client";

import { useEffect, useRef } from "react";

// Density controls for a data grid — "Row height" scales every body cell's
// vertical padding, "Column width" scales the grid's repeated data columns'
// horizontal padding (frozen/sticky columns and one-off metadata columns keep
// their own fixed widths — each page's own `:not(sticky)`/marker-class guard
// on its table decides exactly which cells listen). Shared by the Monthly ETC
// grid and the Projects grid, each with its own CSS var names/localStorage
// keys so their densities are independent.
//
// Both are plain CSS custom properties set on the document root, so they
// survive a grid's own remounts (e.g. ETC's key={month}) without any extra
// wiring — a freshly mounted table just inherits whatever's already on
// :root. No React state involved (same pattern as ColumnResize.tsx) — the
// CSS variable itself is the only source of truth, read straight off the DOM
// on every click, so there's nothing to fall out of sync. Persisted to
// localStorage so a chosen density survives a reload.
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

function step(cssVar: string, storageKey: string, defaultPx: number, delta: number) {
  const next = clamp(currentValue(cssVar, defaultPx) + delta);
  document.documentElement.style.setProperty(cssVar, `${next}px`);
  window.localStorage.setItem(storageKey, String(next));
}

export function GridZoomControls({
  rowVar,
  colVar,
  rowStorageKey,
  colStorageKey,
  defaultRowPx,
  defaultColPx,
}: {
  rowVar: string;
  colVar: string;
  rowStorageKey: string;
  colStorageKey: string;
  defaultRowPx: number;
  defaultColPx: number;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const savedRow = window.localStorage.getItem(rowStorageKey);
    const savedCol = window.localStorage.getItem(colStorageKey);
    if (savedRow != null) document.documentElement.style.setProperty(rowVar, `${clamp(Number(savedRow))}px`);
    if (savedCol != null) document.documentElement.style.setProperty(colVar, `${clamp(Number(savedCol))}px`);
    // Keys/vars are static per page — only the mount-time restore needs to run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Same details/summary dropdown pattern as ColumnToggle/DeptColumnFilter —
  // click-outside closes it, no JS library needed.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (detailsRef.current?.open && !detailsRef.current.contains(e.target as Node)) detailsRef.current.open = false;
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <details ref={detailsRef} className="group relative inline-block text-xs text-sdc-gray-500">
      <summary className="flex list-none cursor-pointer select-none items-center gap-1.5 rounded-md border border-sdc-border bg-white px-3.5 py-1.5 text-sm font-medium text-sdc-navy shadow-sm hover:bg-sdc-blue-light">
        Grid Size
        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 opacity-70 transition-transform duration-150 group-open:rotate-180">
          <path d="M3.5 6 L8 10.5 L12.5 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="absolute left-0 top-full z-30 mt-2 flex w-max flex-col gap-2 rounded-lg border border-sdc-border bg-white p-2.5 shadow-lg">
        <ZoomStepper
          label="Row height"
          onDecrease={() => step(rowVar, rowStorageKey, defaultRowPx, -STEP_PX)}
          onIncrease={() => step(rowVar, rowStorageKey, defaultRowPx, STEP_PX)}
        />
        <ZoomStepper
          label="Column width"
          onDecrease={() => step(colVar, colStorageKey, defaultColPx, -STEP_PX)}
          onIncrease={() => step(colVar, colStorageKey, defaultColPx, STEP_PX)}
        />
      </div>
    </details>
  );
}

function ZoomStepper({ label, onDecrease, onIncrease }: { label: string; onDecrease: () => void; onIncrease: () => void }) {
  const btn =
    "flex h-6 w-6 items-center justify-center rounded border border-sdc-border bg-white font-semibold leading-none text-sdc-navy hover:bg-sdc-blue-light";
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onDecrease} className={btn} aria-label={`Decrease ${label.toLowerCase()}`} title={`Decrease ${label.toLowerCase()}`}>
          −
        </button>
        <button type="button" onClick={onIncrease} className={btn} aria-label={`Increase ${label.toLowerCase()}`} title={`Increase ${label.toLowerCase()}`}>
          +
        </button>
      </div>
    </div>
  );
}
