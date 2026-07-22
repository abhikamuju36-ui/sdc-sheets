// A job must have a real Type to ever be imported or shown — Custom, Duplicate,
// Hybrid, or Service. Jobs with no Type (e.g. TotalETO has no Type field at all)
// are noise and must never appear in any list, count, dashboard, or export.
export const VALID_JOB_TYPES = ["Custom", "Duplicate", "Hybrid", "Service"] as const;

export const validJobTypeFilter = { type: { in: [...VALID_JOB_TYPES] } };

// The one job universe the Monthly ETC month operates on — the grid, seeding,
// pruning, and submission must all use this same filter, or entries get seeded
// for jobs the grid never renders and the month can never be submitted.
export const etcActiveJobFilter = { status: "Active", completeDate: null, ...validJobTypeFilter };

// SDC's own internal projects are never billable to an outside customer — this
// overrides whatever the Billable dropdown is set to, both when saving and for
// any job already in the database. "SDC" and "Steven Douglas Corp." are the
// same company (SDC = Steven Douglas Corporation), so both spellings count —
// they get the same non-billable rule and the same light-blue row highlight.
export function isSdcCustomer(customer: string | null | undefined): boolean {
  const normalized = (customer ?? "").trim().toUpperCase();
  return normalized === "SDC" || normalized.startsWith("STEVEN DOUGLAS");
}

// Job Ids are stored as strings but are (almost always) numbers — a plain
// string sort puts "10000" before "979". Sort numerically like the sheet did,
// falling back to string comparison for any non-numeric Id.
export function compareJobIds(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}
