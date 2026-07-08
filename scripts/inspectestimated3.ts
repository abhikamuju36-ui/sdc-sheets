import * as XLSX from "xlsx";
import path from "path";

const wb = XLSX.readFile(path.join("D:/AI Projects/sheets", "Project Planner Data Control.xlsx"), { cellFormula: false });
const ws = wb.Sheets["Estimated Hours"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];

console.log("Row 8 (first data row), cols 0-8:", JSON.stringify(rows[8]?.slice(0, 9)));
console.log("Row 8, cols 63-86 (ME task slots):", JSON.stringify(rows[8]?.slice(63, 86)));
console.log("Row 8, cols 87-89 (cost):", JSON.stringify(rows[8]?.slice(87, 89)));

// distinct "Include in Type Calc" and "Type" values
const includeVals = new Set<string>();
const typeVals = new Set<string>();
for (let i = 8; i < rows.length; i++) {
  const row = rows[i];
  if (!row || typeof row[0] !== "number") continue;
  includeVals.add(String(row[6]));
  typeVals.add(String(row[7]));
}
console.log("Include in Type Calc values:", [...includeVals]);
console.log("Type values:", [...typeVals]);
