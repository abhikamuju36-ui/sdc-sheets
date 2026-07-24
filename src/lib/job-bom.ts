import "server-only";
import sql from "mssql";

// Native BOM cost hierarchy — pulled DIRECTLY from Total ETO (the ERP Power BI
// itself reads from), via the `vwEngBOM` engineering BOM view. This avoids the
// Power BI delegated-token path entirely (its DPAPI token cache can't be
// decrypted when the app runs under the PM2 service account).
//
// vwEngBOM is edge rows (ParentID → ChildID) per ProjectID (= job number) and
// SpecID (= the report's "sections" 10/30/40/90). We explode it with a
// recursive CTE, group under one synthetic section node per SpecID, and roll
// leaf part costs (ItemLastCost × ItemQty) up the tree. Verified against the
// Power BI report: sections 30/90 match to the dollar; grand total is within
// ~0.3% (Power BI applies extra costing nuances on shared/assembly items).

export type BomNode = {
  key: string;
  depth: number;
  label: string;
  isAssembly: boolean;
  partQty: number;
  unitCost: number;
  extendedCost: number;
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

// Total ETO connection — same server/db/creds as sync-totaleto.ts.
const config: sql.config = {
  server: "SERVER-APP1.stevendouglas.local",
  database: "SDC",
  user: process.env.TOTALETO_DB_USER,
  password: process.env.TOTALETO_DB_PASSWORD,
  domain: "stevendouglas",
  port: 1433,
  options: { trustServerCertificate: true, encrypt: false },
  connectionTimeout: 15000,
  requestTimeout: 120000,
};

// Recursive BOM explosion. Each row carries a unique instance `path` (of
// StructureIDs) so a part used under multiple assemblies stays distinct.
const BOM_SQL = `
WITH roots AS (
  SELECT DISTINCT b.SpecID, b.ParentID AS rootId
  FROM vwEngBOM b
  WHERE b.ProjectID = @job
    AND b.ParentID NOT IN (SELECT ChildID FROM vwEngBOM WHERE ProjectID = @job)
),
tree AS (
  SELECT b.SpecID, b.StructureID, b.ChildID AS nodeId, 1 AS lvl,
         CAST('/' + CAST(b.StructureID AS VARCHAR(20)) AS VARCHAR(MAX)) AS path,
         b.ItemCompanyID, b.ItemDescription, b.ItemQty, b.ItemLastCost
  FROM vwEngBOM b JOIN roots r ON r.SpecID = b.SpecID AND b.ParentID = r.rootId
  WHERE b.ProjectID = @job
  UNION ALL
  SELECT b.SpecID, b.StructureID, b.ChildID, t.lvl + 1,
         CAST(t.path + '/' + CAST(b.StructureID AS VARCHAR(20)) AS VARCHAR(MAX)),
         b.ItemCompanyID, b.ItemDescription, b.ItemQty, b.ItemLastCost
  FROM vwEngBOM b JOIN tree t ON b.ProjectID = @job AND b.SpecID = t.SpecID AND b.ParentID = t.nodeId
)
SELECT SpecID, path, ItemCompanyID, ItemDescription, ItemQty, ItemLastCost
FROM tree
OPTION (MAXRECURSION 32767)`;

type Row = {
  SpecID: number;
  path: string;
  ItemCompanyID: string | null;
  ItemDescription: string | null;
  ItemQty: number | null;
  ItemLastCost: number | null;
};

export async function getJobBom(jobId: string): Promise<JobBom> {
  const numericJob = Number(String(jobId).replace(/[^0-9]/g, ""));
  if (!Number.isFinite(numericJob) || numericJob === 0) {
    return { jobId: String(jobId), roots: [], grandTotalCost: 0, grandTotalPartQty: 0, rowCount: 0 };
  }

  const pool = await sql.connect(config);
  let rows: Row[];
  try {
    const result = await pool.request().input("job", sql.Int, numericJob).query(BOM_SQL);
    rows = result.recordset as Row[];
  } finally {
    await pool.close();
  }

  // Which instance paths are parents (have at least one child path)? Everything
  // else is a leaf — only leaves carry cost (assemblies roll up from parts, and
  // their own ItemLastCost is an already-rolled figure we must not double count).
  const isParent = new Set<string>();
  for (const r of rows) {
    const seg = r.path.split("/");
    seg.pop();
    const parent = seg.join("/");
    if (parent) isParent.add(parent);
  }

  const label = (r: Row) => {
    const part = (r.ItemCompanyID ?? "").trim();
    const desc = (r.ItemDescription ?? "").replace(/\s+/g, " ").trim();
    return desc ? (part ? `${part} — ${desc}` : desc) : part;
  };

  // One synthetic section node per SpecID (the report's "TOP {job}-{spec}").
  const sections = new Map<number, BomNode>();
  const nodeByPath = new Map<string, BomNode>();
  const roots: BomNode[] = [];
  let rowCount = 0;

  for (const r of rows) {
    rowCount++;
    const leaf = !isParent.has(r.path);
    const qty = Number(r.ItemQty) || 0;
    const unit = Number(r.ItemLastCost) || 0;
    const node: BomNode = {
      key: r.path,
      depth: 0, // set below
      label: label(r),
      isAssembly: !leaf,
      partQty: qty,
      unitCost: unit,
      extendedCost: leaf ? unit * qty : 0,
      totalCost: 0,
      totalPartQty: 0,
      nestedAssemblies: 0,
      children: [],
    };
    nodeByPath.set(r.path, node);

    const seg = r.path.split("/");
    seg.pop();
    const parentPath = seg.join("/");
    const parent = parentPath ? nodeByPath.get(parentPath) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      // Top of a spec → hang under that section node.
      let section = sections.get(r.SpecID);
      if (!section) {
        section = {
          key: `S${r.SpecID}`,
          depth: 1,
          label: `TOP ${numericJob}-${r.SpecID} — Section ${r.SpecID}`,
          isAssembly: true,
          partQty: 0,
          unitCost: 0,
          extendedCost: 0,
          totalCost: 0,
          totalPartQty: 0,
          nestedAssemblies: 0,
          children: [],
        };
        sections.set(r.SpecID, section);
        roots.push(section);
      }
      section.children.push(node);
    }
  }

  roots.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  // Assign depth (section = 1) and roll up cost / qty / nested-assembly counts.
  const walk = (n: BomNode, depth: number): void => {
    n.depth = depth;
    let cost = n.extendedCost;
    let pq = n.partQty;
    let nested = 0;
    for (const c of n.children) {
      walk(c, depth + 1);
      cost += c.totalCost;
      pq += c.totalPartQty;
      nested += c.nestedAssemblies + (c.isAssembly ? 1 : 0);
    }
    n.totalCost = cost;
    n.totalPartQty = pq;
    n.nestedAssemblies = nested;
  };
  roots.forEach((n) => walk(n, 1));

  const grandTotalCost = roots.reduce((s, n) => s + n.totalCost, 0);
  const grandTotalPartQty = roots.reduce((s, n) => s + n.totalPartQty, 0);

  return { jobId: String(jobId), roots, grandTotalCost, grandTotalPartQty, rowCount };
}
