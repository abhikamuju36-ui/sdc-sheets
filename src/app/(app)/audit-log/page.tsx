import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { PageTitle } from "@/components/ui/Typography";
import { card, INPUT, BUTTON_SECONDARY, TABLE_HEADER_ROW, TABLE_ROW_HOVER } from "@/components/ui/classnames";
import type { Prisma } from "@prisma/client";

const PAGE_SIZE = 100;

// Admin-only view of AuditLog — every logged data-changing action, newest
// first. Server-side role check, not just a hidden nav link.
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string; action?: string; entityType?: string; page?: string }>;
}) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "ADMIN") redirect("/");

  const { user, action, entityType, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const where: Prisma.AuditLogWhereInput = {
    ...(user ? { userEmail: { contains: user } } : {}),
    ...(action ? { action: { contains: action } } : {}),
    ...(entityType ? { entityType: { contains: entityType } } : {}),
  };

  const [logs, total, distinctActions] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const qs = (overrides: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const merged = { user, action, entityType, page, ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== "") params.set(k, String(v));
    }
    return `?${params.toString()}`;
  };

  return (
    <div className="w-full max-w-6xl p-8">
      <PageTitle className="mb-1">Audit Log</PageTitle>
      <p className="mb-6 text-sm text-sdc-gray-600">
        Every recorded data change across the app — ETC edits, employee/job changes, Standard Sheet edits,
        month submit/reopen/refresh, and sign-ins. {total} total entr{total === 1 ? "y" : "ies"}.
      </p>

      <form className={`${card()} mb-6 flex flex-wrap items-end gap-3`}>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-sdc-gray-500">User email</span>
          <input name="user" defaultValue={user} placeholder="e.g. akamuju@…" className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-sdc-gray-500">Action</span>
          <input name="action" defaultValue={action} list="audit-actions" placeholder="e.g. etc.submitMonth" className={INPUT} />
          <datalist id="audit-actions">
            {distinctActions.map((a) => (
              <option key={a.action} value={a.action} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-sdc-gray-500">Entity type</span>
          <input name="entityType" defaultValue={entityType} placeholder="e.g. EtcEntry" className={INPUT} />
        </label>
        <button type="submit" className={BUTTON_SECONDARY}>
          Filter
        </button>
        {(user || action || entityType) && (
          <a href="/audit-log" className="text-xs text-sdc-blue underline hover:text-sdc-blue-dark">
            Clear
          </a>
        )}
      </form>

      <div className={`${card("p-0")} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead>
            <tr className={TABLE_HEADER_ROW}>
              <th className="px-4 py-3">When</th>
              <th className="px-3 py-3">User</th>
              <th className="px-3 py-3">Action</th>
              <th className="px-3 py-3">Entity</th>
              <th className="px-3 py-3">Summary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sdc-border-soft">
            {logs.map((log) => (
              <tr key={log.id} className={`${TABLE_ROW_HOVER} align-top`}>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-sdc-gray-500">
                  {log.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </td>
                <td className="px-3 py-2 text-xs text-sdc-gray-700">{log.userEmail ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs text-sdc-navy">{log.action}</td>
                <td className="px-3 py-2 text-xs text-sdc-gray-500">
                  {log.entityType ? `${log.entityType}${log.entityId ? ` #${log.entityId}` : ""}` : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-sdc-gray-700">
                  <p>{log.summary}</p>
                  {log.metadata != null && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11px] text-sdc-blue underline">details</summary>
                      <pre className="mt-1 max-w-xl overflow-x-auto rounded bg-sdc-gray-50 p-2 text-[11px] text-sdc-gray-600">
                        {JSON.stringify(log.metadata, null, 2)}
                      </pre>
                    </details>
                  )}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-5 text-sdc-gray-400">
                  No audit log entries match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-3 text-xs text-sdc-gray-500">
          <a href={qs({ page: Math.max(1, page - 1) })} className={page <= 1 ? "pointer-events-none opacity-40" : "underline"}>
            ← Prev
          </a>
          <span>
            Page {page} of {totalPages}
          </span>
          <a
            href={qs({ page: Math.min(totalPages, page + 1) })}
            className={page >= totalPages ? "pointer-events-none opacity-40" : "underline"}
          >
            Next →
          </a>
        </div>
      )}
    </div>
  );
}
