import sql from "mssql";
import { prisma } from "@/lib/prisma";
import { VALID_JOB_TYPES } from "@/lib/job-filters";

// The exact query Power BI's 'Part Purchase' table runs against this same
// SQL server (extracted verbatim from the semantic model's TMDL). Verified
// 2026-07-19: aggregated by job and windowed on Invoiced Date, this matches
// Power BI's own [Part Cost Purchased] to the dollar for every real project
// job across Mar/Apr/May 2026 — the only divergences were non-project
// pseudo-IDs (spare-parts/service buckets) that Power BI's model excludes
// anyway and that never map to an app Job. Pulling this directly removes the
// last Power BI / data-gateway dependency for the live ETC month's parts.
const PART_PURCHASE_SQL = `-- Part Costs
SELECT
     [P].[ProjectID] as [Job ID]
    ,POD.[SpecID] as [Section ID]
    ,CASE WHEN POD.PurchaseQty >=0 THEN
        CASE WHEN InvoicedQty > (CASE WHEN RLS.SumOfQtyReceived >= POD.PurchaseQty THEN RLS.SumOfQtyReceived ELSE POD.PurchaseQty END)
             THEN 0
             ELSE ((CASE WHEN RLS.SumOfQtyReceived >= POD.PurchaseQty THEN RLS.SumOfQtyReceived ELSE POD.PurchaseQty END) - ISNULL(InvoicedQty,0))
        END * POD.PurchasePrice * POH.PurchaseCurrRate
    ELSE
        CASE WHEN InvoicedQty < (CASE WHEN RLS.SumOfQtyReceived >= POD.PurchaseQty THEN RLS.SumOfQtyReceived ELSE POD.PurchaseQty END)
             THEN 0
             ELSE ((CASE WHEN RLS.SumOfQtyReceived <= POD.PurchaseQty THEN RLS.SumOfQtyReceived ELSE POD.PurchaseQty END) - ISNULL(InvoicedQty,0))
        END * POD.PurchasePrice * POH.PurchaseCurrRate
    END + ISNULL(INVOICED.TotalInvoicedAmount, 0) AS [Total Price]
    ,INVOICED.[APDocDate] as [Invoiced Date]
FROM tblPurchaseOrderHeader POH with(nolock)
    INNER JOIN tblPurchaseOrderDetails POD with(nolock) ON POH.PurchaseOrderID = POD.PurchaseOrderID
    LEFT JOIN tblSpec S with(nolock) ON S.SpecID = POD.SpecID AND S.ProjectID = POD.ProjectID
    LEFT JOIN tblProjects P with(nolock) ON S.ProjectID = P.ProjectID
    LEFT JOIN ( SELECT APDD.PurchaseDetailID, BatchEntryTypeID, max(APDocDate) as APDocDate, SUM(APDocQty) AS InvoicedQty,
                    SUM(APDocQty * APDocUnitPrice * (1 - APDocItemPctDisc) * APDocCurrRate) AS TotalInvoicedAmount
                    FROM tblAPDocumentDetails APDD with(nolock)
                        INNER JOIN tblAPBatchDocument APBD with(nolock) ON APBD.APDocID = APDD.APDocID
                    WHERE BatchEntryTypeID NOT IN (2, 3) AND APDD.PurchaseDetailID IS NOT NULL
                    GROUP BY APDD.PurchaseDetailID, BatchEntryTypeID
                ) INVOICED ON POD.PurchaseDetailID = INVOICED.PurchaseDetailID
    LEFT JOIN vwReceiverLogSummed RLS with(nolock) ON RLS.PurchaseDetailID = POD.PurchaseDetailID

UNION ALL

-- Extra Costs
SELECT
     [EC].[ProjectID] as [Job ID]
    ,[EC].[SpecID] as [Section ID]
    ,[EC].[decExtraCostingValue] as [Total Price]
    ,[EC].[APDocDate] as [Invoiced Date]
FROM [dbo].[vwCostingExtraCostsDetailed] [EC] WITH(NOLOCK)`;

