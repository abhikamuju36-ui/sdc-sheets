"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

const COOKIE_NAME = "audit-log-unlocked";
const ERROR_COOKIE = "audit-log-error";

// Same pattern as standard-sheet-gate.ts — server-side check so the password
// never reaches the client bundle. Override via AUDIT_LOG_PASSWORD in .env.
function expectedPassword(): string {
  return process.env.AUDIT_LOG_PASSWORD ?? "sdcautomation";
}

export async function isAuditLogUnlocked(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value === "1";
}

export async function hadWrongAuditLogPassword(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(ERROR_COOKIE)?.value === "1";
}

export async function unlockAuditLog(formData: FormData): Promise<void> {
  const attempt = String(formData.get("password") ?? "");
  const cookieStore = await cookies();
  if (attempt !== expectedPassword()) {
    cookieStore.set(ERROR_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 });
  } else {
    // Session-scoped (no maxAge): closing the browser relocks the tab.
    cookieStore.set(COOKIE_NAME, "1", { httpOnly: true, sameSite: "lax", path: "/" });
    cookieStore.delete(ERROR_COOKIE);
  }
  revalidatePath("/audit-log");
}
