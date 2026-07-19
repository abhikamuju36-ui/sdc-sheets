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
