import * as XLSX from "xlsx";
import path from "path";

const wb = XLSX.readFile(path.join("D:/AI Projects/sheets", "End Of Month ETC Sheet.xlsx"), { cellFormula: false });
const ws = wb.Sheets["Managers Fill Out"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];

for (let i = 6; i < rows.length; i++) {
  const row = rows[i];
  if (!row) continue;
  if (row.some((v) => v === 1197 || v === 995 || v === 309)) {
    console.log(`Row ${i}: Job Id=${row[0]}, Name=${row[1]}, Status=${row[2]}`);
  }
}
console.log(`\nTotal data rows: ${rows.length - 6}`);
