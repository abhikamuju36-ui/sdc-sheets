import * as XLSX from "xlsx";
import path from "path";

const wb = XLSX.readFile(path.join("D:/AI Projects/sheets", "Project Planner Data Control.xlsx"), { cellFormula: false });

for (const sheetName of ["ETC 2025-02", "ETC 2025-03", "ETC 2025-05", "ETC 2025-06", "ETC 2025-07", "ETC 2025-08"]) {
  const ws = wb.Sheets[sheetName];
  if (!ws) continue;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
  const header = rows[0] as unknown[];
  const statusCol = header.findIndex((h) => h === "Status");
  if (statusCol === -1) {
    console.log(`${sheetName}: no "Status" column at row 0 (different layout)`);
    continue;
  }
  const statuses = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row[statusCol] == null) continue;
    statuses.add(String(row[statusCol]));
  }
  console.log(`${sheetName}: statuses =`, [...statuses], `(${rows.length - 1} rows)`);
}
