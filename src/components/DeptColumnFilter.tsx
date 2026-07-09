"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Engineering / Shop column filter for the Monthly ETC grid. Toggles the
// `dept` query param (comma-separated billing groups); the server component
// hides the section-column blocks for any unselected group. Same dropdown
// interaction as PhaseColumnPicker/MultiSelectFilter, but scoped to /etc and
// preserving the current month. Selecting both (or none) drops the param so
// the default is the full grid — you can never hide every column.
const GROUPS = ["Engineering", "Shop"] as const;

export function DeptColumnFilter({ selected }: { selected: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const selectedSet = new Set(selected.length ? selected : GROUPS);
  const checkedCount = GROUPS.filter((g) => selectedSet.has(g)).length;
  const allChecked = checkedCount === GROUPS.length;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (detailsRef.current?.open && !detailsRef.current.contains(e.target as Node)) {
        detailsRef.current.open = false;
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  function navigate(next: Set<string>) {
    const qs = new URLSearchParams(searchParams.toString());
    // Both (or none) is the default full grid — keep the URL clean and never
    // let the grid collapse to zero section columns.
    if (next.size === 0 || next.size === GROUPS.length) qs.delete("dept");
    else qs.set("dept", GROUPS.filter((g) => next.has(g)).join(","));
    router.push(`/etc?${qs.toString()}`, { scroll: false });
  }

  function toggle(group: string) {
    const next = new Set(selectedSet);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    navigate(next);
  }

  return (
    <details ref={detailsRef} className="group relative inline-block">
      <summary
        className={`flex list-none cursor-pointer select-none items-center gap-1.5 rounded-md border px-3.5 py-1.5 text-sm font-medium shadow-sm ${
          allChecked
            ? "border-sdc-border bg-white text-sdc-navy hover:bg-sdc-blue-light"
            : "border-sdc-blue bg-sdc-blue-light text-sdc-blue-dark"
        }`}
      >
        Columns
        {!allChecked && ` (${checkedCount}/${GROUPS.length})`}
        <svg
          viewBox="0 0 16 16"
          width="10"
          height="10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="shrink-0 opacity-70 transition-transform duration-150 group-open:rotate-180"
        >
          <path d="M3.5 6 L8 10.5 L12.5 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="absolute left-0 top-full z-30 mt-2 w-48 rounded-lg border border-sdc-border bg-white p-2 shadow-lg">
        <p className="px-1.5 pb-1 text-[11px] text-sdc-gray-400">Show section columns for:</p>
        {GROUPS.map((g) => (
          <label key={g} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-sdc-gray-100">
            <input type="checkbox" checked={selectedSet.has(g)} onChange={() => toggle(g)} className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{g}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
