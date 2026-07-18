"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Show/hide toggle for the Job Name column, shared by the Projects and
// Monthly ETC grids. Drives the `jobname` query param ("0" = hidden; absent
// = shown, keeping default URLs clean) on whatever page it's rendered on.
export function JobNameToggle({ show, label = "Job Name" }: { show: boolean; label?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function toggle() {
    const qs = new URLSearchParams(searchParams.toString());
    if (show) qs.set("jobname", "0");
    else qs.delete("jobname");
    const query = qs.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <label
      className={`flex cursor-pointer select-none items-center gap-1.5 rounded-md border px-3.5 py-1.5 text-sm font-medium shadow-sm ${
        show
          ? "border-sdc-border bg-white text-sdc-navy hover:bg-sdc-blue-light"
          : "border-sdc-blue bg-sdc-blue-light text-sdc-blue-dark"
      }`}
      title={`Show or hide the ${label} column`}
    >
      <input type="checkbox" checked={show} onChange={toggle} className="h-3.5 w-3.5 shrink-0" />
      {label}
    </label>
  );
}
