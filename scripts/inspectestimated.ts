import * as XLSX from "xlsx";
import path from "path";

const wb = XLSX.readFile(path.join("D:/AI Projects/sheets", "Project Planner Data Control.xlsx"), { cellFormula: false });
const ws = wb.Sheets["Estimated Hours"];
if (!ws) {
  console.log("No 'Estimated Hours' sheet");
} else {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
  console.log("Total rows:", rows.length);
  console.log("Row 0 (first 15 cols):", JSON.stringify(rows[0]?.slice(0, 15)));
  console.log("Row 1 (first 15 cols):", JSON.stringify(rows[1]?.slice(0, 15)));
  console.log("Total cols in row 0:", rows[0]?.length);
}
