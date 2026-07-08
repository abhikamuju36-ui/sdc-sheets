import * as XLSX from "xlsx";
import path from "path";

const wb = XLSX.readFile(path.join("D:/AI Projects/sheets", "Project Planner Data Control.xlsx"), { cellFormula: false });
console.log("Sheets:", wb.SheetNames);

for (const sheetName of ["Managers Fill Out", "ETC Export"]) {
  const ws = wb.Sheets[sheetName];
  if (!ws) continue;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
  const statuses = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (typeof row[0] === "number" && typeof row[2] === "string") statuses.add(row[2]);
  }
  console.log(`${sheetName}: distinct statuses =`, [...statuses], `(${rows.length} rows)`);
}
