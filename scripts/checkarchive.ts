import * as XLSX from "xlsx";
import path from "path";

const wb = XLSX.readFile(path.join("D:/AI Projects/sheets", "Project Planner Data Control.xlsx"), { cellFormula: false });

for (const sheetName of ["ETC 2025-02", "ETC 2025-05", "ETC 2025-08", "Managers Fill Out (old)"]) {
  const ws = wb.Sheets[sheetName];
  if (!ws) continue;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
  console.log(`\n=== ${sheetName} (${rows.length} rows) ===`);
  console.log("Row 0:", JSON.stringify(rows[0]).slice(0, 200));
  console.log("Row 1:", JSON.stringify(rows[1]).slice(0, 200));
  console.log("Row 2:", JSON.stringify(rows[2]).slice(0, 200));
}
