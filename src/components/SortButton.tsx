"use client";

import { useRouter, useSearchParams } from "next/navigation";

// Clicking toggles asc/desc if already sorting by this key, otherwise
// switches to this key ascending. Preserves other params (e.g. `cols`).
export function SortButton({
  sortKey,
  label,
  currentSort,
  currentDir,
}: {
  sortKey: string;
  label: string;
  currentSort: string;
  currentDir: "asc" | "desc";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = currentSort === sortKey;

  function handleClick() {
    const nextDir = active && currentDir === "asc" ? "desc" : "asc";
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("sort", sortKey);
    qs.set("dir", nextDir);
    router.push(`/quoted?${qs.toString()}`, { scroll: false });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center gap-1 hover:text-sdc-navy ${active ? "text-sdc-navy" : ""}`}
    >
      {label}
      <svg
        viewBox="0 0 16 16"
        width="9"
        height="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className={`shrink-0 transition-transform duration-150 ${active ? "opacity-100" : "opacity-30"} ${
          active && currentDir === "desc" ? "rotate-180" : ""
        }`}
      >
        <path d="M4 9 L8 5 L12 9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
