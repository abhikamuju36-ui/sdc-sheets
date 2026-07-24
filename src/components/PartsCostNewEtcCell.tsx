"use client";

import { useState } from "react";
import { markEtcDirty } from "@/lib/etc-dirty-tracker";

const NEUTRAL_BG = "bg-[#F2F2F2]";
const ATTENTION_BG = "bg-[#FAFAC4]";

function currency(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// Parts Cost's New ETC cell. Deliberately mirrors the New ETC cell in
// EtcSectionCells rather than reusing EtcDraftInput:
//   * NO autosave on blur — typing persists nothing on its own. The whole grid
//     is one <form>; the toolbar's (password-gated) Save button batch-saves
//     every `newEtcOverride__<id>` field at once. The old blur-autosave here
//     bypassed that gate, which was the one inconsistency in the column.
//   * Live "needs attention" background — yellow only when money was actually
//     spent this month and no value is decided yet; clears the instant the
//     manager types (touched), exactly like the section-hours cells.
//   * markEtcDirty() on change so the beforeunload "unsaved changes" guard
//     covers Parts Cost too.
// Currency masking (plain digits while focused, "$X,XXX" once blurred) is kept
// from the old EtcDraftInput currency mode; the raw digits ride along in a
// hidden input under `name`, so Save/Submit parse a clean number.
export function PartsCostNewEtcCell({
  name,
  jobName,
  initialValue,
  // Whether this cell would be yellow before the manager touches it: money was
  // spent this month and no value is decided (no draft, not submitted/historical).
  needsAttention,
  placeholder,
  locked,
}: {
  name: string;
  jobName: string;
  initialValue: string;
  needsAttention: boolean;
  placeholder?: string;
  locked?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);

  // Once the manager has weighed in (typed), the cell is decided — matches
  // EtcSectionCells, where newEtcTouched sticks for the rest of the session.
  const decided = !needsAttention || touched;
  const displayValue = focused ? value : value.trim() === "" ? "" : currency(Number(value));

  return (
    <td className={`border-l border-sdc-border ${decided ? NEUTRAL_BG : ATTENTION_BG} px-1 py-1 text-center`}>
      <input type="hidden" name={name} value={value} disabled={locked} />
      <input
        type="text"
        inputMode="decimal"
        value={displayValue}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          setValue(e.target.value.replace(/[^0-9.]/g, ""));
          setTouched(true);
          // Nothing persists from typing alone — the toolbar's gated Save
          // button batch-saves the whole grid. This just flags unsaved work
          // for the beforeunload guard.
          markEtcDirty();
        }}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        disabled={locked}
        aria-label={`New ETC cost override, ${jobName}, Parts Cost`}
        className="w-16 [appearance:textfield] rounded-md border-none bg-transparent px-1.5 py-1 text-center text-[10px] font-bold text-sdc-gray-600 outline-none placeholder:font-bold placeholder:text-sdc-gray-600 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:bg-white focus:shadow-sm"
      />
    </td>
  );
}
