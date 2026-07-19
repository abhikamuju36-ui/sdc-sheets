import { PublicClientApplication } from "@azure/msal-node";
import { DataProtectionScope, PersistenceCreator, PersistenceCachePlugin } from "@azure/msal-node-extensions";
import path from "path";
import os from "os";
import * as XLSX from "xlsx";
import { ETC_TRACKED_CODES } from "@/lib/sections";

// Reads the Paylocity "Current_Job_Hours.xlsx" hours export directly from the
// SDC-PowerBIIntegration SharePoint site (Microsoft Graph, read-only), so the
// app no longer needs Power BI's dataset for hours worked. Uses the same
// cached delegated login the Power BI DAX client uses (Azure PowerShell
// public client), just with a Graph scope.
//
// Replicates Power BI's own Power Query transform on this file (verified
// 2026-07-19 to match PBI's [Hours Actual] by job/section to the hundredth
// for the closed month May 2026, 127/127):
//   - section code = MachineSec + "-" + Function   (e.g. "10" + "211")
//   - drop Function "417"
//   - split "10-311" into "10-312" (30%) and "10-313" (70%)
//   - keep only ETC-tracked section codes
//   - Work Date is an Excel serial date

const CLIENT_ID = "1950a258-227b-4e31-a9cf-717495945fc2"; // Azure PowerShell, pre-consented
const CACHE_PATH = path.join(os.homedir(), "AppData", "Local", "SdcPowerBiMcp", "msal_cache.bin");
const SITE = "stevendouglascorp.sharepoint.com:/sites/SDC-PowerBIIntegration";
const FILE_PATH = "Project Planner V2/Job Hours Report/Job Hours From Paylocity/Current_Job_Hours.xlsx";

let pca: PublicClientApplication | null = null;

async function getGraphToken(): Promise<string> {
  if (!pca) {
    const persistence = await PersistenceCreator.createPersistence({
      cachePath: CACHE_PATH,
      dataProtectionScope: DataProtectionScope.CurrentUser,
      serviceName: "SdcPowerBiMcp",
      accountName: "SdcPowerBiMcp",
      usePlaintextFileOnLinux: false,
    });
    pca = new PublicClientApplication({
      auth: { clientId: CLIENT_ID, authority: "https://login.microsoftonline.com/organizations" },
      cache: { cachePlugin: new PersistenceCachePlugin(persistence) },
    });
  }
  const accounts = await pca.getTokenCache().getAllAccounts();
  if (accounts.length === 0) {
    throw new Error("No cached login for SharePoint/Graph. Run `sdc-powerbi-mcp.exe login` once to authenticate this machine.");
  }
  const result = await pca.acquireTokenSilent({ account: accounts[0], scopes: ["https://graph.microsoft.com/.default"] });
  if (!result?.accessToken) throw new Error("Failed to acquire Microsoft Graph token silently.");
  return result.accessToken;
}

export type JobHoursRow = { jobId: string; section: string; year: number; month: number; date: Date; hours: number };

function serialToDate(serial: number): Date {
  // Excel's epoch is 1899-12-30 (accounts for the 1900 leap-year bug).
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
}

// Latest Work Date across the export — the "Hours Refreshed Thru" freshness figure.
export function latestWorkDate(rows: JobHoursRow[]): Date | null {
  let max: Date | null = null;
  for (const r of rows) if (!max || r.date > max) max = r.date;
  return max;
}

// Downloads and transforms the hours file into tracked per-row records. One
// network fetch; callers filter/aggregate by month in memory.
export async function fetchJobHoursRows(): Promise<JobHoursRow[]> {
  const token = await getGraphToken();
  const H = { Authorization: `Bearer ${token}` };

  const siteResp = await fetch(`https://graph.microsoft.com/v1.0/sites/${SITE}`, { headers: H });
  if (!siteResp.ok) throw new Error(`Graph site lookup failed (HTTP ${siteResp.status}): ${(await siteResp.text()).slice(0, 200)}`);
  const siteId = ((await siteResp.json()) as { id: string }).id;

  const dl = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${encodeURI(FILE_PATH)}:/content`, { headers: H });
  if (!dl.ok) throw new Error(`Graph file download failed (HTTP ${dl.status}): ${(await dl.text()).slice(0, 200)}`);
  const wb = XLSX.read(Buffer.from(await dl.arrayBuffer()), { type: "buffer" });
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });

  const out: JobHoursRow[] = [];
  const push = (jobId: string, section: string, date: Date, hours: number) => {
    if (!ETC_TRACKED_CODES.has(section)) return;
    out.push({ jobId, section, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, date, hours });
  };
  for (const r of raw) {
    const serial = Number(r["Work Date"]);
    if (!Number.isFinite(serial)) continue;
    const date = serialToDate(serial);
    const fn = String(r["Function"] ?? "").trim();
    if (fn === "417") continue; // dropped by PBI's transform
    const machineSec = String(r["MachineSec"] ?? "").trim();
    const rawJob = r["Jobs"];
    if (rawJob == null || String(rawJob).trim() === "") continue;
    const jobId = String(Number(rawJob)); // normalize leading zeros to match app job keys
    const hours = Number(r["Total Hours Worked"]) || 0;
    const section = `${machineSec}-${fn}`;
    if (section === "10-311") {
      // Split into design (312, 30%) and software (313, 70%), per PBI.
      push(jobId, "10-312", date, hours * 0.3);
      push(jobId, "10-313", date, hours * 0.7);
    } else {
      push(jobId, section, date, hours);
    }
  }
  return out;
}

// Hours worked in a given calendar month, keyed "jobId::section". This is
// exactly what Power BI's [Hours Actual] filtered to that month returns.
export function hoursByJobSection(rows: JobHoursRow[], year: number, month: number): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.year !== year || r.month !== month) continue;
    const key = `${r.jobId}::${r.section}`;
    map.set(key, (map.get(key) ?? 0) + r.hours);
  }
  return map;
}
