import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { prisma } from "@/lib/prisma";
import { logAuditFor } from "@/lib/audit";

// Web Crypto (works in both Node and the Edge middleware bundle, unlike
// node:crypto): 32 random bytes as hex — used as an unusable password hash for
// SSO-provisioned accounts so the (now removed) password path could never match
// them. The passwordHash column is retained only to satisfy the schema.
function unusablePasswordHash(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Sign-in is Microsoft Entra (Azure AD) SSO only — single-tenant, restricted to
// @sdcautomation.com accounts. The App Registration's values must be present in
// the environment; see ENTRA-SSO-SETUP.md for the exact registration steps.
const ENTRA_CLIENT_ID = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
const ENTRA_CLIENT_SECRET = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;
const ENTRA_TENANT_ID = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID;

// Fail loudly at boot rather than silently rendering a login page with no way
// in — a missing var would otherwise lock every user out with no clue why.
if (!ENTRA_CLIENT_ID || !ENTRA_CLIENT_SECRET || !ENTRA_TENANT_ID) {
  throw new Error(
    "Microsoft Entra SSO is not configured. Set AUTH_MICROSOFT_ENTRA_ID_ID, " +
      "AUTH_MICROSOFT_ENTRA_ID_SECRET, and AUTH_MICROSOFT_ENTRA_ID_TENANT_ID " +
      "(see ENTRA-SSO-SETUP.md)."
  );
}

const ALLOWED_EMAIL_DOMAIN = "@sdcautomation.com";

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // Required when self-hosting behind a hostname like server-app1 (NextAuth
  // otherwise only trusts hosts it can infer on known platforms).
  trustHost: true,
  providers: [
    MicrosoftEntraID({
      clientId: ENTRA_CLIENT_ID,
      clientSecret: ENTRA_CLIENT_SECRET,
      // Single-tenant issuer: only accounts from the SDC tenant can
      // authenticate at all; the domain check below is a second fence.
      issuer: `https://login.microsoftonline.com/${ENTRA_TENANT_ID}/v2.0`,
    }),
  ],
  callbacks: {
    signIn: async ({ user, account }) => {
      if (account?.provider !== "microsoft-entra-id") return false;
      const email = user.email?.toLowerCase();
      return !!email && email.endsWith(ALLOWED_EMAIL_DOMAIN);
    },
    jwt: async ({ token, user, account }) => {
      if (user && account?.provider === "microsoft-entra-id") {
        // First-class app account for every SSO user, matched/provisioned by
        // email. The random passwordHash is never used for authentication.
        const email = user.email!.toLowerCase();
        const dbUser = await prisma.user.upsert({
          where: { email },
          update: { name: user.name ?? email },
          create: {
            email,
            name: user.name ?? email,
            passwordHash: unusablePasswordHash(),
            role: "MANAGER",
          },
        });
        token.sub = String(dbUser.id); // downstream code keys off OUR User.id, not Entra's
        token.role = dbUser.role;
        await logAuditFor(dbUser.id, dbUser.email, {
          action: "auth.signIn",
          entityType: "User",
          entityId: dbUser.id,
          summary: `${dbUser.email} signed in via Microsoft SSO`,
        });
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        (session.user as { role?: string }).role = token.role as string;
        (session.user as { id?: string }).id = token.sub;
      }
      return session;
    },
    authorized: async ({ auth }) => !!auth?.user,
  },
});