// Parts Cost "Money Spent this month" per job, straight from TotalETO —
// SUM(Total Price) for rows whose Invoiced Date falls in [monthStart,
// monthEndExclusive). Keyed by numeric Job Id string (e.g. "1150"), matching
// how the rest of the app keys jobs. A longer request timeout than the
// project sync since this query fans out across the full PO/AP history.
export async function getPartsCostSpentByJob(monthStart: Date, monthEndExclusive: Date): Promise<Map<string, number>> {
  const pool = await sql.connect({ ...config, requestTimeout: 120000 });
  try {
    const result = await pool
      .request()
      .input("start", sql.DateTime, monthStart)
      .input("end", sql.DateTime, monthEndExclusive)
      .query(
        `WITH pp AS (\n${PART_PURCHASE_SQL}\n)\n` +
          `SELECT [Job ID] AS JobId, SUM([Total Price]) AS Spent FROM pp ` +
          `WHERE [Invoiced Date] >= @start AND [Invoiced Date] < @end AND [Job ID] IS NOT NULL ` +
          `GROUP BY [Job ID]`
      );
    const map = new Map<string, number>();
    for (const r of result.recordset) {
      const spent = Number(r.Spent);
      if (Number.isFinite(spent)) map.set(String(Number(r.JobId)), spent);
    }
    return map;
  } finally {
    await pool.close();
  }
}

// ── Per-job Parts Cost detail (live) — for the Job Hour Details dashboard ────
// Per-part line items + rollups, straight from TotalETO, mirroring the Power BI
// "Parts Cost" table. Part Costs branch joins supplier (tblCompany), item
// master (manufacturer / part# / category); Extra Costs branch (fees, shipping,
// tariffs) comes from vwCostingExtraCostsDetailed.
export type PartsCostLine = {
  purchaseDate: string | null;
  invoicedDate: string | null;
  supplier: string | null;
  manufacturer: string | null;
  category: string | null;
  poNumber: string | null;
  partNumber: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number; // "Purchased"
  invoicedAmount: number; // "Paid"
};

export type JobPartsCost = {
  purchased: number;
  paid: number;
  leftToPay: number;
  lines: PartsCostLine[];
};

// Per-line "purchased" amount — the same remaining-uninvoiced + invoiced formula
// PART_PURCHASE_SQL aggregates, kept per line here.
const LINE_TOTAL_PRICE = `
  CASE WHEN POD.PurchaseQty >= 0 THEN
    CASE WHEN ISNULL(INV.InvoicedQty,0) > (CASE WHEN RLS.SumOfQtyReceived >= POD.PurchaseQty THEN RLS.SumOfQtyReceived ELSE POD.PurchaseQty END)
      THEN 0
      ELSE ((CASE WHEN RLS.SumOfQtyReceived >= POD.PurchaseQty THEN RLS.SumOfQtyReceived ELSE POD.PurchaseQty END) - ISNULL(INV.InvoicedQty,0))
    END * POD.PurchasePrice * POH.PurchaseCurrRate
  ELSE
    CASE WHEN ISNULL(INV.InvoicedQty,0) < (CASE WHEN RLS.SumOfQtyReceived >= POD.PurchaseQty THEN RLS.SumOfQtyReceived ELSE POD.PurchaseQty END)
      THEN 0
      ELSE ((CASE WHEN RLS.SumOfQtyReceived <= POD.PurchaseQty THEN RLS.SumOfQtyReceived ELSE POD.PurchaseQty END) - ISNULL(INV.InvoicedQty,0))
    END * POD.PurchasePrice * POH.PurchaseCurrRate
  END + ISNULL(INV.TotalInvoicedAmount, 0)`;

