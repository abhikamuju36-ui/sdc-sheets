"use client";

import { useRef, useState } from "react";
import { saveExecutionRateField } from "@/lib/execution-rate-actions";

// Autosaves a single Execution Rate field (ENGR/Shop/Parts) on blur — shared
// by the Monthly ETC grid's inline Standard Sheet columns and the
// /standard-sheet tab, both writing the same ExecutionRate row per job, so a
// change on either tab is immediately visible on the other (next load).
export function ExecutionRateInput({
  jobId,
  field,
  defaultValue,
  disabled,
  ariaLabel,
  className,
}: {
  jobId: number;
  field: "engrRate" | "shopRate" | "partsMarkup";
  defaultValue: string;
  disabled?: boolean;
  ariaLabel: string;
  className: string;
}) {
  const lastSaved = useRef(defaultValue);
  const [failed, setFailed] = useState(false);

  async function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    const raw = e.target.value.trim();
    if (raw === lastSaved.current) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    try {
      await saveExecutionRateField(jobId, field, parsed);
      lastSaved.current = raw;
      setFailed(false);
    } catch {
      // The typed value stays on screen and will retry as "changed" on the
      // next blur — but flag it, so a failed save isn't mistaken for a saved one.
      setFailed(true);
    }
  }

  return (
    <input
      type="number"
      step="0.01"
      min="0"
      defaultValue={defaultValue}
      disabled={disabled}
      onBlur={handleBlur}
      aria-label={failed ? `${ariaLabel} (save failed)` : ariaLabel}
      title={failed ? "Save failed — this value is NOT saved. Edit the cell to retry." : undefined}
      className={`${className}${failed ? " rounded-sm ring-1 ring-red-500" : ""}`}
    />
  );
}
