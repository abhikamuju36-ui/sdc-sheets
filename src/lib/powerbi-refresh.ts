import { ConfidentialClientApplication } from "@azure/msal-node";

// Controls the Power BI DATASET's own refresh (the model reloading from its
// sources: the SharePoint Paylocity exports, the Fabric warehouse, TotalETO)
// — distinct from powerbi-client.ts, which QUERIES the already-loaded model.
// Uses the same service principal as the DAX client; verified 2026-07-18 it
// can read refresh history and hit the refresh endpoint for this dataset.
//
// Background (found live 2026-07-18): the team's own refresh automation runs
// once a day at ~6:02am ET, and when it fails (that morning:
// ModelRefreshFailed_CredentialsNotSpecified — an expired data-source
// credential) nothing surfaces anywhere; the app just quietly serves
// yesterday's hours. These helpers let the app watch the refresh outcome,
// show failures in the UI, and top up freshness on its own cadence.

const SCOPE = "https://analysis.windows.net/powerbi/api/.default";

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
  if (!result?.accessToken) throw new Error("Failed to acquire Power BI service-principal token.");
  return result.accessToken;
}

function datasetBase(): string {
  return `https://api.powerbi.com/v1.0/myorg/groups/${process.env.PBI_WORKSPACE_ID}/datasets/${process.env.PBI_DATASET_ID}`;
}

export type DatasetRefresh = {
  status: "Completed" | "Failed" | "Unknown" | "Disabled" | string;
  startTime: Date | null;
  endTime: Date | null;
  errorCode: string | null;
  refreshType: string | null;
};

// Newest-first refresh history. "Unknown" status = a refresh currently running.
export async function getLatestRefreshes(top = 3): Promise<DatasetRefresh[]> {
  const token = await getToken();
  const resp = await fetch(`${datasetBase()}/refreshes?$top=${top}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Power BI refresh history failed (HTTP ${resp.status}): ${await resp.text()}`);
  const data = (await resp.json()) as { value?: Record<string, string | undefined>[] };
  return (data.value ?? []).map((r) => {
    let errorCode: string | null = null;
    try {
      if (r.serviceExceptionJson) errorCode = (JSON.parse(r.serviceExceptionJson) as { errorCode?: string }).errorCode ?? null;
    } catch {
      errorCode = r.serviceExceptionJson?.slice(0, 80) ?? null;
    }
    return {
      status: r.status ?? "Unknown",
      startTime: r.startTime ? new Date(r.startTime) : null,
      endTime: r.endTime ? new Date(r.endTime) : null,
      errorCode,
      refreshType: r.refreshType ?? null,
    };
  });
}

// Kicks a dataset refresh (fire-and-forget; Power BI answers 202 and runs it
// server-side over a few minutes). Returns false without throwing when the
// service declines — e.g. a refresh is already in progress (400) or the
// daily refresh quota is exhausted — so the auto-sync loop can just log it.
export async function triggerDatasetRefresh(): Promise<boolean> {
  const token = await getToken();
  const resp = await fetch(`${datasetBase()}/refreshes`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ notifyOption: "NoNotification" }),
  });
  if (resp.status === 202) return true;
  console.warn(`[pbi-refresh] trigger declined (HTTP ${resp.status}): ${(await resp.text()).slice(0, 200)}`);
  return false;
}
