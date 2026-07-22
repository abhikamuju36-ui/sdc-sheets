"use server";

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

// Backs the Monthly ETC grid's "Save" button (saveAllNewEtcDrafts in
// etc-actions.ts) — nothing a manager types into a New ETC cell persists
// until Save is clicked. The password only needs entering the first time
// each browser session; saveAllNewEtcDrafts checks isEtcEditUnlocked() first
// and only falls back to validating a submitted password if that cookie
// isn't already set.
//
// The password is fixed (not env-configurable) — same treatment, and same
// value, as SUBMIT_LOCK_PASSWORD in etc-actions.ts: a deliberate "are you
// sure" gesture before touching live numbers, not a real access boundary.
// Unlike that one-off confirmation (re-entered every Submit and Lock click),
// this unlock is session-scoped via an HMAC-signed cookie (same shape as
// standard-sheet-gate.ts) so a manager only enters it once per browser
// session, not on every save.
const COOKIE_NAME = "etc-edit-unlocked";
const ERROR_COOKIE = "etc-edit-error";
const PASSWORD = "sdcautomation";

function cookieToken(): string {
  const key = `${PASSWORD}::${process.env.AUTH_SECRET ?? ""}`;
  return createHmac("sha256", key).update("etc-edit-unlocked-v1").digest("hex");
}

// Constant-time equality on same-length digests of both sides — a plain `===`
// on the raw strings leaks match-length through timing.
function safeEqual(a: string, b: string): boolean {
  const da = createHmac("sha256", "cmp").update(a).digest();
  const db = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(da, db);
}

export async function isEtcEditUnlocked(): Promise<boolean> {
  const cookieStore = await cookies();
  const value = cookieStore.get(COOKIE_NAME)?.value;
  return value != null && safeEqual(value, cookieToken());
}

export async function hadEtcEditWrongPassword(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(ERROR_COOKIE)?.value === "1";
}

// Validates `attempt` and, if correct, sets the session-unlock cookie so
// later Save clicks this session skip straight to saving. Called from inside
// saveAllNewEtcDrafts — never exposed as a standalone form action, since
// unlocking with no save attached isn't a real use case here.
export async function trySetEtcEditUnlocked(attempt: string): Promise<boolean> {
  const cookieStore = await cookies();
  if (!safeEqual(attempt, PASSWORD)) {
    // A wrong password is expected user input, not an application error —
    // flag it in a short-lived cookie the gate form reads back.
    cookieStore.set(ERROR_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 });
    return false;
  }
  // Session-scoped (no maxAge): closing the browser relocks the tab.
  cookieStore.set(COOKIE_NAME, cookieToken(), { httpOnly: true, sameSite: "lax", path: "/" });
  cookieStore.delete(ERROR_COOKIE);
  return true;
}

// Relocks the tab — offered next to the toolbar's Save control so a manager
// can drop back behind the gate without closing the browser.
export async function lockEtcEdit(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  cookieStore.delete(ERROR_COOKIE);
  revalidatePath("/etc");
}
