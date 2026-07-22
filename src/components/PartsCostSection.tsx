import { card } from "@/components/ui/classnames";
import type { JobPartsCost } from "@/lib/sync-totaleto";

// Parts Cost section of the Job Hour Details dashboard — live per-part detail +
// rollups from TotalETO (see getJobPartsCost). Mirrors the Power BI "Parts Cost"
// table + KPI card. Estimated-to-Purchase is the parts New ETC (dollars).
const ROW_CAP = 500;

function usd(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function usd2(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function PartsCostSection({ parts, estimatedToPurchase }: { parts: JobPartsCost | null; estimatedToPurchase: number | null }) {
  if (!parts) return null;
  const { purchased, paid, leftToPay, lines } = parts;
  const shown = lines.slice(0, ROW_CAP);

  return (
    <div className="mt-6 space-y-4">
      <p className="text-sm font-semibold text-sdc-navy">Parts Cost</p>

      {/* KPI card */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Purchased" value={usd(purchased)} />
        <Kpi label="Estimated to Purchase" value={estimatedToPurchase != null ? usd(estimatedToPurchase) : "—"} />
        <Kpi label="Paid" value={usd(paid)} tone="green" />
        <Kpi label="Left to Pay" value={usd(leftToPay)} />
      </div>

      {/* Detail table */}
      <div className={`${card("p-0")} overflow-x-auto`}>
        {lines.length === 0 ? (
          <p className="p-6 text-center text-sm text-sdc-gray-500">No parts purchased for this job.</p>
        ) : (
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0">
              <tr className="bg-sdc-navy text-left text-white">
                {["Purchase", "Invoiced", "Manufacturer", "Supplier", "Category", "PO #", "Part #", "Description", "Qty", "Unit $", "Total", "Paid", "% Inv"].map((h) => (
                  <th key={h} className="whitespace-nowrap border-l border-white/15 px-2 py-1.5 font-medium first:border-l-0">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {shown.map((l, i) => {
                const pct = l.totalPrice ? Math.round((l.invoicedAmount / l.totalPrice) * 100) : 0;
                return (
                  <tr key={i} className="border-b border-sdc-border-soft/60 hover:bg-sdc-blue-light/30">
                    <td className="whitespace-nowrap px-2 py-1 text-sdc-gray-500">{l.purchaseDate ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-sdc-gray-500">{l.invoicedDate ?? "—"}</td>
                    <td className="max-w-32 truncate px-2 py-1" title={l.manufacturer ?? ""}>{l.manufacturer ?? "—"}</td>
                    <td className="max-w-40 truncate px-2 py-1" title={l.supplier ?? ""}>{l.supplier ?? "—"}</td>
                    <td className="max-w-28 truncate px-2 py-1" title={l.category ?? ""}>{l.category ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-sdc-gray-500">{l.poNumber ?? "—"}</td>
                    <td className="max-w-32 truncate px-2 py-1" title={l.partNumber ?? ""}>{l.partNumber ?? "—"}</td>
                    <td className="max-w-64 truncate px-2 py-1" title={l.description ?? ""}>{l.description ?? "—"}</td>
                    <td className="px-2 py-1 text-right">{l.quantity}</td>
                    <td className="px-2 py-1 text-right">{usd2(l.unitPrice)}</td>
                    <td className="px-2 py-1 text-right font-semibold text-sdc-navy">{usd(l.totalPrice)}</td>
                    <td className="px-2 py-1 text-right text-sdc-green-text">{usd(l.invoicedAmount)}</td>
                    <td className="px-2 py-1 text-right">{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {lines.length > ROW_CAP && (
        <p className="text-xs text-sdc-gray-400">Showing the {ROW_CAP} most recent of {lines.length.toLocaleString()} line items.</p>
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "green" }) {
  return (
    <div className={`rounded-lg px-4 py-3 text-white ${tone === "green" ? "bg-sdc-green" : "bg-sdc-blue"}`}>
      <p className="font-mono text-lg font-bold leading-tight">{value}</p>
      <p className="text-[11px] uppercase tracking-wide opacity-90">{label}</p>
    </div>
  );
}
