// Read the SharePoint hours file, understand date range + how the transform
// maps to tracked section codes, and aggregate July 2026 by job/section to
// compare against the app's stored July hours (which came from PBI).
import { PublicClientApplication } from "@azure/msal-node";
import { DataProtectionScope, PersistenceCreator, PersistenceCachePlugin } from "@azure/msal-node-extensions";
import path from "path"; import os from "os";
import * as XLSX from "xlsx";
import { prisma } from "../src/lib/prisma";
import { ETC_TRACKED_CODES } from "../src/lib/sections";
import { round2 } from "../src/lib/etc";

async function graphToken() {
  const persistence = await PersistenceCreator.createPersistence({ cachePath: path.join(os.homedir(), "AppData", "Local", "SdcPowerBiMcp", "msal_cache.bin"), dataProtectionScope: DataProtectionScope.CurrentUser, serviceName: "SdcPowerBiMcp", accountName: "SdcPowerBiMcp", usePlaintextFileOnLinux: false });
  const pca = new PublicClientApplication({ auth: { clientId: "1950a258-227b-4e31-a9cf-717495945fc2", authority: "https://login.microsoftonline.com/organizations" }, cache: { cachePlugin: new PersistenceCachePlugin(persistence) } });
  const account = (await pca.getTokenCache().getAllAccounts())[0];
  return (await pca.acquireTokenSilent({ account, scopes: ["https://graph.microsoft.com/.default"] })).accessToken;
}

// Excel serial date -> {y,m}
function serialYM(serial: number) { const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; }

async function main() {
  const token = await graphToken();
  const H = { Authorization: `Bearer ${token}` };
  const siteId = (await (await fetch("https://graph.microsoft.com/v1.0/sites/stevendouglascorp.sharepoint.com:/sites/SDC-PowerBIIntegration", { headers: H })).json()).id;
  // list the folder to see all hours files
  const folder = "Project Planner V2/Job Hours Report/Job Hours From Paylocity";
  const listing = await (await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${encodeURI(folder)}:/children?$select=name,size`, { headers: H })).json();
  console.log("Files in folder:", (listing.value ?? []).map((f: any) => `${f.name} (${Math.round(f.size/1024)}KB)`));

  const dl = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${encodeURI(folder + "/Current_Job_Hours.xlsx")}:/content`, { headers: H });
  const wb = XLSX.read(Buffer.from(await dl.arrayBuffer()), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Report"], { defval: null });

  // date range
  const serials = rows.map(r => Number(r["Work Date"])).filter(Number.isFinite);
  const min = serialYM(Math.min(...serials)), max = serialYM(Math.max(...serials));
  console.log(`rows=${rows.length}, date range: ${min.y}-${min.m} .. ${max.y}-${max.m}`);

  // Aggregate July 2026 by job + tracked section, applying transform.
  const agg = new Map<string, number>(); // `${jobId}::${section}` -> hours
  function add(jobId: string, section: string, hrs: number) {
    if (!ETC_TRACKED_CODES.has(section)) return;
    agg.set(`${jobId}::${section}`, (agg.get(`${jobId}::${section}`) ?? 0) + hrs);
  }
  for (const r of rows) {
    const { y, m } = serialYM(Number(r["Work Date"]));
    if (y !== 2026 || m !== 7) continue;
    const fn = String(r["Function"] ?? "").trim();
    if (fn === "417") continue;
    const sec = `${String(r["MachineSec"] ?? "").trim()}-${fn}`;
    const jobId = String(Number(r["Jobs"])); // normalize leading zeros
    const hrs = Number(r["Total Hours Worked"]) || 0;
    if (sec === "10-311") { add(jobId, "10-312", hrs * 0.3); add(jobId, "10-313", hrs * 0.7); }
    else add(jobId, sec, hrs);
  }

  // Compare to app's stored July hours.
  const jobs = await prisma.job.findMany({ select: { id: true, jobId: true } });
  const jobIdByPk = new Map(jobs.map(j => [j.id, j.jobId]));
  const july = await prisma.etcEntry.findMany({ where: { month: "2026-07" }, select: { jobId: true, section: true, hoursWorked: true } });
  let match = 0, near = 0, diff = 0; const diffs: string[] = [];
  for (const e of july) {
    if (e.section === "PARTS_COST") continue;
    const jid = jobIdByPk.get(e.jobId)!;
    const app = round2(Number(e.hoursWorked));
    const mine = round2(agg.get(`${jid}::${e.section}`) ?? 0);
    if (app === 0 && mine === 0) continue;
    const d = Math.abs(app - mine);
    if (d < 0.02) match++;
    else if (d / Math.max(app, mine, 1) < 0.03) near++;
    else { diff++; if (diffs.length < 15) diffs.push(`Job ${jid} ${e.section}: app=${app} sharepoint=${mine}`); }
  }
  console.log(`\nJuly hours — app(PBI) vs SharePoint-direct: match=${match} near=${near} differ=${diff}`);
  for (const d of diffs) console.log("  " + d);
}
main().catch((e) => { console.error("FAILED:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
