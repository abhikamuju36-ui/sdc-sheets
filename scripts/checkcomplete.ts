import * as XLSX from "xlsx";
import path from "path";

const wb = XLSX.readFile(path.join("D:/AI Projects/sheets", "Project Planner Data Control.xlsx"), { cellFormula: false });
const ws = wb.Sheets["ETC 2025-06"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
const header = rows[0] as unknown[];
const statusCol = header.indexOf("Status");

const completed = rows.slice(1).filter((r) => r && r[statusCol] === "Complete");
console.log(`Completed jobs in ETC 2025-06: ${completed.length}`);
for (const r of completed.slice(0, 10)) {
  console.log(r.slice(0, 5));
}
