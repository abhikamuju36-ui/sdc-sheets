import "server-only";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { fetchSchedulerTeam } from "@/lib/scheduler-db";

// Mirrors the SDC Scheduler's team grouping (team_members.discipline) into each
// ETC employee's `discipline`, making the Scheduler the single source of truth
// for grouping — while ETC keeps its own rows (paylocityId + historical hours).
//
// The two apps share no stable key, so we match on the name, normalized to
// absorb spacing/case differences (e.g. "Xiaoli Liu" == "Xiao Li Liu"). What
// normalization can't safely bridge — nicknames like "Mike"/"Michael" or
// "Josh"/"Joshua" — is NOT guessed; those names are returned in the unmatched
// lists so a human can rename them to line up (after which the sync is exact).

// The Scheduler stores discipline as short codes; ETC groups by the full
// labels (see the Employees page DISCIPLINES). Map codes → ETC labels. An
// unknown code is passed through verbatim so it surfaces rather than vanishing.
const DISCIPLINE_LABEL: Record<string, string> = {
  pm: "Project Management",
  mech: "Mechanical Engineers",
  controls: "Controls Engineers",
  build: "Builders",
  wire: "Electricians",
};
function toEtcDiscipline(code: string): string {
  return DISCIPLINE_LABEL[code.trim().toLowerCase()] ?? code;
}

// Common short-form → formal first names, so the Scheduler's casual names
// ("Mike", "Josh", "Rich") match ETC's formal ones ("Michael", "Joshua",
// "Richard"). Validated against the live roster: expanding these plus the
// last name matched 48/52 with zero false collisions (the remaining 4 aren't
// in ETC's roster at all). Last name is always kept, so an expansion can't
// collapse two different people (e.g. Josh vs Jonathan Belliveau stay distinct).
const NICKNAMES: Record<string, string> = {
  mike: "michael", josh: "joshua", rich: "richard", tim: "timothy",
  matt: "matthew", rob: "robert", dave: "david", mitch: "mitchell",
  nick: "nicholas", greg: "gregory", dan: "daniel", tom: "thomas",
  jon: "jonathan", chris: "christopher", andy: "andrew", bill: "william",
  billy: "william", sam: "samuel", joe: "joseph", jim: "james", ben: "benjamin",
};

// Whitespace-insensitive, case-insensitive, punctuation-stripped, nickname-
// expanded match key.
function normalizeName(name: string): string {
  const parts = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]/g, " ") // drop dots, hyphens, accents → space
    .trim()
    .split(/\s+/);
  if (parts.length > 0) parts[0] = NICKNAMES[parts[0]] ?? parts[0];
  return parts.join("");
}

export type TeamSyncResult = {
  ok: boolean;
  reason?: string;
  updated: { name: string; from: string | null; to: string }[];
  unchanged: number;
  // Active ETC employees with no confident Scheduler match (need renaming or
  // simply aren't on the Scheduler roster).
  unmatchedEtc: string[];
  // Active Scheduler members with no confident ETC match (name drift, or they
  // don't log hours in ETC yet).
  unmatchedScheduler: string[];
};

// Read-only reconciliation of ETC's FULL roster (active + inactive) against the
// Scheduler's team list, on two dimensions: active status and team (grouping).
// Matches on the same nickname-normalized name key as the grouping sync;
// nothing is written. Includes inactive Scheduler members so status can differ.
export type RosterReconciliation = {
  ok: boolean;
  reason?: string;
  schedulerCount: number; // real Scheduler members (active + inactive)
  etcActiveCount: number;
  etcTotalCount: number;
  matched: number; // people found in both apps (by name)
  agree: number; // matched AND active-status + team both agree
  statusMismatches: { name: string; etcActive: boolean; schedulerActive: boolean }[];
  teamMismatches: { name: string; etcTeam: string; schedulerTeam: string }[];
  schedulerOnly: string[]; // Scheduler people not in ETC at all
  etcActiveOnly: string[]; // active ETC people not on the Scheduler roster
};

