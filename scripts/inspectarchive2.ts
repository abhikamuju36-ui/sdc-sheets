import * as XLSX from "xlsx";
import path from "path";

const wb = XLSX.readFile(path.join("D:/AI Projects/sheets", "Project Planner Data Control.xlsx"), { cellFormula: false });
const ws = wb.Sheets["ETC 2025-06"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
console.log("Header:", JSON.stringify(rows[0]));
console.log("Row 1:", JSON.stringify(rows[1]));
console.log("Total rows:", rows.length);
