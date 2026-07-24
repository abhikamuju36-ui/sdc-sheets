"use client";

import { useMemo, useState } from "react";
import type { BomNode, JobBom } from "@/lib/job-bom";
import { card } from "@/components/ui/classnames";

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
    <div className={`${card("p-0")} overflow-auto max-h-[76vh]`}>
      <table className="w-full border-collapse text-[12px] tabular-nums">
        <thead className="sticky top-0 z-10">
          <tr className="bg-sdc-navy text-left text-white">
            <th className="px-3 py-2 font-medium">
              Hierarchy
              <span className="ml-3 font-normal">
                <button type="button" onClick={() => setCollapsed(new Set())} className="text-[11px] underline decoration-white/40 hover:decoration-white">expand all</button>
                <span className="px-1 opacity-40">·</span>
                <button type="button" onClick={() => setCollapsed(new Set(allParents))} className="text-[11px] underline decoration-white/40 hover:decoration-white">collapse</button>
              </span>
            </th>
            <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Total Cost</th>
            <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Parts / Asm</th>
            <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Total Part QTY</th>
            <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Nested Asm</th>
            <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Unit $</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((n) => {
            const hasKids = n.children.length > 0;
            const isCollapsed = collapsed.has(n.key);
            return (
              <tr key={n.key} className="border-b border-sdc-border-soft/60 odd:bg-white even:bg-sdc-gray-50/50 hover:bg-sdc-blue-light/40">
                <td className="px-3 py-1" style={{ paddingLeft: `${12 + (n.depth - 1) * 18}px` }}>
                  <span className="flex items-center gap-1">
                    {hasKids ? (
                      <button
                        type="button"
                        onClick={() => toggle(n.key)}
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-sdc-gray-500 hover:bg-sdc-blue-light hover:text-sdc-navy"
                        aria-label={isCollapsed ? "Expand" : "Collapse"}
                      >
                        {isCollapsed ? "+" : "−"}
                      </button>
                    ) : (
                      <span className="inline-block h-4 w-4 shrink-0" />
                    )}
                    <span className={n.isAssembly ? "font-semibold text-sdc-navy" : "text-sdc-gray-700"}>{n.label}</span>
                  </span>
                </td>
                <td className="px-3 py-1 text-right font-medium text-sdc-navy">{n.totalCost ? usd(n.totalCost) : ""}</td>
                <td className="px-3 py-1 text-right">{num(n.partQty)}</td>
                <td className="px-3 py-1 text-right">{num(n.totalPartQty)}</td>
                <td className="px-3 py-1 text-right">{n.nestedAssemblies || ""}</td>
                <td className="px-3 py-1 text-right text-sdc-gray-500">{n.unitCost ? usd(n.unitCost) : ""}</td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-sdc-border bg-sdc-gray-100 font-bold text-sdc-navy">
            <td className="px-3 py-2">Total</td>
            <td className="px-3 py-2 text-right">{usd(bom.grandTotalCost)}</td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-right">{num(bom.grandTotalPartQty)}</td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2" />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
