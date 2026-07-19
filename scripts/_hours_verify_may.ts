import { PublicClientApplication } from "@azure/msal-node";
import { DataProtectionScope, PersistenceCreator, PersistenceCachePlugin } from "@azure/msal-node-extensions";
import path from "path"; import os from "os";
import * as XLSX from "xlsx";
import { runDax } from "../src/lib/powerbi-client";
import { prisma } from "../src/lib/prisma";
import { ETC_TRACKED_CODES } from "../src/lib/sections";
import { round2 } from "../src/lib/etc";

async function graphToken() {
  const persistence = await PersistenceCreator.createPersistence({ cachePath: path.join(os.homedir(), "AppData", "Local", "SdcPowerBiMcp", "msal_cache.bin"), dataProtectionScope: DataProtectionScope.CurrentUser, serviceName: "SdcPowerBiMcp", accountName: "SdcPowerBiMcp", usePlaintextFileOnLinux: false });
  const pca = new PublicClientApplication({ auth: { clientId: "1950a258-227b-4e31-a9cf-717495945fc2", authority: "https://login.microsoftonline.com/organizations" }, cache: { cachePlugin: new PersistenceCachePlugin(persistence) } });
  return (await pca.acquireTokenSilent({ account: (await pca.getTokenCache().getAllAccounts())[0], scopes: ["https://graph.microsoft.com/.default"] })).accessToken;
}
function serialYM(s: number) { const d = new Date(Date.UTC(1899,11,30)+s*86400000); return { y: d.getUTCFullYear(), m: d.getUTCMonth()+1 }; }

async function main() {
  const Y = 2026, MO = 5;
  const token = await graphToken();
  const H = { Authorization: `Bearer ${token}` };
  const siteId = (await (await fetch("https://graph.microsoft.com/v1.0/sites/stevendouglascorp.sharepoint.com:/sites/SDC-PowerBIIntegration", { headers: H })).json()).id;
  const dl = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${encodeURI("Project Planner V2/Job Hours Report/Job Hours From Paylocity/Current_Job_Hours.xlsx")}:/content`, { headers: H });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(XLSX.read(Buffer.from(await dl.arrayBuffer()), { type: "buffer" }).Sheets["Report"], { defval: null });

  const sp = new Map<string, number>();
  function add(j: string, s: string, h: number) { if (ETC_TRACKED_CODES.has(s)) sp.set(`${j}::${s}`, (sp.get(`${j}::${s}`) ?? 0) + h); }
  for (const r of rows) {
    const { y, m } = serialYM(Number(r["Work Date"])); if (y !== Y || m !== MO) continue;
    const fn = String(r["Function"] ?? "").trim(); if (fn === "417") continue;
    const sec = `${String(r["MachineSec"] ?? "").trim()}-${fn}`;
    const j = String(Number(r["Jobs"])); const h = Number(r["Total Hours Worked"]) || 0;
    if (sec === "10-311") { add(j, "10-312", h*0.3); add(j, "10-313", h*0.7); } else add(j, sec, h);
  }

  // PBI plain [Hours Actual] for May 2026 by job/section.
  const dax = (await runDax(`EVALUATE SUMMARIZECOLUMNS('Job'[Job Id], 'Function Hierarchy'[Section-Function Code], FILTER(ALL('Date'), 'Date'[Year]=${Y} && 'Date'[Month]=${MO}), "H", [Hours Actual])`)) as Record<string, unknown>[];
  const pbi = new Map<string, number>();
  for (const r of dax) { const j = r["Job[Job Id]"], s = r["Function Hierarchy[Section-Function Code]"]; if (j!=null && s!=null && ETC_TRACKED_CODES.has(String(s))) pbi.set(`${String(Number(j))}::${s}`, Number(r.H ?? 0)); }

  const keys = new Set([...sp.keys(), ...pbi.keys()]);
  let match=0, diff=0; const diffs: string[]=[];
  for (const k of keys) {
    const a = round2(sp.get(k) ?? 0), b = round2(pbi.get(k) ?? 0);
    if (Math.abs(a) < 0.02 && Math.abs(b) < 0.02) continue;
    if (Math.abs(a-b) < 0.02) match++;
    else { diff++; if (diffs.length<20) diffs.push(`${k}: sharepoint=${a} pbi=${b}`); }
  }
  console.log(`May 2026 (closed) — SharePoint transform vs PBI [Hours Actual]: match=${match} differ=${diff}`);
  for (const d of diffs) console.log("  " + d);
}
main().catch((e) => { console.error("FAILED:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
