import * as XLSX from "xlsx";
import path from "path";

const SHEETS_DIR = "D:/AI Projects/sheets";

function inspect(file: string, sheetName: string, from: number, to: number) {
  const wb = XLSX.readFile(path.join(SHEETS_DIR, file), { cellFormula: false });
  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
  console.log(`\n=== ${file} :: ${sheetName} rows ${from}-${to} ===`);
  for (let i = from; i <= to && i < data.length; i++) {
    console.log(`Row ${i}:`, JSON.stringify(data[i]));
  }
}

inspect("Standard Fees.xlsx", "Standard Fees", 5, 12);
