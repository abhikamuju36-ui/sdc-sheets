// A job must have a real Type to ever be imported or shown — Custom, Duplicate,
// Hybrid, or Service. Jobs with no Type (e.g. TotalETO has no Type field at all)
// are noise and must never appear in any list, count, dashboard, or export.
export const VALID_JOB_TYPES = ["Custom", "Duplicate", "Hybrid", "Service"] as const;

export const validJobTypeFilter = { type: { in: [...VALID_JOB_TYPES] } };
