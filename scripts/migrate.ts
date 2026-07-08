// Read-only migration: pulls from the three .xlsx files in D:/AI Projects/sheets
// and backfills sdc_etc_planner + sdc_standard_fees. Never writes to the source files.
import * as XLSX from "xlsx";
import path from "path";
import { PrismaClient as PlannerClient } from "@prisma/client";

const SHEETS_DIR = "D:/AI Projects/sheets";
const planner = new PlannerClient();

function readSheet(file: string, sheet: string): unknown[][] {
  const wb = XLSX.readFile(path.join(SHEETS_DIR, file), { cellFormula: false });
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error(`Sheet not found: ${file} :: ${sheet}`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function migrateEmployees() {
  const rows = readSheet("Project Planner Data Control.xlsx", "Employees");
  const header = rows[0] as string[];
  const idx = (name: string) => header.indexOf(name);
  let count = 0;
  for (const row of rows.slice(1)) {
    if (!row || row[idx("Employee Id")] == null) continue;
    const first = String(row[idx("First Name")] ?? "").trim();
    const last = String(row[idx("Last Name")] ?? "").trim();
    await planner.employee.upsert({
      where: { paylocityId: String(row[idx("Employee Id")]) },
      update: {
        name: `${first} ${last}`.trim(),
        department: row[idx("Department")] ? String(row[idx("Department")]) : null,
        billingGroup: row[idx("Billing Group")] ? String(row[idx("Billing Group")]) : null,
        active: row[idx("Is Active")] === "Yes",
      },
      create: {
        paylocityId: String(row[idx("Employee Id")]),
        name: `${first} ${last}`.trim(),
        department: row[idx("Department")] ? String(row[idx("Department")]) : null,
        billingGroup: row[idx("Billing Group")] ? String(row[idx("Billing Group")]) : null,
        active: row[idx("Is Active")] === "Yes",
      },
    });
    count++;
  }
  console.log(`Employees migrated: ${count}`);
}

async function migrateJobsAndRates() {
  const rows = readSheet("Standard Fees.xlsx", "Standard Fees");
  // Confirmed via inspection: header row 7 (0-indexed), data starts row 8.
  // Cols: 0 Job Id, 1 Job Name, 2 Job Status, 3 ENGR, 4 Shop, 5 Parts
  let count = 0;
  for (let i = 8; i < rows.length; i++) {
    const row = rows[i];
    // Real job rows have a numeric Job Id. Below the job table (~row 61+) the sheet
    // continues with unrelated summary sections whose col-0 text ("Engineering",
    // "Standard Fees By Department", ...) would otherwise be mistaken for a Job Id.
    if (!row || typeof row[0] !== "number") continue;
    const jobId = String(row[0]);
    const jobName = String(row[1] ?? "");
    const status = String(row[2] ?? "Active");
    const engrRate = num(row[3]);
    const shopRate = num(row[4]);
    const partsMarkup = num(row[5]);

    await planner.job.upsert({
      where: { jobId },
      update: { jobName, status, source: "migration" },
      create: { jobId, jobName, status, source: "migration" },
    });
    count++;
  }
  console.log(`Jobs migrated into sdc_etc_planner: ${count}`);
  return { rows, startRow: 8 };
}

// Auto-detects repeating 5-col ETC blocks (Prior ETC / Hours Worked / Hours Left / New ETC / Diff)
// by scanning the header row for "Prior ETC" markers, and labels each block using the
// nearest non-null cell in the rows above (section hierarchy).
function detectEtcBlocks(headerRows: unknown[][], headerRowIdx: number) {
  const header = headerRows[headerRowIdx] as unknown[];
  const blocks: { startCol: number; label: string }[] = [];
  for (let c = 0; c < header.length; c++) {
    if (header[c] === "Prior ETC") {
      const labelParts: string[] = [];
      for (let r = 0; r < headerRowIdx; r++) {
        for (let cc = c; cc >= 0; cc--) {
          const v = headerRows[r][cc];
          if (v != null && String(v).trim() !== "") {
            labelParts.push(String(v).trim());
            break;
          }
        }
      }
      blocks.push({ startCol: c, label: labelParts.join(" > ") || `col${c}` });
    }
  }
  return blocks;
}

async function migrateEtcEntries() {
  const rows = readSheet("End Of Month ETC Sheet.xlsx", "Managers Fill Out");
  const headerRowIdx = 5; // confirmed: Job Id/Job Name/Job Status/Prior ETC.../ row
  const blocks = detectEtcBlocks(rows, headerRowIdx);
  console.log(`Detected ${blocks.length} ETC section blocks`);

  const refreshedThruCell = String(rows[1]?.[1] ?? "");
  const match = refreshedThruCell.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const month = match ? `${match[3]}-${match[1]}` : "unknown";
  console.log(`Detected month from "${refreshedThruCell}": ${month}`);

  let entryCount = 0;
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row[0] !== "number") continue;
    const jobId = String(row[0]);
    const jobName = String(row[1] ?? "");
    const status = String(row[2] ?? "Active");

    const job = await planner.job.upsert({
      where: { jobId },
      update: {},
      create: { jobId, jobName, status, source: "migration" },
    });

    for (const block of blocks) {
      const priorEtc = num(row[block.startCol]);
      const hoursWorked = num(row[block.startCol + 1]);
      const hoursLeftCalc = num(row[block.startCol + 2]);
      const newEtc = num(row[block.startCol + 3]);
      // Skip fully-empty blocks (no activity recorded) to avoid noise.
      if (priorEtc === 0 && hoursWorked === 0 && newEtc === 0) continue;

      await planner.etcEntry.upsert({
        where: { jobId_section_month: { jobId: job.id, section: block.label.slice(0, 190), month } },
        update: { priorEtc, hoursWorked, hoursLeftCalc, newEtc, needsReview: false },
        create: {
          jobId: job.id,
          section: block.label.slice(0, 190),
          month,
          priorEtc,
          hoursWorked,
          hoursLeftCalc,
          newEtc,
          needsReview: false,
        },
      });
      entryCount++;
    }
  }
  console.log(`ETC entries migrated: ${entryCount}`);
}

async function main() {
  await migrateEmployees();
  await migrateJobsAndRates();
  await migrateEtcEntries();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => planner.$disconnect());
