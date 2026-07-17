"use client";

import { useRef, useState } from "react";
import { calcHoursLeft, suggestNewEtc, round2 } from "@/lib/etc";
import { saveNewEtcDraft } from "@/lib/etc-actions";

const HOURS_WORKED_BG = "bg-[#C7DAF7]";
const HOURS_LEFT_BG = "bg-[#F1F6FD]";
function newEtcBg(hasValue: boolean) {
  return hasValue ? "bg-[#F2F2F2]" : "bg-[#FAFAC4]";
}
function diffBg(diff: number) {
  if (Math.abs(diff) < 0.005) return "bg-white";
  return diff < 0 ? "bg-[#EEADAC]" : "bg-[#9FCE62]";
}
function wholeNum(n: number): string {
  return Math.round(n).toString();
}

// Live client-side counterpart to a section's 4 derived cells (Hours Worked,
// Hours Left, New ETC, Diff). Hours Worked Month is read-only display (it
// auto-syncs from Power BI — see instrumentation.ts) but still rides along
// in the form submission via a hidden input, since submitMonth reads it by
// `name` unchanged. New ETC recomputes client-side as Hours Worked changes
// between syncs, so Hours Left/New ETC/Diff stay in sync without waiting for
// the next Submit or Sync round-trip.
export function EtcSectionCells({
  entryId,
  edge,
  jobName,
  sectionName,
  priorEtc,
  initialWorked,
  initialDraft,
  initialConfirmed,
  locked,
}: {
  entryId: number;
  edge: string;
  jobName: string;
  sectionName: string;
  priorEtc: number;
  initialWorked: number;
  initialDraft: number | null;
  // The entry's confirmed New ETC when it was already submitted once (a
  // REOPENED month) — null on a first-pass month. Without this, a reopened
  // cell seeded blank (worked > 0) or with priorEtc (worked == 0), so a
  // no-changes resubmit posted those seeds as overrides and silently
  // replaced the manager's confirmed values — found 2026-07-14, where 135
  // of April's 366 cells had a worked==0 manager override != priorEtc that
  // a round-trip would have wiped.
  initialConfirmed: number | null;
  locked: boolean;
}) {
  // Hours Worked Month is no longer manager-editable — it auto-syncs from
  // Power BI on the same cadence as the rest of the live sync (see
  // instrumentation.ts), so a manual edit would just get overwritten anyway.
  //
  // The hidden form input must carry the EXACT stored value, not the rounded
  // display text: submitMonth writes this value back to hoursWorked, so
  // posting the display rounding would permanently replace every fractional
  // Power-BI-synced value (e.g. 40.33) with its integer on each Submit —
  // manufacturing drift against the source that the history reconcile would
  // then keep flagging. Rounding is display-only.
  const worked = round2(initialWorked);
  const workedDisplay = wholeNum(initialWorked);
  const [newEtcText, setNewEtcText] = useState(
    initialDraft != null
      ? String(initialDraft)
      : initialConfirmed != null
        ? String(initialConfirmed)
        : initialWorked === 0
          ? String(round2(priorEtc))
          : "",
  );
  const [newEtcTouched, setNewEtcTouched] = useState(false);
  const lastSaved = useRef(newEtcText);

  const hoursLeft = calcHoursLeft(priorEtc, worked);
  const suggested = suggestNewEtc(priorEtc, worked);
  const decided = worked === 0 || initialDraft != null || initialConfirmed != null || newEtcTouched;
  const newEtcNum = Number(newEtcText);
  const effective = newEtcText.trim() === "" || !Number.isFinite(newEtcNum) ? suggested : newEtcNum;
  const diff = hoursLeft - effective;

  function handleNewEtcChange(e: React.ChangeEvent<HTMLInputElement>) {
    setNewEtcTouched(true);
    setNewEtcText(e.target.value);
  }

  async function handleNewEtcBlur() {
    const raw = newEtcText.trim();
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
    <>
      <td className={`${edge} bg-[#5E91D3] px-1 py-1 text-center text-[10px] text-sdc-gray-700`}>{wholeNum(priorEtc)}</td>
      <td className={`border-l border-sdc-border ${HOURS_WORKED_BG} px-1 py-1 text-center text-[10px] text-sdc-navy`}>
        {/* Read-only — auto-synced from Power BI, not manager-editable. The
            hidden input still carries the value into the form submission,
            since submitMonth reads it by `name` unchanged. */}
        <input type="hidden" name={`hoursWorked__${entryId}`} value={String(worked)} />
        {workedDisplay}
      </td>
      <td className={`border-l border-sdc-border ${HOURS_LEFT_BG} px-1 py-1 text-center text-[10px] text-sdc-gray-500`}>
        {wholeNum(hoursLeft)}
      </td>
      <td className={`border-l border-sdc-border ${newEtcBg(decided)} px-1 py-1 text-center`}>
        {/* No hours worked -> carry-forward is deterministic, safe to auto-fill.
            Hours worked > 0 -> a manager's judgment call, not auto-filled;
            flagged yellow so it's obviously not done yet. Typed values
            autosave on blur so a Refresh can't wipe them. */}
        <input
          type="number"
          step="0.01"
          min="0"
          name={`newEtcOverride__${entryId}`}
          value={newEtcText}
          onChange={handleNewEtcChange}
          onBlur={handleNewEtcBlur}
          placeholder={decided ? undefined : wholeNum(suggested)}
          disabled={locked}
          aria-label={`New ETC override, ${jobName}, ${sectionName}`}
          className={`w-12 [appearance:textfield] rounded-md border-none bg-transparent px-1.5 py-1 text-center text-[10px] outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:bg-white focus:shadow-sm ${
            decided ? "text-sdc-gray-600" : "text-sdc-yellow-text placeholder:text-sdc-yellow-text/60"
          }`}
        />
      </td>
      <td className={`border-l border-sdc-border ${diffBg(diff)} px-1 py-1 text-center text-[10px] text-sdc-gray-700`}>
        {wholeNum(diff)}
      </td>
    </>
  );
}
