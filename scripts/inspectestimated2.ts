import * as XLSX from "xlsx";
import path from "path";

const wb = XLSX.readFile(path.join("D:/AI Projects/sheets", "Project Planner Data Control.xlsx"), { cellFormula: false });
const ws = wb.Sheets["Estimated Hours"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];

// Print all header rows fully (rows 0-6) to find block boundaries and column labels
for (let r = 0; r <= 6; r++) {
  console.log(`\n--- Row ${r} ---`);
  const row = rows[r] ?? [];
  for (let c = 0; c < row.length; c++) {
    if (row[c] != null) console.log(`  col ${c}: ${JSON.stringify(row[c])}`);
  }
}

console.log("\n--- Sample data row (row 7) ---");
console.log(JSON.stringify(rows[7]));
