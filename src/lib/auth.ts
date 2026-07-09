import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { logAuditFor } from "@/lib/audit";

// Web Crypto (works in both Node and the Edge middleware bundle, unlike
// node:crypto): 32 random bytes as hex — used as an unusable password hash.
function unusablePasswordHash(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Microsoft Entra (Azure AD) SSO for @sdcautomation.com accounts. Enabled only
// when the App Registration's values are present in .env — until then the
// credentials form is the sole sign-in. See ENTRA-SSO-SETUP.md for the exact
// registration steps.
export const entraSsoEnabled = Boolean(
  process.env.AUTH_MICROSOFT_ENTRA_ID_ID &&
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
    process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID
);

const ALLOWED_EMAIL_DOMAIN = "@sdcautomation.com";

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // Required when self-hosting behind a hostname like server-app1 (NextAuth
  // otherwise only trusts hosts it can infer on known platforms).
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return { id: String(user.id), email: user.email, name: user.name, role: user.role };
      },
    }),
    ...(entraSsoEnabled
      ? [
          MicrosoftEntraID({
            clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID!,
            clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
            // Single-tenant issuer: only accounts from the SDC tenant can
            // authenticate at all; the domain check below is a second fence.
            issuer: `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID}/v2.0`,
          }),
        ]
      : []),
  ],
  callbacks: {
    signIn: async ({ user, account }) => {
      if (account?.provider !== "microsoft-entra-id") return true;
      const email = user.email?.toLowerCase();
      return !!email && email.endsWith(ALLOWED_EMAIL_DOMAIN);
    },
    jwt: async ({ token, user, account }) => {
      if (user && account?.provider === "microsoft-entra-id") {
        // First-class app account for every SSO user, matched/provisioned by
        // email. The random passwordHash is unmatchable by bcrypt.compare, so
        // SSO-provisioned accounts can never sign in via the password form.
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
      } else if (user) {
        token.role = (user as { role: string }).role;
        await logAuditFor(Number(user.id), user.email ?? null, {
          action: "auth.signIn",
          entityType: "User",
          entityId: user.id,
          summary: `${user.email} signed in with password`,
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
