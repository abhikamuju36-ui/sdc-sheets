import "server-only";
import { runDax } from "@/lib/powerbi-client";

// Native rebuild of the Power BI "Job Status, Job" BOM cost-hierarchy matrix.
// Source: the `Assembly` table in the same Power BI dataset the app already
// queries. The matrix nests by the Level0_Part … Level10_Part PATH columns
// (a "⬢ " prefix marks an assembly node); `Extended Cost` is the per-row cost.
// We group rows by that path and roll costs/quantities up the tree in code —
// verified to the dollar against the report (job 1118 grand total = $549,045,
// section 1118-10 = $266,013, etc.). We DON'T use the Power BI rollup measures:
// they only evaluate inside the matrix's exact filter context and come back
// blank per-row.

export type BomNode = {
  key: string;
  depth: number; // 1 = section root, 2 = assembly, 3+ = parts
  label: string; // "1118-A-000 - AIR LOOP ASSEMBLY MACHINE"
  isAssembly: boolean;
  partQty: number; // this node's own Part Quantity
  unitCost: number; // this node's own Unit Cost
  extendedCost: number; // this node's own Extended Cost (line cost)
  // Rolled up over the subtree (incl. this node):
  totalCost: number;
  totalPartQty: number;
  nestedAssemblies: number;
  children: BomNode[];
};

export type JobBom = {
  jobId: string;
  roots: BomNode[];
  grandTotalCost: number;
  grandTotalPartQty: number;
  rowCount: number;
};

const MAX_ROWS = 12000;
const LEVELS = 11; // Level0_Part … Level10_Part

// Strip the leading "⬢ " / bullet + whitespace a path label may carry.
function stripLabel(s: string): string {
  return s.replace(/^[^0-9A-Za-z]+/, "").trim();
}
// A path cell is "blank" when it's null or renders as an empty "- " label.
function isBlank(v: unknown): boolean {
  if (v == null) return true;
  const t = stripLabel(String(v));
  return t === "" || t === "-";
}

export async function getJobBom(jobId: string): Promise<JobBom> {
  const safe = String(jobId).replace(/[^A-Za-z0-9_.\- ]/g, "");
  const pathCols = Array.from({ length: LEVELS }, (_, i) => `"P${i}",Assembly[Level${i}_Part]`).join(", ");
  const dax = `
EVALUATE
TOPN(${MAX_ROWS},
  SELECTCOLUMNS(
    FILTER(Assembly, Assembly[ProjectID] = "${safe}"),
    ${pathCols},
    "Ext", Assembly[Extended Cost],
    "PartQty", Assembly[Part Quantity],
    "Unit", Assembly[Unit Cost],
    "Sort", Assembly[HierarchySortKey]
  ),
  [Sort], ASC
)`;
  const rows = (await runDax(dax)) as unknown as Record<string, unknown>[];

  const byKey = new Map<string, BomNode>();
  const roots: BomNode[] = [];
  let rowCount = 0;

  for (const r of rows) {
    const path: string[] = [];
    for (let i = 0; i < LEVELS; i++) {
      const v = r[`P${i}`];
      if (!isBlank(v)) path.push(String(v));
    }
    if (path.length === 0) continue; // blank/noise row
    rowCount++;

    // Ensure a node exists for every prefix of the path, wiring parent→child.
    let parent: BomNode | null = null;
    let acc = "";
    for (let d = 0; d < path.length; d++) {
      acc += " › " + path[d]; // unique cumulative key
      let node = byKey.get(acc);
      if (!node) {
        node = {
          key: acc,
          depth: d + 1,
          label: stripLabel(path[d]),
          isAssembly: /^[^0-9A-Za-z]/.test(path[d]), // ⬢ bullet prefix
          partQty: 0,
          unitCost: 0,
          extendedCost: 0,
          totalCost: 0,
          totalPartQty: 0,
          nestedAssemblies: 0,
          children: [],
        };
        byKey.set(acc, node);
        if (parent) parent.children.push(node);
        else roots.push(node);
      }
      parent = node;
    }
    // Attach this row's physical values to its deepest node.
    parent!.extendedCost += Number(r.Ext) || 0;
    parent!.partQty += Number(r.PartQty) || 0;
    const unit = Number(r.Unit) || 0;
    if (unit) parent!.unitCost = unit;
  }

  const rollup = (n: BomNode): void => {
    let cost = n.extendedCost;
    let pq = n.partQty;
    let nested = 0;
    for (const c of n.children) {
      rollup(c);
      cost += c.totalCost;
      pq += c.totalPartQty;
      nested += c.nestedAssemblies + (c.isAssembly ? 1 : 0);
    }
    n.totalCost = cost;
    n.totalPartQty = pq;
    n.nestedAssemblies = nested;
  };
  roots.forEach(rollup);

  const grandTotalCost = roots.reduce((s, n) => s + n.totalCost, 0);
  const grandTotalPartQty = roots.reduce((s, n) => s + n.totalPartQty, 0);

  return { jobId: safe, roots, grandTotalCost, grandTotalPartQty, rowCount };
}
