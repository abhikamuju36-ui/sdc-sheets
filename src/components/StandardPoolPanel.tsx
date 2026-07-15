"use client";

// "Standard Fees By Department" side panel for the Monthly ETC grid's unlocked
// Standard view — mirrors the Excel sheet's department pool block (rows 71-108)
// and hosts the Standard Sheet workflow (Refresh from Power BI, edit the two
// manual cells, Submit/Lock the month, Reopen). Replaces the retired
// /standard-sheet tab.
//
// Excel parity: "Hours being pulled" (D76…) and "Rate" (D78…) are manual cells;
// "New ETC Hours" (=Available−Pulled, D77) and "Standard Fee" (=New ETC×Rate,
// D79) are formulas that recompute the instant either manual cell changes. So
// those two derived rows update live client-side here, before Save.

import { useState } from "react";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/classnames";

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
  // Live copies of the two manual cells (Excel D76/D78). Seeded once from the
  // server pool data; the derived rows below read from these so New ETC Hours
  // and Standard Fee recompute as you type, exactly like the sheet's formulas.
  const [pulled, setPulled] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.category, String(r.hoursPulledThisMonth)]))
  );
  const [rate, setRate] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.category, String(r.rate)]))
  );

  const input = "w-20 rounded border border-sdc-border px-1.5 py-0.5 text-right text-xs outline-none focus:border-sdc-blue";

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
                  .map((r) => {
                    // Excel D77 / D79 — recomputed live from the manual cells.
                    const pulledVal = num(pulled[r.category] ?? String(r.hoursPulledThisMonth));
                    const rateVal = num(rate[r.category] ?? String(r.rate));
                    const newEtcHours = r.hoursAvailable - pulledVal;
                    const standardFee = newEtcHours * rateVal;
                    return (
                      <div key={r.category} className="border-b border-sdc-border px-3 py-2">
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-sdc-gray-500">{r.dept}</p>
                        <dl className="space-y-0.5 text-xs">
                          <Line label="Previous Month Pulled Hours" value={whole(r.previousMonthPulledHours)} />
                          <Line label="New Hours Added this Month" value={whole(r.newHoursAddedThisMonth)} />
                          <Line label="Hours Available" value={whole(r.hoursAvailable)} />
                          <Line label="Hours Worked this Month" value={whole(r.hoursWorkedThisMonth)} />
                          <div className="flex items-center justify-between gap-2 rounded bg-sdc-yellow-bg/60 px-1">
                            <dt className="text-sdc-gray-600">Hours being pulled this month</dt>
                            <dd>
                              {poolsEditable && r.hasData ? (
                                <input
                                  type="number"
                                  step="1"
                                  min="0"
                                  name={`pulled__${r.category}`}
                                  value={pulled[r.category] ?? ""}
                                  onChange={(e) => setPulled((p) => ({ ...p, [r.category]: e.target.value }))}
                                  className={input}
                                  aria-label={`Hours pulled, ${r.dept}`}
                                />
                              ) : (
                                <span className="tabular-nums text-sdc-gray-700">{whole(pulledVal)}</span>
                              )}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-2 rounded px-1">
                            <dt className="text-sdc-gray-600">Rate</dt>
                            <dd>
                              {poolsEditable && r.hasData ? (
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  name={`rate__${r.category}`}
                                  value={rate[r.category] ?? ""}
                                  onChange={(e) => setRate((p) => ({ ...p, [r.category]: e.target.value }))}
                                  className={input}
                                  aria-label={`Rate, ${r.dept}`}
                                />
                              ) : (
                                <span className="tabular-nums text-sdc-gray-700">{rateVal}</span>
                              )}
                            </dd>
                          </div>
                          <Line label="New ETC Hours" value={whole(newEtcHours)} />
                          <Line label="Standard Fee" value={currency(standardFee)} strong />
                        </dl>
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>
          {poolsEditable && (
            <div className="border-t border-sdc-border px-3 py-2">
              <button type="submit" className="w-full rounded-md border border-sdc-border bg-white px-3 py-1.5 text-xs font-semibold text-sdc-navy hover:bg-sdc-blue-light">
                Save Pool Cells
              </button>
              <p className="mt-1 text-center text-[10px] text-sdc-gray-400">Job Standard Fees on the grid update after Save.</p>
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

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <dt className="text-sdc-gray-600">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold text-sdc-navy" : "text-sdc-gray-700"}`}>{value}</dd>
    </div>
  );
}