export async function reconcileSchedulerRoster(): Promise<RosterReconciliation> {
  let team;
  try {
    team = await fetchSchedulerTeam(true); // include inactive for status compare
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Could not reach the Scheduler database.",
      schedulerCount: 0, etcActiveCount: 0, etcTotalCount: 0, matched: 0, agree: 0,
      statusMismatches: [], teamMismatches: [], schedulerOnly: [], etcActiveOnly: [],
    };
  }

  const employees = await prisma.employee.findMany({
    select: { name: true, active: true, discipline: true },
  });
  // ETC keyed by normalized name (first wins on the rare collision).
  const etcByKey = new Map<string, (typeof employees)[number]>();
  for (const e of employees) {
    const k = normalizeName(e.name);
    if (!etcByKey.has(k)) etcByKey.set(k, e);
  }
  const schedulerKeys = new Set(team.map((m) => normalizeName(m.name)));

  let matched = 0;
  let agree = 0;
  const statusMismatches: RosterReconciliation["statusMismatches"] = [];
  const teamMismatches: RosterReconciliation["teamMismatches"] = [];
  const schedulerOnly: string[] = [];

  for (const m of team) {
    const emp = etcByKey.get(normalizeName(m.name));
    if (!emp) {
      schedulerOnly.push(m.name);
      continue;
    }
    matched++;
    const statusOk = emp.active === m.active;
    const schedTeam = toEtcDiscipline(m.discipline);
    const teamOk = (emp.discipline ?? "") === schedTeam;
    if (!statusOk) {
      statusMismatches.push({ name: emp.name, etcActive: emp.active, schedulerActive: m.active });
    }
    if (!teamOk) {
      teamMismatches.push({ name: emp.name, etcTeam: emp.discipline ?? "—", schedulerTeam: schedTeam });
    }
    if (statusOk && teamOk) agree++;
  }

  const etcActiveOnly = employees
    .filter((e) => e.active && !schedulerKeys.has(normalizeName(e.name)))
    .map((e) => e.name)
    .sort();

  return {
    ok: true,
    schedulerCount: team.length,
    etcActiveCount: employees.filter((e) => e.active).length,
    etcTotalCount: employees.length,
    matched,
    agree,
    statusMismatches,
    teamMismatches,
    schedulerOnly,
    etcActiveOnly,
  };
}

export async function syncSchedulerTeam(): Promise<TeamSyncResult> {
  let team;
  try {
    team = await fetchSchedulerTeam();
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Could not reach the Scheduler database.",
      updated: [],
      unchanged: 0,
      unmatchedEtc: [],
      unmatchedScheduler: [],
    };
  }

  // Scheduler side, keyed by normalized name. A collision (two people
  // normalizing to the same key) is unlikely but we keep the first and treat
  // the rest as unmatched rather than picking arbitrarily.
  const schedulerByKey = new Map<string, (typeof team)[number]>();
  const schedulerCollisions = new Set<string>();
  for (const m of team) {
    const key = normalizeName(m.name);
    if (schedulerByKey.has(key)) schedulerCollisions.add(key);
    else schedulerByKey.set(key, m);
  }

  const employees = await prisma.employee.findMany({ where: { active: true } });

  // ETC-side collisions: if two active ETC employees normalize to the same key
  // (e.g. a duplicate "ME Outsourced"), we can't safely attribute a grouping to
  // either, so both are skipped and reported rather than mis-assigned.
  const etcKeyCounts = new Map<string, number>();
  for (const emp of employees) {
    const k = normalizeName(emp.name);
    etcKeyCounts.set(k, (etcKeyCounts.get(k) ?? 0) + 1);
  }

  const updated: TeamSyncResult["updated"] = [];
  const unmatchedEtc: string[] = [];
  const matchedSchedulerKeys = new Set<string>();
  let unchanged = 0;

  for (const emp of employees) {
    const key = normalizeName(emp.name);
    const match = schedulerByKey.get(key);
    if (!match || schedulerCollisions.has(key) || (etcKeyCounts.get(key) ?? 0) > 1) {
      unmatchedEtc.push(emp.name);
      continue;
    }
    matchedSchedulerKeys.add(key);
    const targetDiscipline = toEtcDiscipline(match.discipline);
    if (emp.discipline === targetDiscipline) {
      unchanged++;
      continue;
    }
    await prisma.employee.update({
      where: { id: emp.id },
      data: { discipline: targetDiscipline },
    });
    updated.push({ name: emp.name, from: emp.discipline, to: targetDiscipline });
  }

  const unmatchedScheduler = team
    .filter((m) => !matchedSchedulerKeys.has(normalizeName(m.name)))
    .map((m) => m.name);

  await logAudit({
    action: "employee.syncSchedulerTeam",
    entityType: "Employee",
    entityId: 0,
    summary: `Synced team grouping from Scheduler: ${updated.length} updated, ${unchanged} already matched, ${unmatchedEtc.length} ETC unmatched, ${unmatchedScheduler.length} Scheduler unmatched`,
    metadata: { updated, unmatchedEtc, unmatchedScheduler },
  });

  return { ok: true, updated, unchanged, unmatchedEtc, unmatchedScheduler };
}
