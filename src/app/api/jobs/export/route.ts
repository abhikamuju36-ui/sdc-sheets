import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { validJobTypeFilter, compareJobIds } from "@/lib/job-filters";

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? undefined;
  const status = searchParams.get("status") ?? undefined;

  const where: Prisma.JobWhereInput = { ...validJobTypeFilter };
  if (q) where.OR = [{ jobName: { contains: q } }, { jobId: { contains: q } }];
  if (status) where.status = status;

  const jobs = await prisma.job.findMany({ where });
  jobs.sort((a, b) => compareJobIds(a.jobId, b.jobId)); // numeric, not lexicographic

  const header = ["Job Id", "Job Name", "Status", "Customer", "Type", "Source", "PO Start Date"];
  const rows = jobs.map((j) => [
    j.jobId,
    j.jobName,
    j.status,
    j.customer ?? "",
    j.type ?? "",
    j.source,
    j.poStartDate?.toISOString().slice(0, 10) ?? "",
  ]);
  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="sdc-jobs-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