const PARTS_DETAIL_SQL = `
SELECT
   CONVERT(varchar(10), POH.PurchaseDate, 23) AS PurchaseDate
  ,CONVERT(varchar(10), INV.APDocDate, 23) AS InvoicedDate
  ,SUP.CName AS Supplier
  ,IM.Manufacturer AS Manufacturer
  ,CAT.CategoryDescription AS Category
  ,CAST(POH.PurchaseOrderID AS varchar(32)) AS PONumber
  ,COALESCE(NULLIF(POD.PurchaseSupplierItem,''), IM.ManufacturerPartNumber) AS PartNumber
  ,COALESCE(NULLIF(POD.PurchaseSupplierDescription,''), IM.ItemDescription) AS Description
  ,POD.PurchaseQty AS Qty
  ,(POD.PurchasePrice * POH.PurchaseCurrRate) AS UnitPrice
  ,(${LINE_TOTAL_PRICE}) AS TotalPrice
  ,ISNULL(INV.TotalInvoicedAmount, 0) AS InvoicedAmount
FROM tblPurchaseOrderHeader POH WITH(NOLOCK)
  INNER JOIN tblPurchaseOrderDetails POD WITH(NOLOCK) ON POH.PurchaseOrderID = POD.PurchaseOrderID
  LEFT JOIN tblCompany SUP WITH(NOLOCK) ON SUP.CompanyID = POH.PurchaseSupplierID
  LEFT JOIN tblEngItemMaster IM WITH(NOLOCK) ON IM.ItemID = POD.ItemID
  LEFT JOIN tlkpItemMaster_Categories CAT WITH(NOLOCK) ON CAT.ItemCategory = IM.ItemCategory
  LEFT JOIN ( SELECT APDD.PurchaseDetailID, max(APDocDate) AS APDocDate, SUM(APDocQty) AS InvoicedQty,
                SUM(APDocQty * APDocUnitPrice * (1 - APDocItemPctDisc) * APDocCurrRate) AS TotalInvoicedAmount
              FROM tblAPDocumentDetails APDD WITH(NOLOCK)
                INNER JOIN tblAPBatchDocument APBD WITH(NOLOCK) ON APBD.APDocID = APDD.APDocID
              WHERE BatchEntryTypeID NOT IN (2, 3) AND APDD.PurchaseDetailID IS NOT NULL
              GROUP BY APDD.PurchaseDetailID ) INV ON POD.PurchaseDetailID = INV.PurchaseDetailID
  LEFT JOIN vwReceiverLogSummed RLS WITH(NOLOCK) ON RLS.PurchaseDetailID = POD.PurchaseDetailID
WHERE POD.ProjectID = @job

UNION ALL

SELECT
   CONVERT(varchar(10), EC.APDocDate, 23) AS PurchaseDate
  ,CONVERT(varchar(10), EC.APDocDate, 23) AS InvoicedDate
  ,EC.Vendor AS Supplier
  ,NULL AS Manufacturer
  ,EC.APDocDesc AS Category
  ,CAST(EC.APDocNumber AS varchar(32)) AS PONumber
  ,EC.PurchaseSupplierItem AS PartNumber
  ,EC.APDocItemDesc AS Description
  ,EC.APDocQty AS Qty
  ,(EC.APDocUnitPrice * EC.APDocCurrRate) AS UnitPrice
  ,EC.decExtraCostingValue AS TotalPrice
  ,EC.decExtraCostingValue AS InvoicedAmount
FROM vwCostingExtraCostsDetailed EC WITH(NOLOCK)
WHERE EC.ProjectID = @job`;

export async function getJobPartsCost(jobId: string): Promise<JobPartsCost> {
  const numericJob = Number(jobId);
  if (!Number.isFinite(numericJob)) return { purchased: 0, paid: 0, leftToPay: 0, lines: [] };
  const pool = await sql.connect({ ...config, requestTimeout: 120000 });
  try {
    const result = await pool.request().input("job", sql.Int, numericJob).query(PARTS_DETAIL_SQL);
    const lines: PartsCostLine[] = result.recordset.map((r) => ({
      purchaseDate: r.PurchaseDate ?? null,
      invoicedDate: r.InvoicedDate ?? null,
      supplier: r.Supplier ?? null,
      manufacturer: r.Manufacturer ?? null,
      category: r.Category ?? null,
      poNumber: r.PONumber ?? null,
      partNumber: r.PartNumber ?? null,
      description: r.Description ?? null,
      quantity: Number(r.Qty) || 0,
      unitPrice: Number(r.UnitPrice) || 0,
      totalPrice: Number(r.TotalPrice) || 0,
      invoicedAmount: Number(r.InvoicedAmount) || 0,
    }));
    // Sort newest purchase first; drop fully-zero noise rows.
    const meaningful = lines.filter((l) => l.totalPrice !== 0 || l.invoicedAmount !== 0 || l.quantity !== 0);
    meaningful.sort((a, b) => (b.purchaseDate ?? "").localeCompare(a.purchaseDate ?? ""));
    const purchased = meaningful.reduce((s, l) => s + l.totalPrice, 0);
    const paid = meaningful.reduce((s, l) => s + l.invoicedAmount, 0);
    return { purchased, paid, leftToPay: purchased - paid, lines: meaningful };
  } finally {
    await pool.close();
  }
}

