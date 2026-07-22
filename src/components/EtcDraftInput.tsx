"use client";

import { useRef, useState } from "react";
import { saveNewEtcDraft } from "@/lib/etc-actions";

function currency(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

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
  currency: currencyMode = false,
}: {
  entryId: number;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel: string;
  className: string;
  // Dollar-valued sections (e.g. Parts Cost) display "$X,XXX" once blurred
  // instead of a plain number — same masking as the Standard Sheet's
  // Contingency input.
  currency?: boolean;
}) {
  const lastSaved = useRef(defaultValue ?? "");
  const [value, setValue] = useState(defaultValue ?? "");
  const [focused, setFocused] = useState(false);

  async function save(raw: string) {
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

  if (!currencyMode) {
    return (
      <input
        type="number"
        step="0.01"
        min="0"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        onBlur={(e) => save(e.target.value.trim())}
        aria-label={ariaLabel}
        className={className}
      />
    );
  }

  // The visible input shows plain digits while focused and "$X,XXX" once
  // blurred. A hidden input carries the raw digits under `name` instead, so
  // form submission (Submit and Lock reads this via FormData) still parses a
  // clean number rather than the "$"/"," display string.
  const displayValue = focused ? value : value.trim() === "" ? "" : currency(Number(value));

  return (
    <>
      <input type="hidden" name={name} value={value} disabled={disabled} />
      <input
        type="text"
        inputMode="decimal"
        value={displayValue}
        onFocus={() => setFocused(true)}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))}
        onBlur={() => {
          setFocused(false);
          save(value.trim());
        }}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        className={className}
      />
    </>
  );
}
