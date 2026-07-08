// Read-only migration: pulls Job status/customer/type + historical ETC-by-cost-code
// snapshots from Project Planner Data Control.xlsx's monthly archive tabs
// (ETC 2025-03, ETC 2025-05, ETC 2025-06 — the only ones with a "Status" column).
// Never writes to the source file.
import * as XLSX from "xlsx";
import path from "path";
import { PrismaClient } from "@prisma/client";

const SHEETS_DIR = "D:/AI Projects/sheets";
const prisma = new PrismaClient();

const ARCHIVE_SHEETS: { sheet: string; month: string }[] = [
  { sheet: "ETC 2025-03", month: "2025-03" },
  { sheet: "ETC 2025-05", month: "2025-05" },
  { sheet: "ETC 2025-06", month: "2025-06" },
];

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const wb = XLSX.readFile(path.join(SHEETS_DIR, "Project Planner Data Control.xlsx"), { cellFormula: false });

  let jobsUpdated = 0;
  let entriesCreated = 0;
  let completedCount = 0;

  for (const { sheet, month } of ARCHIVE_SHEETS) {
    const ws = wb.Sheets[sheet];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
    const header = rows[0] as string[];

    const jobCol = header.indexOf("Job#");
    const nameCol = header.indexOf("Description");
    const statusCol = header.indexOf("Status");
    const customerCol = header.indexOf("Customer");
    const typeCol = header.indexOf("Type");

    // Cost-code columns are everything between "Type" and "Total Engr" (skipping blanks).
    const totalEngrCol = header.indexOf("Total Engr");
    const costCodeCols = header
      .map((h, i) => ({ h, i }))
      .filter(({ h, i }) => i > typeCol && i < totalEngrCol && h != null);

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || typeof row[jobCol] !== "number") continue;

      const jobId = String(row[jobCol]);
      const jobName = String(row[nameCol] ?? "");
      const status = String(row[statusCol] ?? "Active");
      const customer = row[customerCol] != null ? String(row[customerCol]) : null;
      const type = row[typeCol] != null ? String(row[typeCol]) : null;
      if (status === "Complete") completedCount++;

      const job = await prisma.job.upsert({
        where: { jobId },
        update: { status, customer, type },
        create: { jobId, jobName, status, customer, type, source: "migration" },
      });
      jobsUpdated++;

      for (const { h: section, i: col } of costCodeCols) {
        const hours = num(row[col]);
        if (hours === 0) continue; // skip empty cells, matches earlier migration's noise filter

        await prisma.etcEntry.upsert({
          where: { jobId_section_month: { jobId: job.id, section, month } },
          update: { newEtc: hours, needsReview: false },
          create: {
            jobId: job.id,
            section,
            month,
            priorEtc: 0,
            hoursWorked: 0,
            hoursLeftCalc: hours,
            newEtc: hours,
            needsReview: false,
          },
        });
        entriesCreated++;
      }
    }
    console.log(`${sheet}: processed`);
  }

  console.log(`\nJobs upserted (status/customer/type): ${jobsUpdated}`);
  console.log(`ETC entries created/updated: ${entriesCreated}`);
  console.log(`Completed-status rows seen: ${completedCount}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
