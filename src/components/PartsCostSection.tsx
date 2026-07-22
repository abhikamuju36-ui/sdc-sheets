"use client";

import { useMemo, useState } from "react";
import { card, INPUT } from "@/components/ui/classnames";
import type { JobPartsCost } from "@/lib/sync-totaleto";

// Parts Cost section of the Job Hour Details dashboard — live per-part detail +
// rollups from TotalETO (see getJobPartsCost). Mirrors the Power BI "Parts Cost"
// table + KPI card + slicers. Category/Supplier/Search filters recompute the KPI
// rollups (matching the report's slicer behavior). Header + first column are
// sticky so the table reads without losing context.
const ROW_CAP = 800;

function usd(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function usd2(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

const COLS = ["Purchase", "Invoiced", "Manufacturer", "Supplier", "Category", "PO #", "Part #", "Description", "Qty", "Unit $", "Total", "Paid", "% Inv"];

export function PartsCostSection({ parts, estimatedToPurchase }: { parts: JobPartsCost | null; estimatedToPurchase: number | null }) {
  const [category, setCategory] = useState("");
  const [supplier, setSupplier] = useState("");
  const [search, setSearch] = useState("");

  const allLines = useMemo(() => parts?.lines ?? [], [parts]);

  const categories = useMemo(
    () => [...new Set(allLines.map((l) => l.category).filter(Boolean) as string[])].sort(),
    [allLines],
  );
  const suppliers = useMemo(
    () => [...new Set(allLines.map((l) => l.supplier).filter(Boolean) as string[])].sort(),
    [allLines],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allLines.filter((l) => {
      if (category && l.category !== category) return false;
      if (supplier && l.supplier !== supplier) return false;
      if (q) {
        const hay = `${l.supplier ?? ""} ${l.manufacturer ?? ""} ${l.category ?? ""} ${l.partNumber ?? ""} ${l.description ?? ""} ${l.poNumber ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allLines, category, supplier, search]);

  const purchased = filtered.reduce((s, l) => s + l.totalPrice, 0);
  const paid = filtered.reduce((s, l) => s + l.invoicedAmount, 0);
  const shown = filtered.slice(0, ROW_CAP);

  if (!parts) return null;
  const filterActive = Boolean(category || supplier || search.trim());

  return (
    <div className="mt-8 space-y-4">
      <p className="font-heading text-lg font-bold tracking-tight text-sdc-navy">Parts Cost</p>

      {/* KPI card — responds to the filters below */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label={filterActive ? "Purchased (filtered)" : "Purchased"} value={usd(purchased)} />
        <Kpi label="Estimated to Purchase" value={estimatedToPurchase != null ? usd(estimatedToPurchase) : "—"} />
        <Kpi label={filterActive ? "Paid (filtered)" : "Paid"} value={usd(paid)} tone="green" />
        <Kpi label="Left to Pay" value={usd(purchased - paid)} />
      </div>

      {/* Slicers */}
      <div className="flex flex-wrap items-center gap-2.5">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${INPUT} w-auto min-w-40`} aria-label="Filter by category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={supplier} onChange={(e) => setSupplier(e.target.value)} className={`${INPUT} w-auto min-w-48`} aria-label="Filter by supplier">
          <option value="">All suppliers</option>
          {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search part #, description, PO…"
          className={`${INPUT} w-64`}
          aria-label="Search parts"
        />
        {filterActive && (
          <button type="button" onClick={() => { setCategory(""); setSupplier(""); setSearch(""); }} className="text-xs text-sdc-gray-400 hover:text-sdc-navy">
            Clear
          </button>
        )}
        <span className="ml-auto text-xs text-sdc-gray-400">{filtered.length.toLocaleString()} line items</span>
      </div>

      {/* Detail table — sticky header + first column, tall scroll region */}
      <div className={`${card("p-0")} max-h-[72vh] overflow-auto`}>
        {filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-sdc-gray-500">
            {allLines.length === 0 ? "No parts purchased for this job." : "No line items match the current filters."}
          </p>
        ) : (
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 z-20">
              <tr className="bg-sdc-navy text-left text-white">
                {COLS.map((h, i) => (
                  <th
                    key={h}
                    className={`whitespace-nowrap border-l border-white/15 px-2 py-2 font-medium first:border-l-0 ${
                      i === 0 ? "sticky left-0 z-30 bg-sdc-navy" : ""
                    } ${i >= 8 ? "text-right" : ""}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {shown.map((l, i) => {
                const pct = l.totalPrice ? Math.round((l.invoicedAmount / l.totalPrice) * 100) : 0;
                return (
                  <tr key={i} className="border-b border-sdc-border-soft/60 odd:bg-white even:bg-sdc-gray-50/60 hover:bg-sdc-blue-light/40">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-inherit px-2 py-1 text-sdc-gray-500">{l.purchaseDate ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-sdc-gray-500">{l.invoicedDate ?? "—"}</td>
                    <td className="max-w-36 truncate px-2 py-1" title={l.manufacturer ?? ""}>{l.manufacturer ?? "—"}</td>
                    <td className="max-w-44 truncate px-2 py-1" title={l.supplier ?? ""}>{l.supplier ?? "—"}</td>
                    <td className="max-w-32 truncate px-2 py-1" title={l.category ?? ""}>{l.category ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-sdc-gray-500">{l.poNumber ?? "—"}</td>
                    <td className="max-w-36 truncate px-2 py-1" title={l.partNumber ?? ""}>{l.partNumber ?? "—"}</td>
                    <td className="max-w-72 truncate px-2 py-1" title={l.description ?? ""}>{l.description ?? "—"}</td>
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
      {filtered.length > ROW_CAP && (
        <p className="text-xs text-sdc-gray-400">Showing the {ROW_CAP} most recent of {filtered.length.toLocaleString()} matching line items — narrow with the filters above.</p>
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "green" }) {
  return (
    <div className={card("p-5")}>
      <p className="text-xs font-semibold text-sdc-gray-600">{label}</p>
      <p className={`mt-3 font-heading text-[22px] font-bold tracking-tight ${tone === "green" ? "text-sdc-green-text" : "text-sdc-navy"}`}>
        {value}
      </p>
    </div>
  );
}
