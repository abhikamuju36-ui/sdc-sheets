"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Dropdown of checkboxes for one phase's section columns. Clicking a checkbox
// updates the `cols` query param immediately (no Apply button) — the picker
// stays open across changes since it's the same client component instance
// being re-rendered, not remounted, on each navigation.
export function PhaseColumnPicker({
  phase,
  sections,
  visibleCodes,
}: {
  phase: string;
  sections: { code: string; name: string }[];
  visibleCodes: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const visibleSet = new Set(visibleCodes);
  const phaseCodes = sections.map((s) => s.code);
  const checkedCount = phaseCodes.filter((c) => visibleSet.has(c)).length;
  const allChecked = checkedCount === phaseCodes.length;
  const noneChecked = checkedCount === 0;

  // Native <details> only closes on a second click of its own <summary> —
  // add click-outside-to-close so it behaves like a normal dropdown menu.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (detailsRef.current?.open && !detailsRef.current.contains(e.target as Node)) {
        detailsRef.current.open = false;
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  function navigate(nextVisible: Set<string>) {
    // Preserve other params (e.g. sort/dir) — only `cols` changes here.
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("cols", Array.from(nextVisible).join(","));
    router.push(`/quoted?${qs.toString()}`, { scroll: false });
  }

  function toggle(code: string) {
    const next = new Set(visibleSet);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    navigate(next);
  }

  function setAll(checked: boolean) {
    const next = new Set(visibleSet);
    for (const code of phaseCodes) {
      if (checked) next.add(code);
      else next.delete(code);
    }
    navigate(next);
  }

  return (
    <details ref={detailsRef} className="group relative inline-block">
      <summary
        className={`flex list-none cursor-pointer select-none items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium ${
          noneChecked
            ? "border-sdc-border bg-white text-sdc-gray-700 hover:bg-sdc-gray-100"
            : "border-sdc-blue bg-sdc-blue-light text-sdc-blue-dark"
        }`}
      >
        {phase}
        {!allChecked && ` (${checkedCount}/${phaseCodes.length})`}
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
      <div className="absolute left-0 top-full z-20 mt-2 w-56 rounded-lg border border-sdc-border bg-white p-2 shadow-lg">
        <div className="mb-1 flex items-center justify-between px-1.5 pb-1 text-[11px] text-sdc-gray-400">
          <button type="button" onClick={() => setAll(true)} className="underline hover:text-sdc-navy">
            Select all
          </button>
          <button type="button" onClick={() => setAll(false)} className="underline hover:text-sdc-navy">
            Clear
          </button>
        </div>
        {sections.map((s) => (
          <label
            key={s.code}
            className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-sdc-gray-100"
          >
            <input
              type="checkbox"
              checked={visibleSet.has(s.code)}
              onChange={() => toggle(s.code)}
              className="h-3.5 w-3.5 shrink-0"
            />
            <span className="flex-1 truncate">{s.name}</span>
            <span className="shrink-0 font-mono text-[10px] text-sdc-gray-400">{s.code}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
