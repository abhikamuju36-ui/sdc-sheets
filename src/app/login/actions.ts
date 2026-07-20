"use server";

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { logAuditFor } from "@/lib/audit";

export type RegisterResult = { ok: true } | { ok: false; error: string };

// Self-service account creation: name + email + password. Called from the
// sign-up form; on success the client signs in with the same credentials.
export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<RegisterResult> {
  const name = input.name?.trim();
  const email = input.email?.trim().toLowerCase();
  const password = input.password ?? "";

  if (!name) return { ok: false, error: "Please enter your name." };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { ok: false, error: "An account with this email already exists. Please sign in." };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, role: "MANAGER" },
  });

  await logAuditFor(user.id, user.email, {
    action: "auth.register",
    entityType: "User",
    entityId: user.id,
    summary: `${user.email} created an account`,
  });

  return { ok: true };
}
