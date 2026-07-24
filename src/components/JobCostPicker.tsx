"use client";

import { useRouter, usePathname } from "next/navigation";
import { INPUT } from "@/components/ui/classnames";

// Single-job selector for the Job Cost (BOM) page — mirrors the Power BI
// report's single-job slicer. Navigates to ?job=<jobId> on change.
export function JobCostPicker({
  jobs,
  selected,
}: {
  jobs: { jobId: string; jobName: string }[];
  selected: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <select
      value={selected}
      onChange={(e) => router.push(`${pathname}?job=${encodeURIComponent(e.target.value)}`)}
      className={`${INPUT} w-72`}
      aria-label="Select job"
    >
      {jobs.map((j) => (
        <option key={j.jobId} value={j.jobId}>
          {j.jobId} — {j.jobName}
        </option>
      ))}
    </select>
  );
}
