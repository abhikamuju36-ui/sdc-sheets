"use client";

import { useRef } from "react";
import { saveNewEtcDraft } from "@/lib/etc-actions";

// New ETC cell input that autosaves on blur, so typed-but-unsubmitted
// overrides survive Refresh Data / navigation / crashes — parity with the
// sheet, whose Refresh script skipped non-empty New ETC cells. Uncontrolled
// (defaultValue) like the rest of the grid; only writes when the value
// actually changed since the last save.
export function EtcDraftInput({
  entryId,
  name,
  defaultValue,
  placeholder,
  disabled,
  ariaLabel,
  className,
}: {
  entryId: number;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel: string;
  className: string;
}) {
  const lastSaved = useRef(defaultValue ?? "");

  async function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    const raw = e.target.value.trim();
    if (raw === lastSaved.current) return;

    const parsed = raw === "" ? null : Number(raw);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) return; // let submit validation surface bad input

    try {
      await saveNewEtcDraft(entryId, parsed);
      lastSaved.current = raw;
    } catch {
      // Draft save is best-effort; the value still rides along in the form
      // submission, so a failed autosave never blocks or corrupts anything.
    }
  }

  return (
    <input
      type="number"
      step="0.01"
      min="0"
      name={name}
      defaultValue={defaultValue}
      placeholder={placeholder}
      disabled={disabled}
      onBlur={handleBlur}
      aria-label={ariaLabel}
      className={className}
    />
  );
}
