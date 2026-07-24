"use client";

import { useMemo, useState } from "react";
import type { BomNode, JobBom } from "@/lib/job-bom";

function usd(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function num(n: number): string {
  return n ? Math.round(n).toLocaleString() : "";
}

// Expandable BOM cost hierarchy — recreation of the Power BI "Job Status, Job"
// matrix. Costs roll up from the source Extended Cost (verified against the
// report's grand total); expand/collapse mirrors the matrix's drill.
export function JobBomMatrix({ bom }: { bom: JobBom }) {
  // Collapsed set (keys). Default: collapse everything with children so the
  // page opens at the section rows, like the report.
  const allParents = useMemo(() => {
    const s = new Set<string>();
    const walk = (n: BomNode) => { if (n.children.length) s.add(n.key); n.children.forEach(walk); };
    bom.roots.forEach(walk);
    return s;
  }, [bom]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(allParents));

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const visible = useMemo(() => {
    const out: BomNode[] = [];
    const walk = (n: BomNode) => {
      out.push(n);
      if (!collapsed.has(n.key)) n.children.forEach(walk);
    };
    bom.roots.forEach(walk);
    return out;
  }, [bom, collapsed]);

  return (
    <div className="overflow-hidden rounded-xl border border-sdc-border bg-white shadow-sm">
      <div className="max-h-[76vh] overflow-auto styled-scrollbar">
        <table className="w-full border-collapse text-[12px] tabular-nums">
          <thead className="sticky top-0 z-10">
            <tr className="bg-sdc-navy text-left text-white">
              <th className="px-4 py-2.5 font-semibold">
                Hierarchy
                <span className="ml-3 font-normal">
                  <button type="button" onClick={() => setCollapsed(new Set())} className="text-[11px] text-white/70 underline decoration-white/30 hover:text-white">expand all</button>
                  <span className="px-1 text-white/30">·</span>
                  <button type="button" onClick={() => setCollapsed(new Set(allParents))} className="text-[11px] text-white/70 underline decoration-white/30 hover:text-white">collapse</button>
                </span>
              </th>
              <th className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">Total Cost</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">Parts / Asm</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">Total Part QTY</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">Nested Asm</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-right font-semibold">Unit $</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((n) => {
              const hasKids = n.children.length > 0;
              const isCollapsed = collapsed.has(n.key);
              const isSection = n.depth === 1;
              const rowCls = isSection
                ? "border-t border-sdc-border/70 bg-sdc-blue-light/60 text-sdc-navy"
                : "border-b border-sdc-border-soft/40 hover:bg-sdc-blue-light/30";
              const labelCls = isSection
                ? "font-bold text-sdc-navy"
                : n.isAssembly
                  ? "font-semibold text-sdc-navy"
                  : "text-sdc-gray-700";
              return (
                <tr key={n.key} className={rowCls}>
                  <td className={`py-1.5 pr-3 ${isSection ? "text-[13px]" : ""}`} style={{ paddingLeft: `${14 + (n.depth - 1) * 20}px` }}>
                    <span className="flex items-center gap-1.5">
                      {hasKids ? (
                        <button
                          type="button"
                          onClick={() => toggle(n.key)}
                          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-sdc-gray-300 text-sdc-gray-500 hover:bg-white/60 hover:text-sdc-navy"
                          aria-label={isCollapsed ? "Expand" : "Collapse"}
                        >
                          <span className="text-[10px] leading-none">{isCollapsed ? "+" : "−"}</span>
                        </button>
                      ) : (
                        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-sdc-gray-300">•</span>
                      )}
                      <span className={labelCls}>{n.label}</span>
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium text-sdc-navy">{n.totalCost ? usd(n.totalCost) : ""}</td>
                  <td className="px-3 py-1.5 text-right text-sdc-gray-600">{num(n.partQty)}</td>
                  <td className="px-3 py-1.5 text-right text-sdc-gray-600">{num(n.totalPartQty)}</td>
                  <td className="px-3 py-1.5 text-right text-sdc-gray-600">{n.nestedAssemblies || ""}</td>
                  <td className="px-4 py-1.5 text-right text-sdc-gray-500">{n.unitCost ? usd(n.unitCost) : ""}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-sdc-border bg-sdc-gray-100 font-bold text-sdc-navy">
              <td className="px-4 py-2.5">Total</td>
              <td className="px-3 py-2.5 text-right">{usd(bom.grandTotalCost)}</td>
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5 text-right">{num(bom.grandTotalPartQty)}</td>
              <td className="px-3 py-2.5" />
              <td className="px-4 py-2.5" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
