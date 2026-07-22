"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

// Generic multi-select dropdown filter, same interaction pattern as
// PhaseColumnPicker (checkboxes, Select all/Clear, closes on outside click)
// but drives row filtering via a query param instead of column visibility.
export function MultiSelectFilter({
  label,
  paramName,
  options,
  selected,
}: {
  label: string;
  paramName: string;
  options: string[];
  selected: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const selectedSet = new Set(selected);
  const checkedCount = options.filter((o) => selectedSet.has(o)).length;
  const allChecked = checkedCount === options.length;
  const noneChecked = checkedCount === 0;

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
    qs.set(paramName, Array.from(next).join(","));
    router.push(`${pathname}?${qs.toString()}`, { scroll: false });
  }

  function toggle(value: string) {
    const next = new Set(selectedSet);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    navigate(next);
  }

  function setAll(checked: boolean) {
    navigate(new Set(checked ? options : []));
  }

  return (
    <details ref={detailsRef} className="group relative inline-block">
      <summary
        className={`flex list-none cursor-pointer select-none items-center gap-1.5 rounded-full px-3.5 py-[7px] text-[12.5px] font-semibold ${
          noneChecked ? "bg-sdc-gray-100 text-sdc-gray-600 hover:bg-sdc-gray-100/70" : "bg-sdc-blue-light text-sdc-blue hover:bg-sdc-blue-100/40"
        }`}
      >
        {label}
        {!allChecked && ` (${checkedCount}/${options.length})`}
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
      <div className="styled-scrollbar absolute left-0 top-full z-30 mt-2 max-h-72 w-56 overflow-y-auto rounded-lg border border-sdc-border bg-white p-2 shadow-lg">
        <div className="mb-1 flex items-center justify-between px-1.5 pb-1 text-[11px] text-sdc-gray-400">
          <button type="button" onClick={() => setAll(true)} className="underline hover:text-sdc-navy">
            Select all
          </button>
          <button type="button" onClick={() => setAll(false)} className="underline hover:text-sdc-navy">
            Clear
          </button>
        </div>
        {options.map((opt) => (
          <label key={opt} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-sdc-gray-100">
            <input
              type="checkbox"
              checked={selectedSet.has(opt)}
              onChange={() => toggle(opt)}
              className="h-3.5 w-3.5 shrink-0"
            />
            <span className="flex-1 truncate">{opt}</span>
          </label>
        ))}
        {options.length === 0 && <p className="px-1.5 py-1 text-xs text-sdc-gray-400">No options</p>}
      </div>
    </details>
  );
}
