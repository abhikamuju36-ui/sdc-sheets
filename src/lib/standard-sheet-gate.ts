"use server";

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

const COOKIE_NAME = "standard-sheet-unlocked";
const ERROR_COOKIE = "standard-sheet-error";

// Server-side check — the password never reaches the client bundle (the old
// client-component gate shipped it in page JS, readable by any signed-in
// manager via dev tools). Override via STANDARD_SHEET_PASSWORD in .env.
// The dev fallback is refused in production: shipping with the well-known
// default would make the gate decorative.
function expectedPassword(): string {
  const configured = process.env.STANDARD_SHEET_PASSWORD;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("STANDARD_SHEET_PASSWORD must be set in production — the Standard Sheet gate has no password configured.");
  }
  return "sdcautomation";
}

// The unlock cookie holds an HMAC over a fixed message, keyed by the password
// (plus AUTH_SECRET when present) — a hand-crafted cookie set in dev tools
// can't forge it, unlike the old plain "1" flag.
function cookieToken(): string {
  const key = `${expectedPassword()}::${process.env.AUTH_SECRET ?? ""}`;
  return createHmac("sha256", key).update("standard-sheet-unlocked-v2").digest("hex");
}

// Constant-time equality on same-length digests of both sides — a plain `===`
// on the raw strings leaks match-length through timing.
function safeEqual(a: string, b: string): boolean {
  const da = createHmac("sha256", "cmp").update(a).digest();
  const db = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(da, db);
}

export async function isStandardSheetUnlocked(): Promise<boolean> {
  const cookieStore = await cookies();
  const value = cookieStore.get(COOKIE_NAME)?.value;
  return value != null && safeEqual(value, cookieToken());
}

// Guard for every Standard Sheet mutation action — rendering hiding the grid
// is not enough, since server actions are directly callable by any signed-in
// user who captures the action IDs.
export async function assertStandardSheetUnlocked(): Promise<void> {
  if (!(await isStandardSheetUnlocked())) {
    throw new Error("The Standard Sheet is locked — enter the Standard Sheet password first.");
  }
}

export async function hadWrongPassword(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(ERROR_COOKIE)?.value === "1";
}

export async function unlockStandardSheet(formData: FormData): Promise<void> {
  const attempt = String(formData.get("password") ?? "");
  const cookieStore = await cookies();
  if (!safeEqual(attempt, expectedPassword())) {
    // A wrong password is expected user input, not an application error —
    // flag it in a short-lived cookie the gate form reads back.
    cookieStore.set(ERROR_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 });
  } else {
    // Session-scoped (no maxAge): closing the browser relocks the tab.
    cookieStore.set(COOKIE_NAME, cookieToken(), { httpOnly: true, sameSite: "lax", path: "/" });
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
