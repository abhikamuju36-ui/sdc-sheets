import sql from "mssql";
import { ConfidentialClientApplication } from "@azure/msal-node";

// Direct read access to the SDC Fabric Data Warehouse — the SAME store the
// Power BI semantic model imports from. Reading it here lets the app source
// ETC/Standard-Fees history without going through Power BI's dataset (and its
// fragile scheduled refresh / gateway / credential chain). Uses the existing
// Power BI service principal (verified 2026-07-19 it can read this warehouse)
// with a database-scoped token.
//
// Connection string is the workspace's SQL analytics endpoint, from the
// semantic model's own Sql.Database() source (committed TMDL).
const SERVER = "ixt2ry3uwdpureqiskgh3zw4yy-hhghvviya5guhil4cjq5swsnda.database.fabric.microsoft.com";
const DATABASE = "SDC-DataWarehouse-16d09d69-e06b-4e00-94b9-be7ccf8f2b1f";
const SCOPE = "https://database.windows.net/.default";

let cca: ConfidentialClientApplication | null = null;

async function getToken(): Promise<string> {
  if (!cca) {
    cca = new ConfidentialClientApplication({
      auth: {
        clientId: process.env.PBI_CLIENT_ID!,
        clientSecret: process.env.PBI_CLIENT_SECRET!,
        authority: `https://login.microsoftonline.com/${process.env.PBI_TENANT_ID}`,
      },
    });
  }
  const result = await cca.acquireTokenByClientCredential({ scopes: [SCOPE] });
  if (!result?.accessToken) throw new Error("Failed to acquire Fabric warehouse access token.");
  return result.accessToken;
}

// Runs a read-only query against the warehouse and returns the rows. Opens
// and closes a fresh pool per call — these syncs run on a slow cadence, so
// pooling isn't worth the added lifecycle complexity.
export async function queryWarehouse<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const token = await getToken();
  const pool = await sql.connect({
    server: SERVER,
    port: 1433,
    database: DATABASE,
    authentication: { type: "azure-active-directory-access-token", options: { token } },
    options: { encrypt: true },
    connectionTimeout: 30000,
    requestTimeout: 120000,
  } as sql.config);
  try {
    const result = await pool.request().query(query);
    return result.recordset as T[];
  } finally {
    await pool.close();
  }
}
