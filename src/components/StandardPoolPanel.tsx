"use client";

// "Standard Fees By Department" side panel for the Monthly ETC grid's unlocked
// Standard view — mirrors the Excel sheet's department pool block (rows 71-108)
// and hosts the Standard Sheet workflow (Refresh from Power BI, edit the two
// manual cells, Submit/Lock the month, Reopen). Replaces the retired
// /standard-sheet tab.
//
// Excel parity: "Hours being pulled" (D76…) and "Rate" (D78…) are manual cells;
// "New ETC Hours" (=Available−Pulled, D77) and "Standard Fee" (=New ETC×Rate,
// D79) are formulas. The pulled/rate cells live in StandardRatesProvider, so
// editing them here recomputes this block AND every job row's Standard Fee on
// the grid live — the sheet's cross-linked formulas.

import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/classnames";
import { useStandardPoolCell } from "@/components/EtcStandardColumns";

export type PoolPanelRow = {
  category: string;
  group: string; // "Engineering" | "Shop"
  dept: string; // "PM" | "Warranty" | "Manufacturing"
  previousMonthPulledHours: number;
  newHoursAddedThisMonth: number;
  hoursAvailable: number;
  hoursWorkedThisMonth: number;
  hoursPulledThisMonth: number;
  rate: number;
  newEtcHours: number;
  standardFee: number;
  hasData: boolean;
};

