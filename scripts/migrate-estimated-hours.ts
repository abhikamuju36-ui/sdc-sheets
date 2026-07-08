// Read-only migration: pulls Quoted / Actual Historical / Estimate to Complete hours
// by section, per-employee task assignments, cost figures, and job dates from
// Project Planner Data Control.xlsx's "Estimated Hours" tab.
// Never writes to the source file.
import * as XLSX from "xlsx";
import path from "path";
import { PrismaClient } from "@prisma/client";

const SHEETS_DIR = "D:/AI Projects/sheets";
const prisma = new PrismaClient();

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function excelDate(v: unknown): Date | null {
  if (v == null) return null;
  const serial = Number(v);
  if (!Number.isFinite(serial)) return null;
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
}

// Confirmed via inspection (rows 0-6 header, data from row 8):
// col 0 Job#, 1 Description, 2 Status, 3 Start Date, 4 Complete Date, 5 Customer,
// 6 Include in Type Calc, 7 Type
// col 9-25:  Quoted hours (17 section columns)
// col 27-43: Actual Hours Historical (same 17 section columns)
// col 45-61: Estimate to Complete (same 17 section columns)
// col 63-73: ME Name (11 free-text task slots)
// col 75-85: ME Estimate to Complete (11 matching hour values)
// col 87: Cost Quoted, col 88: Cost Actual Historical
const SECTION_COLS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
const SECTION_LABELS_ROW = 6; // e.g. "10-111"
const QUOTED_OFFSET = 0;
const ACTUAL_HIST_OFFSET = 27 - 9;
const ETC_OFFSET = 45 - 9;

async function main() {
  const wb = XLSX.readFile(path.join(SHEETS_DIR, "Project Planner Data Control.xlsx"), { cellFormula: false });
  const ws = wb.Sheets["Estimated Hours"];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];

  const sectionLabels = SECTION_COLS.map((c) => String(rows[SECTION_LABELS_ROW][c]));

  let jobsUpdated = 0;
  let sectionRowsUpserted = 0;
  let tasksUpserted = 0;

  for (let i = 8; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row[0] !== "number") continue;

    const jobId = String(row[0]);
    const jobName = String(row[1] ?? "");
    const status = String(row[2] ?? "Active");
    const startDate = excelDate(row[3]);
    const completeDate = excelDate(row[4]);
    const customer = row[5] != null ? String(row[5]) : null;
    const includeInTypeCalc = row[6] === "Y";
    const type = row[7] != null ? String(row[7]) : null;
    const costQuoted = row[87] != null ? num(row[87]) : null;
    const costActualHistorical = row[88] != null ? num(row[88]) : null;

    const job = await prisma.job.upsert({
      where: { jobId },
      update: { status, customer, type, startDate, completeDate, includeInTypeCalc, costQuoted, costActualHistorical },
      create: {
        jobId,
        jobName,
        status,
        customer,
        type,
        startDate,
        completeDate,
        includeInTypeCalc,
        costQuoted,
        costActualHistorical,
        source: "migration",
      },
    });
    jobsUpdated++;

    for (let s = 0; s < SECTION_COLS.length; s++) {
      const section = sectionLabels[s];
      const quotedHours = num(row[SECTION_COLS[s] + QUOTED_OFFSET]);
      const actualHistoricalHours = num(row[SECTION_COLS[s] + ACTUAL_HIST_OFFSET]);
      const estimateToCompleteHours = num(row[SECTION_COLS[s] + ETC_OFFSET]);
      if (quotedHours === 0 && actualHistoricalHours === 0 && estimateToCompleteHours === 0) continue;

      await prisma.estimatedHours.upsert({
        where: { jobId_section: { jobId: job.id, section } },
        update: { quotedHours, actualHistoricalHours, estimateToCompleteHours },
        create: { jobId: job.id, section, quotedHours, actualHistoricalHours, estimateToCompleteHours },
      });
      sectionRowsUpserted++;
    }

    for (let slot = 1; slot <= 11; slot++) {
      const nameCol = 62 + slot; // 63..73
      const hoursCol = 74 + slot; // 75..85
      const taskName = row[nameCol];
      const hours = row[hoursCol];
      if (taskName == null || String(taskName).trim() === "") continue;

      await prisma.jobTask.upsert({
        where: { jobId_slot: { jobId: job.id, slot } },
        update: { taskName: String(taskName), estimateToCompleteHours: num(hours) },
        create: { jobId: job.id, slot, taskName: String(taskName), estimateToCompleteHours: num(hours) },
      });
      tasksUpserted++;
    }
  }

  console.log(`Jobs upserted (dates/cost/type): ${jobsUpdated}`);
  console.log(`EstimatedHours rows upserted: ${sectionRowsUpserted}`);
  console.log(`JobTask rows upserted: ${tasksUpserted}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
