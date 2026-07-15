// Read-only "Standard Fees By Department" side panel for the Monthly ETC grid's
// unlocked Standard view — mirrors the /standard-sheet tab's department pool
// block (sheet rows 71-108). Display only here; refreshing/editing/submitting
// pools still lives on /standard-sheet.

export type PoolPanelRow = {
  category: string;
  group: string; // "Engineering" | "Shop"
  dept: string; // "PM" | "Warranty" | "Manufacturing"
  previousMonthPulledHours: number;
  newHoursAddedThisMonth: number;
  hoursAvailable: number;
  hoursWorkedThisMonth: number;
  hoursPulledThisMonth: number;
  newEtcHours: number;
  standardFee: number;
};

function whole(n: number): string {
  return Math.round(n).toLocaleString();
}
function currency(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

const GROUP_TINT: Record<string, string> = {
  Engineering: "bg-[#DCE6F1]",
  Shop: "bg-[#F2DDD3]",
};

export function StandardPoolPanel({
  month,
  carriedFrom,
  rows,
}: {
  month: string;
  carriedFrom: string | null;
  rows: PoolPanelRow[];
}) {
  const groups = [...new Set(rows.map((r) => r.group))];

  return (
    <aside className="w-[300px] shrink-0 self-start overflow-hidden border border-sdc-border border-t-[#808080] bg-white shadow-sm">
      <div className="border-b border-sdc-border bg-[#D6E4F0] px-3 py-2.5">
        <p className="text-center text-sm font-semibold text-sdc-blue-dark">Standard Fees By Department — {month}</p>
      </div>
      {carriedFrom && (
        <p className="border-b border-sdc-border bg-sdc-yellow-bg/60 px-3 py-2 text-[11px] text-sdc-gray-600">
          No pool data pulled for {month} yet — showing {carriedFrom}&apos;s figures as an estimate.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-xs text-sdc-gray-400">No department pool data available.</p>
      ) : (
        <div className="max-h-[calc(100vh-260px)] overflow-auto styled-scrollbar">
          {groups.map((group) => (
            <div key={group}>
              <div className={`${GROUP_TINT[group] ?? "bg-sdc-gray-100"} border-b border-sdc-border px-3 py-1.5 text-xs font-semibold text-sdc-navy`}>
                {group}
              </div>
              {rows
                .filter((r) => r.group === group)
                .map((r) => (
                  <div key={r.category} className="border-b border-sdc-border px-3 py-2">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-sdc-gray-500">{r.dept}</p>
                    <dl className="space-y-0.5 text-xs">
                      <Line label="Previous Month Pulled Hours" value={whole(r.previousMonthPulledHours)} />
                      <Line label="New Hours Added this Month" value={whole(r.newHoursAddedThisMonth)} />
                      <Line label="Hours Available" value={whole(r.hoursAvailable)} />
                      <Line label="Hours Worked this Month" value={whole(r.hoursWorkedThisMonth)} />
                      <Line label="Hours being pulled this month" value={whole(r.hoursPulledThisMonth)} highlight />
                      <Line label="New ETC Hours" value={whole(r.newEtcHours)} />
                      <Line label="Standard Fee" value={currency(r.standardFee)} strong />
                    </dl>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

function Line({ label, value, highlight, strong }: { label: string; value: string; highlight?: boolean; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 rounded px-1 ${highlight ? "bg-sdc-yellow-bg/60" : ""}`}>
      <dt className="text-sdc-gray-600">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold text-sdc-navy" : "text-sdc-gray-700"}`}>{value}</dd>
    </div>
  );
}
