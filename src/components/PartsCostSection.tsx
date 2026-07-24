"use client";

import { useMemo, useState } from "react";
import { card } from "@/components/ui/classnames";
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

// Compact filter control — small enough that the whole slicer row fits on one
// line. The dropdowns/search flex-shrink; the date inputs stay fixed.
const CTRL = "h-8 rounded-md border border-sdc-border bg-white px-2 text-xs text-sdc-navy outline-none focus:border-sdc-blue";

export function PartsCostSection({ parts, estimatedToPurchase }: { parts: JobPartsCost | null; estimatedToPurchase: number | null }) {
  const [category, setCategory] = useState("");
  const [supplier, setSupplier] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [search, setSearch] = useState("");
  const [dateBasis, setDateBasis] = useState<"invoiced" | "purchase">("invoiced");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const allLines = useMemo(() => parts?.lines ?? [], [parts]);

  const categories = useMemo(
    () => [...new Set(allLines.map((l) => l.category).filter(Boolean) as string[])].sort(),
    [allLines],
  );
  const suppliers = useMemo(
    () => [...new Set(allLines.map((l) => l.supplier).filter(Boolean) as string[])].sort(),
    [allLines],
  );
  const manufacturers = useMemo(
    () => [...new Set(allLines.map((l) => l.manufacturer).filter(Boolean) as string[])].sort(),
    [allLines],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allLines.filter((l) => {
      if (category && l.category !== category) return false;
      if (supplier && l.supplier !== supplier) return false;
      if (manufacturer && l.manufacturer !== manufacturer) return false;
      const d = dateBasis === "invoiced" ? l.invoicedDate : l.purchaseDate;
      if (dateFrom && (!d || d < dateFrom)) return false;
      if (dateTo && (!d || d > dateTo)) return false;
      if (q) {
        const hay = `${l.supplier ?? ""} ${l.manufacturer ?? ""} ${l.category ?? ""} ${l.partNumber ?? ""} ${l.description ?? ""} ${l.poNumber ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allLines, category, supplier, manufacturer, search, dateBasis, dateFrom, dateTo]);

  const purchased = filtered.reduce((s, l) => s + l.totalPrice, 0);
  const paid = filtered.reduce((s, l) => s + l.invoicedAmount, 0);
  const shown = filtered.slice(0, ROW_CAP);

  if (!parts) return null;
  const filterActive = Boolean(category || supplier || manufacturer || search.trim() || dateFrom || dateTo);
  const clearAll = () => {
    setCategory(""); setSupplier(""); setManufacturer(""); setSearch(""); setDateFrom(""); setDateTo("");
  };

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

      {/* Slicers — single compact row (no wrap); dropdowns/search shrink to fit. */}
      <div className="flex flex-nowrap items-center gap-1.5">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${CTRL} min-w-0 flex-1`} aria-label="Filter by category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={supplier} onChange={(e) => setSupplier(e.target.value)} className={`${CTRL} min-w-0 flex-1`} aria-label="Filter by supplier">
          <option value="">All suppliers</option>
          {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} className={`${CTRL} min-w-0 flex-1`} aria-label="Filter by manufacturer">
          <option value="">All manufacturers</option>
          {manufacturers.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className={`${CTRL} min-w-0 flex-1`}
          aria-label="Search parts"
        />
        {/* Date basis — single toggle button (Invoiced <-> Purchase) + range */}
        <button
          type="button"
          onClick={() => setDateBasis((b) => (b === "invoiced" ? "purchase" : "invoiced"))}
          title="Toggle whether the date range filters on Invoiced Date or Purchase Date"
          className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-sdc-blue bg-sdc-blue-light px-2 text-xs font-medium text-sdc-blue-dark hover:bg-sdc-blue-light/70"
        >
          {dateBasis === "invoiced" ? "Invoiced" : "Purchase"}
          <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 5.5 L2 7.5 L4 9.5 M2 7.5 H14 M12 10.5 L14 8.5 L12 6.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`${CTRL} shrink-0`} aria-label={`${dateBasis} date from`} />
        <span className="shrink-0 text-xs text-sdc-gray-400">to</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={`${CTRL} shrink-0`} aria-label={`${dateBasis} date to`} />
        {filterActive && (
          <button type="button" onClick={clearAll} className="shrink-0 text-xs text-sdc-gray-400 hover:text-sdc-navy">
            Clear
          </button>
        )}
        <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-sdc-gray-400">{filtered.length.toLocaleString()} line items</span>
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
            {/* Sticky footer: sums Total + Paid across the filtered rows (same
                figures as the Purchased/Paid KPI cards). Stays pinned to the
                bottom of the scroll region so it's visible while scrolling. */}
            <tfoot className="sticky bottom-0 z-20">
              <tr className="bg-sdc-navy font-semibold text-white">
                <td className="sticky left-0 z-30 whitespace-nowrap bg-sdc-navy px-2 py-2 text-right" colSpan={10}>
                  Total ({filtered.length.toLocaleString()} line items)
                </td>
                <td className="px-2 py-2 text-right">{usd(purchased)}</td>
                <td className="px-2 py-2 text-right">{usd(paid)}</td>
                <td className="px-2 py-2 text-right">{purchased ? Math.round((paid / purchased) * 100) : 0}%</td>
              </tr>
            </tfoot>
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
