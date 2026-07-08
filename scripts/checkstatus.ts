import * as XLSX from "xlsx";
import path from "path";

const wb = XLSX.readFile(path.join("D:/AI Projects/sheets", "Standard Fees.xlsx"), { cellFormula: false });
const ws = wb.Sheets["Standard Fees"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];

const statuses = new Set<string>();
for (let i = 8; i < rows.length; i++) {
  const row = rows[i];
  if (!row || typeof row[0] !== "number") continue;
  statuses.add(String(row[2]));
}
console.log("Distinct statuses in Standard Fees.xlsx job table:", [...statuses]);
