import * as XLSX from "xlsx";
import path from "path";

const wb = XLSX.readFile(path.join("D:/AI Projects/sheets", "Standard Fees.xlsx"), { cellFormula: false });
const ws = wb.Sheets["Standard Fees"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];

for (let i = 90; i < rows.length; i++) {
  console.log(`Row ${i}:`, JSON.stringify(rows[i]).slice(0, 300));
}
