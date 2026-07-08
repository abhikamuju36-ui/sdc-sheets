import * as XLSX from "xlsx";
import path from "path";

const SHEETS_DIR = "D:/AI Projects/sheets";

function inspect(file: string, sheetName: string, rows = 3) {
  const wb = XLSX.readFile(path.join(SHEETS_DIR, file), { cellFormula: false });
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    console.log(`--- ${file} :: ${sheetName} NOT FOUND ---`);
    console.log("Available:", wb.SheetNames.join(", "));
    return;
  }
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
  console.log(`\n=== ${file} :: ${sheetName} (${data.length} rows) ===`);
  for (let i = 0; i < Math.min(rows, data.length); i++) {
    console.log(`Row ${i}:`, JSON.stringify(data[i]).slice(0, 500));
  }
}

inspect("Standard Fees.xlsx", "Standard Fees", 5);
inspect("Project Planner Data Control.xlsx", "Employees", 5);
inspect("End Of Month ETC Sheet.xlsx", "Managers Fill Out", 3);
