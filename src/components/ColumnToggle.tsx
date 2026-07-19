"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type ToggleColumn = { key: string; label: string };

// Generic show/hide dropdown for info columns on a grid. Drives a single
// `hide` query param (comma-separated column keys); absent = all shown, so
// default URLs stay clean and it's bookmark/share-able like the other
// filters. Same dropdown interaction as DeptColumnFilter/PhaseColumnPicker.
export function ColumnToggle({ columns, hidden }: { columns: ToggleColumn[]; hidden: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const hiddenSet = new Set(hidden);
  const allShown = hiddenSet.size === 0;

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (detailsRef.current?.open && !detailsRef.current.contains(e.target as Node)) detailsRef.current.open = false;
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  function toggle(key: string) {
    const next = new Set(hiddenSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    const qs = new URLSearchParams(searchParams.toString());
    if (next.size === 0) qs.delete("hide");
    else qs.set("hide", columns.filter((c) => next.has(c.key)).map((c) => c.key).join(","));
    const q = qs.toString();
    router.push(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }

  return (
    <details ref={detailsRef} className="group relative inline-block">
      <summary
        className={`flex list-none cursor-pointer select-none items-center gap-1.5 rounded-md border px-3.5 py-1.5 text-sm font-medium shadow-sm ${
          allShown ? "border-sdc-border bg-white text-sdc-navy hover:bg-sdc-blue-light" : "border-sdc-blue bg-sdc-blue-light text-sdc-blue-dark"
        }`}
      >
        Columns
        {!allShown && ` (${columns.length - hiddenSet.size}/${columns.length})`}
        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 opacity-70 transition-transform duration-150 group-open:rotate-180">
          <path d="M3.5 6 L8 10.5 L12.5 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="absolute left-0 top-full z-30 mt-2 w-52 rounded-lg border border-sdc-border bg-white p-2 shadow-lg">
        <p className="px-1.5 pb-1 text-[11px] text-sdc-gray-400">Show columns:</p>
        {columns.map((c) => (
          <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-sdc-gray-100">
            <input type="checkbox" checked={!hiddenSet.has(c.key)} onChange={() => toggle(c.key)} className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{c.label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
