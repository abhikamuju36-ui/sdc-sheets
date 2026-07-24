import "server-only";
import mysql from "mysql2/promise";

// Read-only connection to the SDC Scheduler's MySQL (sdc_scheduler), used to
// mirror its team roster/grouping into ETC (see sync-scheduler-team.ts). The
// Scheduler owns team_members; ETC only ever READS it here.
//
// Fail-closed, exactly like scheduler-api-auth.ts: if SCHEDULER_DATABASE_URL is
// not set, the connector throws a clear error rather than guessing a host. That
// keeps the feature dormant until the connection string is deliberately set on
// the ETC host (both apps live on the same server, so this is a local reach).
//
// SCHEDULER_DATABASE_URL format:
//   mysql://user:pass@host:3306/sdc_scheduler
// A dedicated read-only MySQL user is strongly recommended.

const globalForSchedulerDb = globalThis as unknown as {
  schedulerPool: mysql.Pool | undefined;
};

export function isSchedulerDbConfigured(): boolean {
  return Boolean(process.env.SCHEDULER_DATABASE_URL);
}

function getPool(): mysql.Pool {
  const url = process.env.SCHEDULER_DATABASE_URL;
  if (!url) {
    throw new Error(
      "Scheduler sync is not configured: set SCHEDULER_DATABASE_URL (read-only MySQL) on the ETC host.",
    );
  }
  // Reuse one pool across HMR reloads / requests (same trick as prisma.ts).
  if (!globalForSchedulerDb.schedulerPool) {
    globalForSchedulerDb.schedulerPool = mysql.createPool({
      uri: url,
      connectionLimit: 3,
      // This app must never write to the Scheduler DB.
      // (Enforced by convention + a dedicated read-only user; we only SELECT.)
      namedPlaceholders: true,
    });
  }
  return globalForSchedulerDb.schedulerPool;
}

export type SchedulerTeamMember = {
  name: string;
  discipline: string;
  active: boolean;
  isLead: boolean;
  sortOrder: number | null;
  specialty: string | null;
};

// Every active, real team member (placeholders like "ME Placeholder" are the
// Scheduler's own assignment stand-ins, not people, so they're excluded).
export async function fetchSchedulerTeam(): Promise<SchedulerTeamMember[]> {
  const pool = getPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT name, discipline, active, is_lead, sort_order, specialty
       FROM team_members
      WHERE active = 1
        AND name NOT LIKE '%Placeholder%'
      ORDER BY discipline, sort_order, name`,
  );
  return rows.map((r) => ({
    name: String(r.name),
    discipline: String(r.discipline),
    active: Boolean(r.active),
    isLead: Boolean(r.is_lead),
    sortOrder: r.sort_order == null ? null : Number(r.sort_order),
    specialty: r.specialty == null ? null : String(r.specialty),
  }));
}
