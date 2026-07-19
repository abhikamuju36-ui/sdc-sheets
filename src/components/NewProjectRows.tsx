"use client";

import { Fragment } from "react";
import { VALID_JOB_TYPES } from "@/lib/job-filters";
import { useNewProjectRowIds, removeNewProjectRow } from "@/components/NewProjectRowsStore";
import { DateCell } from "@/components/DateCell";

type PhaseGroup = { phase: string; sections: { code: string; name: string }[] };

// Renders one blank, fully editable row per pending "+ Add Project" click —
// same column shape as a real job row (see quoted/page.tsx), just keyed by a
// client-side temp id instead of a job.id. Field names use the `newRow__`/
// `newRowHours__` prefixes quoted-actions.ts looks for; Job Id is the only
// field it requires non-empty before it'll create anything.
export function NewProjectRows({
  phaseGroups,
  allStatuses,
  hidden = [],
}: {
  phaseGroups: PhaseGroup[];
  allStatuses: string[];
  // Mirrors the page's "Columns" dropdown — hidden info columns are omitted
  // from the add-project row too, so it stays column-aligned with the grid
  // (saveNewRows defaults blank Name/Customer/etc. sensibly).
  hidden?: string[];
}) {
  const tempIds = useNewProjectRowIds();
  const hiddenSet = new Set(hidden);
  const show = (key: string) => !hiddenSet.has(key);

  return (
    <>
      {tempIds.map((tempId) => (
        <tr key={tempId} className="bg-sdc-yellow-bg/30 hover:bg-sdc-yellow-bg/50">
          <td className="sticky left-0 z-10 w-8 min-w-8 bg-sdc-yellow-bg/60 px-1 py-1.5 text-center">
            <button
              type="button"
              onClick={() => removeNewProjectRow(tempId)}
              title="Remove this new row"
              aria-label="Remove new project row"
              className="text-sdc-gray-400 hover:text-red-600"
            >
              ×
            </button>
          </td>
          <td className="sticky left-8 z-10 w-20 min-w-20 max-w-20 overflow-hidden bg-sdc-yellow-bg/60 px-2 py-1.5 text-center font-mono text-[10px]">
            <input
              type="number"
              step="1"
              min="1"
              name={`newRow__${tempId}__jobId`}
              placeholder="Job Id *"
              required
              aria-label="New project Job Id"
              className="w-full min-w-0 text-center font-semibold"
            />
          </td>
          {show("job") && (
            <td
              style={{ width: "var(--job-col-width, 280px)", minWidth: "var(--job-col-width, 280px)" }}
              className="sticky left-[112px] z-10 whitespace-nowrap border-l border-r border-sdc-border bg-sdc-yellow-bg/60 px-2 py-1.5 text-center text-[10px] font-medium text-sdc-navy"
            >
              <input
                type="text"
                name={`newRow__${tempId}__jobName`}
                placeholder="Job Name (defaults to Job Id)"
                aria-label="New project Job Name"
                className="w-full min-w-0 text-center"
              />
            </td>
          )}
          {show("customer") && (
            <td className="whitespace-nowrap px-2 py-1.5 text-center text-[10px] text-sdc-gray-600">
              <input type="text" name={`newRow__${tempId}__customer`} placeholder="—" aria-label="New project Customer" className="text-center" />
            </td>
          )}
          {show("type") && (
            <td className="whitespace-nowrap px-2 py-1.5 text-center text-[10px] text-sdc-gray-600">
              <select name={`newRow__${tempId}__type`} defaultValue="" aria-label="New project Type" className="text-center">
                <option value="">—</option>
                {VALID_JOB_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </td>
          )}
          {show("billable") && (
            <td className="whitespace-nowrap px-2 py-1.5 text-center text-[10px]">
              <select name={`newRow__${tempId}__billable`} defaultValue="Billable" aria-label="New project Billable" className="text-center">
                <option value="Billable">Billable</option>
                <option value="Non-Billable">Non-Billable</option>
              </select>
            </td>
          )}
          {show("status") && (
            <td className="whitespace-nowrap px-2 py-1.5 text-center text-[10px] font-medium text-sdc-blue-dark">
              <select name={`newRow__${tempId}__status`} defaultValue="Active" aria-label="New project Status" className="text-center">
                {allStatuses.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </td>
          )}
          {show("startDate") && (
            <td className="whitespace-nowrap px-2 py-1.5 text-center text-[10px] text-sdc-gray-500">
              <DateCell name={`newRow__${tempId}__startDate`} defaultValue="" ariaLabel="New project Start Date" />
            </td>
          )}
          {show("completeDate") && (
            <td className="whitespace-nowrap px-2 py-1.5 text-center text-[10px] text-sdc-gray-500">
              <DateCell name={`newRow__${tempId}__completeDate`} defaultValue="" ariaLabel="New project Complete Date" />
            </td>
          )}
          {phaseGroups.map((g) =>
            g.sections.length ? (
              <Fragment key={g.phase}>
                {g.sections.map((s) => (
                  <td key={s.code} className="border-l border-sdc-border px-1 py-1.5 text-center font-mono text-[10px] text-sdc-gray-600">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      name={`newRowHours__${tempId}__${s.code}`}
                      placeholder="—"
                      aria-label={`New project quoted hours, ${s.name}`}
                      className="text-center"
                    />
                  </td>
                ))}
                <td className="border-l border-sdc-border bg-sdc-blue-light/60 px-1 py-1.5 text-center font-mono text-[10px] font-medium text-sdc-navy">
                  —
                </td>
              </Fragment>
            ) : (
              <td key={g.phase} className="border-l border-sdc-border px-1 py-1.5 text-center font-mono text-[10px] text-sdc-gray-600">
                —
              </td>
            )
          )}
          <td className="sticky right-[90px] z-10 whitespace-nowrap border-l border-sdc-border bg-sdc-yellow-bg/60 px-2 py-1.5 text-center text-[10px] font-medium text-sdc-navy">
            <div className="flex items-center justify-center gap-0.5">
              <span className="text-sdc-gray-400">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                name={`newRow__${tempId}__costQuoted`}
                placeholder="—"
                aria-label="New project Cost Quoted"
                className="w-full min-w-0 border-none bg-transparent text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
          </td>
          <td className="sticky right-0 z-10 whitespace-nowrap bg-sdc-yellow-bg/60 px-2 py-1.5 text-center text-[10px] text-sdc-gray-600">
            <div className="flex items-center justify-center gap-0.5">
              <span className="text-sdc-gray-400">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                name={`newRow__${tempId}__costActualHistorical`}
                placeholder="—"
                aria-label="New project Cost Actual"
                className="w-full min-w-0 border-none bg-transparent text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}
