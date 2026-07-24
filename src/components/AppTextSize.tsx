"use client";

import { useEffect, useState } from "react";

// App-wide text size. Sets the root <html> font-size in px; because Tailwind's
// type + spacing scale is rem-based, this scales the whole UI proportionally
// (headers and body stay in proportion). Persisted to localStorage and restored
// before paint by the inline script in the root layout (no flash on reload).
const KEY = "app-font-px";
const MIN = 12;
const MAX = 20;
const DEFAULT = 15; // slightly compact but readable
const STEP = 1;

function clamp(n: number): number {
  return Math.min(MAX, Math.max(MIN, Number.isFinite(n) ? n : DEFAULT));
}

export function AppTextSize({ collapsed }: { collapsed?: boolean }) {
  const [px, setPx] = useState(DEFAULT);

  useEffect(() => {
    const saved = window.localStorage.getItem(KEY);
    const v = clamp(saved != null ? parseFloat(saved) : DEFAULT);
    setPx(v);
    document.documentElement.style.fontSize = `${v}px`;
    if (saved == null) window.localStorage.setItem(KEY, String(v));
  }, []);

  const apply = (v: number) => {
    const c = clamp(v);
    setPx(c);
    document.documentElement.style.fontSize = `${c}px`;
    window.localStorage.setItem(KEY, String(c));
  };

  const btn = "flex h-5 w-5 items-center justify-center rounded border border-white/20 font-semibold leading-none text-sdc-blue-100 hover:bg-white/10 disabled:opacity-30";

  if (collapsed) return null;

  return (
    <div className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-2.5 text-xs font-medium text-sdc-blue-100/70">
      <span>Text size</span>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => apply(px - STEP)} disabled={px <= MIN} className={btn} aria-label="Decrease text size">−</button>
        <span className="w-5 text-center tabular-nums text-sdc-blue-100">{px}</span>
        <button type="button" onClick={() => apply(px + STEP)} disabled={px >= MAX} className={btn} aria-label="Increase text size">+</button>
      </div>
    </div>
  );
}
