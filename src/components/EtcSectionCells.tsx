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
// Hours Left, New ETC, Diff). These used to be plain uncontrolled inputs
// whose derived values only came from server-rendered props, so editing
// Hours Worked never visibly updated Hours Left/New ETC/Diff until the next
// Submit or Sync round-trip. This mirrors the same etc.ts math client-side
// so the row recomputes as you type; submitMonth still reads the final DOM
// values by `name`, unchanged.
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
  const [workedText, setWorkedText] = useState(wholeNum(initialWorked));
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

  const worked = Number(workedText) || 0;
  const hoursLeft = calcHoursLeft(priorEtc, worked);
  const suggested = suggestNewEtc(priorEtc, worked);
  const decided = worked === 0 || initialDraft != null || initialConfirmed != null || newEtcTouched;
  const newEtcNum = Number(newEtcText);
  const effective = newEtcText.trim() === "" || !Number.isFinite(newEtcNum) ? suggested : newEtcNum;
  const diff = hoursLeft - effective;

  function handleWorkedChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    setWorkedText(raw);
    // Auto-fill/clear New ETC only while the manager hasn't typed into it
    // themselves, no draft is persisted, AND the cell was never confirmed —
    // a confirmed value (reopened month) must survive Hours Worked edits
    // until the manager explicitly retypes it.
    if (!newEtcTouched && initialDraft == null && initialConfirmed == null) {
      const nextWorked = Number(raw) || 0;
      setNewEtcText(nextWorked === 0 ? String(round2(priorEtc)) : "");
    }
  }

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
      <td className={`border-l border-sdc-border ${HOURS_WORKED_BG} px-1 py-1 text-center`}>
        {/* Rounded to a whole number for display — this IS what submitMonth
            writes back, so any sub-hour precision Power BI supplied is lost
            once a manager submits without editing this cell. */}
        <input
          type="number"
          step="1"
          min="0"
          name={`hoursWorked__${entryId}`}
          value={workedText}
          onChange={handleWorkedChange}
          disabled={locked}
          aria-label={`Hours worked, ${jobName}, ${sectionName}`}
          className="w-12 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-center text-[10px] outline-none focus:border-sdc-blue focus:bg-white focus:shadow-sm disabled:text-sdc-gray-400"
        />
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
