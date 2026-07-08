import * as XLSX from "xlsx";
import path from "path";

const SHEETS_DIR = "D:/AI Projects/sheets";
const wb = XLSX.readFile(path.join(SHEETS_DIR, "End Of Month ETC Sheet.xlsx"), { cellFormula: false });
const ws = wb.Sheets["Managers Fill Out"];
const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];

for (let i = 0; i <= 6 && i < data.length; i++) {
  console.log(`Row ${i}:`, JSON.stringify(data[i]));
  console.log("---");
}
console.log("\nFirst data row (row 6):", JSON.stringify(data[6]));
console.log("Row 7:", JSON.stringify(data[7]));
