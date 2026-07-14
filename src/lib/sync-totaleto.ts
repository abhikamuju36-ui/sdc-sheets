import sql from "mssql";
import { prisma } from "@/lib/prisma";
import { VALID_JOB_TYPES } from "@/lib/job-filters";

const config: sql.config = {
  server: "SERVER-APP1.stevendouglas.local",
  database: "SDC",
  user: "akamuju",
  password: "Voltages84gilds$",
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