// Credentials come from the environment, same as every other integration in
// this app (Power BI, Auth, Standard Sheet password) — this was previously
// the one exception, with a live username/password hardcoded in this file.
// Set TOTALETO_DB_USER / TOTALETO_DB_PASSWORD in .env (gitignored).
const config: sql.config = {
  server: "SERVER-APP1.stevendouglas.local",
  database: "SDC",
  user: process.env.TOTALETO_DB_USER,
  password: process.env.TOTALETO_DB_PASSWORD,
  domain: "stevendouglas",
  port: 1433,
  options: { trustServerCertificate: true, encrypt: false },
  connectionTimeout: 15000,
  requestTimeout: 30000,
};

interface TotalEtoProject {
  "Job ID": number;
  Description: string;
  Customer: string | null;
  Status: string;
}

interface TotalEtoCosting {
  "Job ID": number;
  EstEngHours: number | null;
  ActEngHours: number | null;
  EstMfgHours: number | null;
  ActMfgHours: number | null;
}

// Pulls active ("Sold") projects + actuals-vs-estimates costing from the
// TotalETO production database (vwProjects / vwProjectActualsVSEstimates —
// the same views the TotalETO MCP connector uses) and upserts into Job.
//
// TotalETO has no project "Type" (Custom/Duplicate/Hybrid/Service) field —
// that classification only exists in the spreadsheet-derived data. Per
// requirement, jobs with no Type must never be imported or shown, so this
// sync only UPDATES jobs that already exist with a valid Type; it never
// creates a new job (which would necessarily have Type = null).
export async function syncFromTotalEto(): Promise<{ jobsUpdated: number; skippedNoType: number }> {
  const pool = await sql.connect(config);
  try {
    const projects = await pool.request().query<TotalEtoProject>(`
      SELECT
        P.ProjectID AS [Job ID],
        P.PDescription AS [Description],
        P.CName AS [Customer],
        P.PStatus AS [Status]
      FROM vwProjects P WITH(NOLOCK)
      WHERE P.PStatus = 'Sold'
      ORDER BY P.PDelivery ASC
    `);

    const costing = await pool.request().query<TotalEtoCosting>(`
      SELECT
        C.ProjectID AS [Job ID],
        C.EstEngHours, C.ActEngHours, C.EstMfgHours, C.ActMfgHours
      FROM vwProjectActualsVSEstimates C WITH(NOLOCK)
      WHERE C.ProjectID IN (SELECT ProjectID FROM tblProjects WITH(NOLOCK) WHERE PStatus = 'Sold')
    `);
    const costingByJobId = new Map(costing.recordset.map((c) => [c["Job ID"], c]));

    const existingJobs = await prisma.job.findMany({
      where: { jobId: { in: projects.recordset.map((p) => String(p["Job ID"])) }, type: { in: [...VALID_JOB_TYPES] } },
      select: { jobId: true, customerManuallyEdited: true },
    });
    const existingJobIds = new Set(existingJobs.map((j) => j.jobId));
    // A manager's manual Customer edit on the Projects tab must survive this
    // sync instead of being silently overwritten — see customerManuallyEdited.
    const manuallyEditedJobIds = new Set(existingJobs.filter((j) => j.customerManuallyEdited).map((j) => j.jobId));

    let jobsUpdated = 0;
    let skippedNoType = 0;
    const now = new Date();
    for (const p of projects.recordset) {
      const jobId = String(p["Job ID"]);
      if (!existingJobIds.has(jobId)) {
        skippedNoType++;
        continue;
      }
      const c = costingByJobId.get(p["Job ID"]);

      await prisma.job.update({
        where: { jobId },
        data: {
          ...(manuallyEditedJobIds.has(jobId) ? {} : { customer: p.Customer }),
          totEtoEstEngHours: c?.EstEngHours ?? undefined,
          totEtoActEngHours: c?.ActEngHours ?? undefined,
          totEtoEstMfgHours: c?.EstMfgHours ?? undefined,
          totEtoActMfgHours: c?.ActMfgHours ?? undefined,
          totEtoSyncedAt: now,
        },
      });
      jobsUpdated++;
    }

    return { jobsUpdated, skippedNoType };
  } finally {
    await pool.close();
  }
}
