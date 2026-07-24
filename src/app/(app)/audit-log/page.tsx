import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { PageTitle } from "@/components/ui/Typography";
import { AuditLogGrid } from "@/components/AuditLogGrid";

// How many recent entries to load into the grid (AG Grid then sorts/filters/
// paginates them client-side).
const LOAD_LIMIT = 1000;

// Admin-only view of AuditLog — every logged data-changing action. AG Grid
// (Community) provides sort / column filters / resize / pagination client-side.
export default async function AuditLogPage() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "ADMIN") redirect("/");

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: LOAD_LIMIT }),
    prisma.auditLog.count(),
  ]);

  const rows = logs.map((log) => ({
    when: log.createdAt.toISOString().slice(0, 16).replace("T", " "),
    userEmail: log.userEmail ?? "—",
    action: log.action,
    entity: log.entityType ? `${log.entityType}${log.entityId ? ` #${log.entityId}` : ""}` : "—",
    summary: log.summary ?? "",
  }));

  return (
    <div className="w-full p-8">
      <PageTitle className="mb-1">Audit Log</PageTitle>
      <p className="mb-6 text-sm text-sdc-gray-600">
        Every recorded data change across the app — ETC edits, employee/job changes, Standard Sheet edits,
        month submit/reopen/refresh, and sign-ins. {total.toLocaleString()} total{" "}
        {total === 1 ? "entry" : "entries"}
        {total > LOAD_LIMIT ? ` (showing the latest ${LOAD_LIMIT.toLocaleString()})` : ""}. Sort or filter any column.
      </p>
      <AuditLogGrid rows={rows} />
    </div>
  );
}