function whole(n: number): string {
  return Math.round(n).toLocaleString();
}
function currency(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const GROUP_TINT: Record<string, string> = {
  Engineering: "bg-[#DCE6F1]",
  Shop: "bg-[#F2DDD3]",
};
const INPUT = "w-20 rounded border border-sdc-border px-1.5 py-0.5 text-right text-xs outline-none focus:border-sdc-blue";

export function StandardPoolPanel({
  month,
  carriedFrom,
  rows,
  isSubmitted,
  isAdmin,
  poolsEditable,
  savePoolsAction,
  refreshPoolsAction,
  submitMonthAction,
  reopenMonthAction,
}: {
  month: string;
  carriedFrom: string | null;
  rows: PoolPanelRow[];
  isSubmitted: boolean;
  isAdmin: boolean;
  poolsEditable: boolean;
  savePoolsAction: (formData: FormData) => Promise<void>;
  refreshPoolsAction: () => Promise<void>;
  submitMonthAction: () => Promise<void>;
  reopenMonthAction: () => Promise<void>;
}) {
  const groups = [...new Set(rows.map((r) => r.group))];

  return (
    <aside className="w-[320px] shrink-0 self-start overflow-hidden border border-sdc-border border-t-[#808080] bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-sdc-border bg-[#D6E4F0] px-3 py-2">
        <p className="text-sm font-semibold text-sdc-blue-dark">Standard Fees — {month}</p>
        {isSubmitted ? (
          <span className="rounded bg-sdc-navy px-2 py-0.5 text-[10px] font-semibold text-white">Locked</span>
        ) : (
          <form action={refreshPoolsAction}>
            <button type="submit" className="rounded border border-sdc-border bg-white px-2 py-0.5 text-[11px] font-medium text-sdc-navy hover:bg-sdc-blue-light" title="Pull this month's category pools from Power BI.">
              Refresh
            </button>
          </form>
        )}
      </div>

      {carriedFrom && !isSubmitted && (
        <p className="border-b border-sdc-border bg-sdc-yellow-bg/60 px-3 py-2 text-[11px] text-sdc-gray-600">
          No pool data pulled for {month} yet — showing {carriedFrom}&apos;s figures as an estimate. Click Refresh to pull {month}.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="px-3 py-4 text-xs text-sdc-gray-400">No department pool data available. Click Refresh to pull from Power BI.</p>
      ) : (
        <form action={savePoolsAction}>
          <div className="max-h-[calc(100vh-330px)] overflow-auto styled-scrollbar">
            {groups.map((group) => (
              <div key={group}>
                <div className={`${GROUP_TINT[group] ?? "bg-sdc-gray-100"} border-b border-sdc-border px-3 py-1.5 text-xs font-semibold text-sdc-navy`}>
                  {group}
                </div>
                {rows
                  .filter((r) => r.group === group)
                  .map((r) => (
                    <PoolDeptRow key={r.category} row={r} poolsEditable={poolsEditable} />
                  ))}
              </div>
            ))}
          </div>
          {poolsEditable && (
            <div className="border-t border-sdc-border px-3 py-2">
              <button type="submit" className="w-full rounded-md border border-sdc-border bg-white px-3 py-1.5 text-xs font-semibold text-sdc-navy hover:bg-sdc-blue-light">
                Save Pool Cells
              </button>
              <p className="mt-1 text-center text-[10px] text-sdc-gray-400">Grid Standard Fees update live; Save persists them.</p>
            </div>
          )}
        </form>
      )}

      <div className="flex flex-col gap-2 border-t border-sdc-border bg-sdc-gray-50 px-3 py-3">
        {isSubmitted ? (
          <>
            <p className="text-[11px] text-sdc-gray-500">This month is submitted and frozen.</p>
            {isAdmin && (
              <form action={reopenMonthAction}>
                <button type="submit" className={`${BUTTON_SECONDARY} w-full !py-1.5 !text-xs`}>Reopen Month</button>
              </form>
            )}
          </>
        ) : (
          <form action={submitMonthAction}>
            <button type="submit" className={`${BUTTON_PRIMARY} w-full !py-2 !text-xs`} title="Freeze this month's Standard Sheet.">
              Submit &amp; Lock Standard Sheet
            </button>
          </form>
        )}
      </div>
    </aside>
  );
}

// One department block. Reads/writes the live pulled/rate cell from the shared
// provider so New ETC Hours, Standard Fee, and the grid's job fees all move
// together as you type.
function PoolDeptRow({ row, poolsEditable }: { row: PoolPanelRow; poolsEditable: boolean }) {
  const cell = useStandardPoolCell(row.category);
  const editable = poolsEditable && row.hasData && !!cell;

  const pulledStr = cell?.pulled ?? String(row.hoursPulledThisMonth);
  const rateStr = cell?.rate ?? String(row.rate);
  const newEtcHours = cell?.newEtcHours ?? row.newEtcHours;
  const standardFee = cell?.standardFee ?? row.standardFee;

  return (
    <div className="border-b border-sdc-border px-3 py-2">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-sdc-gray-500">{row.dept}</p>
      <dl className="space-y-0.5 text-xs">
        <Line label="Previous Month Pulled Hours" value={whole(row.previousMonthPulledHours)} />
        <Line label="New Hours Added this Month" value={whole(row.newHoursAddedThisMonth)} />
        <Line label="Hours Available" value={whole(row.hoursAvailable)} />
        <Line label="Hours Worked this Month" value={whole(row.hoursWorkedThisMonth)} />
        <div className="flex items-center justify-between gap-2 rounded bg-sdc-yellow-bg/60 px-1">
          <dt className="text-sdc-gray-600">Hours being pulled this month</dt>
          <dd>
            {editable ? (
              <input type="number" step="1" min="0" name={`pulled__${row.category}`} value={pulledStr} onChange={(e) => cell!.setPulled(e.target.value)} className={INPUT} aria-label={`Hours pulled, ${row.dept}`} />
            ) : (
              <span className="tabular-nums text-sdc-gray-700">{whole(num(pulledStr))}</span>
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2 rounded px-1">
          <dt className="text-sdc-gray-600">Rate</dt>
          <dd>
            {editable ? (
              <input type="number" step="0.01" min="0" name={`rate__${row.category}`} value={rateStr} onChange={(e) => cell!.setRate(e.target.value)} className={INPUT} aria-label={`Rate, ${row.dept}`} />
            ) : (
              <span className="tabular-nums text-sdc-gray-700">{num(rateStr)}</span>
            )}
          </dd>
        </div>
        <Line label="New ETC Hours" value={whole(newEtcHours)} />
        <Line label="Standard Fee" value={currency(standardFee)} strong />
      </dl>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <dt className="text-sdc-gray-600">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold text-sdc-navy" : "text-sdc-gray-700"}`}>{value}</dd>
    </div>
  );
}
