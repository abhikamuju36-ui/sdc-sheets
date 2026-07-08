import { PublicClientApplication, type AccountInfo } from "@azure/msal-node";
import { DataProtectionScope, PersistenceCreator, PersistenceCachePlugin } from "@azure/msal-node-extensions";
import path from "path";
import os from "os";

// Delegated auth via the well-known, pre-consented Azure PowerShell public
// client ID — no app registration or admin consent needed. Reuses the same
// token cache the `sdc-powerbi-mcp.exe` CLI (N:\MCP_SERVERS\Powerbi MCP)
// already created, so a machine that's run that tool's `login` command once
// doesn't need to log in again here. Queries run as the signed-in user, so
// row-level security is honored.
const CLIENT_ID = "1950a258-227b-4e31-a9cf-717495945fc2";
const SCOPES = ["https://analysis.windows.net/powerbi/api/.default"];
const CACHE_PATH = path.join(os.homedir(), "AppData", "Local", "SdcPowerBiMcp", "msal_cache.bin");

const PBI_GROUP_ID = process.env.PBI_WORKSPACE_ID;
const PBI_DATASET_ID = process.env.PBI_DATASET_ID;

let pcaPromise: Promise<PublicClientApplication> | null = null;

async function getPca(): Promise<PublicClientApplication> {
  if (!pcaPromise) {
    pcaPromise = (async () => {
      const persistence = await PersistenceCreator.createPersistence({
        cachePath: CACHE_PATH,
        dataProtectionScope: DataProtectionScope.CurrentUser,
        serviceName: "SdcPowerBiMcp",
        accountName: "SdcPowerBiMcp",
        usePlaintextFileOnLinux: false,
      });
      return new PublicClientApplication({
        auth: { clientId: CLIENT_ID, authority: "https://login.microsoftonline.com/organizations" },
        cache: { cachePlugin: new PersistenceCachePlugin(persistence) },
      });
    })();
  }
  return pcaPromise;
}

async function getAccount(pca: PublicClientApplication): Promise<AccountInfo> {
  const accounts = await pca.getTokenCache().getAllAccounts();
  if (accounts.length === 0) {
    throw new Error(
      "No cached Power BI login found. Run `sdc-powerbi-mcp.exe login` once " +
        "(N:\\MCP_SERVERS\\Powerbi MCP\\publish\\win-x64) to authenticate this machine."
    );
  }
  return accounts[0];
}

async function getAccessToken(): Promise<string> {
  const pca = await getPca();
  const account = await getAccount(pca);
  const result = await pca.acquireTokenSilent({ account, scopes: SCOPES });
  if (!result) throw new Error("Failed to acquire Power BI access token silently.");
  return result.accessToken;
}

// Runs a DAX query (e.g. "EVALUATE ...") against the Job Hours Report -
// Management Level semantic model and returns the rows as plain objects,
// with the "[Table Name]" column-name brackets stripped.
export async function runDax(dax: string): Promise<unknown[]> {
  if (!PBI_GROUP_ID || !PBI_DATASET_ID) {
    throw new Error("PBI_WORKSPACE_ID and PBI_DATASET_ID must be set in the environment.");
  }
  const token = await getAccessToken();
  const url = `https://api.powerbi.com/v1.0/myorg/groups/${PBI_GROUP_ID}/datasets/${PBI_DATASET_ID}/executeQueries`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      queries: [{ query: dax }],
      serializerSettings: { includeNulls: true },
    }),
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Power BI executeQueries failed (HTTP ${resp.status}): ${text}`);
  }

  const parsed = JSON.parse(text);
  const rows: Record<string, unknown>[] = parsed?.results?.[0]?.tables?.[0]?.rows ?? [];
  return rows.map((row) => {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const cleanKey = key.length > 1 && key.startsWith("[") && key.endsWith("]") && key.indexOf("[", 1) < 0
        ? key.slice(1, -1)
        : key;
      clean[cleanKey] = value;
    }
    return clean;
  });
}
