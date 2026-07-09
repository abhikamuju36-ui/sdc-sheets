"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

const COOKIE_NAME = "standard-sheet-unlocked";
const ERROR_COOKIE = "standard-sheet-error";

// Server-side check — the password never reaches the client bundle (the old
// client-component gate shipped it in page JS, readable by any signed-in
// manager via dev tools). Override via STANDARD_SHEET_PASSWORD in .env.
function expectedPassword(): string {
  return process.env.STANDARD_SHEET_PASSWORD ?? "sdcautomation";
}

export async function isStandardSheetUnlocked(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value === "1";
}

export async function hadWrongPassword(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(ERROR_COOKIE)?.value === "1";
}

export async function unlockStandardSheet(formData: FormData): Promise<void> {
  const attempt = String(formData.get("password") ?? "");
  const cookieStore = await cookies();
  if (attempt !== expectedPassword()) {
    // A wrong password is expected user input, not an application error —
    // flag it in a short-lived cookie the gate form reads back.
    cookieStore.set(ERROR_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 });
  } else {
    // Session-scoped (no maxAge): closing the browser relocks the tab.
    cookieStore.set(COOKIE_NAME, "1", { httpOnly: true, sameSite: "lax", path: "/" });
    cookieStore.delete(ERROR_COOKIE);
  }
  // The same unlock cookie gates both the Standard Sheet tab and the optional
  // Standard columns on the Monthly ETC grid — revalidate both.
  revalidatePath("/standard-sheet");
  revalidatePath("/etc");
}

// Relocks the tab (used by the "Hide Standards" button on the ETC grid, and
// anywhere else that wants to drop back behind the gate without closing the
// browser).
export async function lockStandardSheet(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  cookieStore.delete(ERROR_COOKIE);
  revalidatePath("/standard-sheet");
  revalidatePath("/etc");
}
