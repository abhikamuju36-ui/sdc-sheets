import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

type AuditEntry = {
  action: string;
  entityType?: string;
  entityId?: string | number;
  summary: string;
  metadata?: Record<string, unknown>;
};

// `summary` has no explicit @db type in schema.prisma, so Prisma's MySQL
// default (VARCHAR(191)) applies. Found live 2026-07-17: syncEtcHistory's
// reconciliation note (lists every reconciled month + field counts) can
// exceed that and the whole audit record silently fails to write (P2000) —
// defeating the exact record the reconciliation added this summary to
// create. Truncate defensively so a long summary still leaves a real,
// searchable log entry instead of no entry at all.
const SUMMARY_MAX = 191;

// Best-effort by design: a logging failure must never break the action it's
// recording (e.g. a locked audit table shouldn't block an ETC submission).
async function writeAuditLog(entry: AuditEntry & { userId: number | null; userEmail: string | null }) {
  try {
    const summary = entry.summary.length > SUMMARY_MAX ? `${entry.summary.slice(0, SUMMARY_MAX - 1)}…` : entry.summary;
    await prisma.auditLog.create({
      data: {
        userId: entry.userId,
        userEmail: entry.userEmail,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId !== undefined ? String(entry.entityId) : null,
        summary,
        metadata: entry.metadata as never,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write log", entry.action, err);
  }
}

// Call from inside a server action / page action — reads the signed-in user
// from the current session.
export async function logAudit(entry: AuditEntry): Promise<void> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  await writeAuditLog({
    ...entry,
    userId: userId ? Number(userId) : null,
    userEmail: session?.user?.email ?? null,
  });
}

// Call from within auth.ts's callbacks, where `auth()` can't be used (no
// session exists yet during sign-in) — the caller already has the user.
export async function logAuditFor(
  userId: number | null,
  userEmail: string | null,
  entry: AuditEntry,
): Promise<void> {
  await writeAuditLog({ ...entry, userId, userEmail });
}
