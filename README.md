# SDC ETC Planner

Replaces the `Project Planner Data Control.xlsx`, `End Of Month ETC Sheet.xlsx`,
and `Standard Fees.xlsx` workbooks with a single web app: monthly
Estimate-to-Complete tracking, the Projects (quoted hours) grid, and the
Standard Fees calculation — sourced live from Power BI (Fabric warehouse +
SharePoint) and TotalETO.

Next.js 16 (App Router) · React 19 · Prisma / MySQL · next-auth v5.

## Development

```bash
npm run dev        # dev server with hot reload, http://localhost:3010
```

Use `localhost:3010` (not the hostname) in dev — see the dev-origin note in
`next.config.ts`.

## Production

```bash
npm run build      # optimized build (also runs the type check)
npm start          # production server on port 3010
```

`npm start` runs the same server dev uses, minus hot-reload — faster, lower
memory, and it surfaces prod-only type/route errors at build time. The
10-minute Power BI auto-sync (`src/instrumentation.ts`) runs under `npm start`
exactly as in dev.

**Run it as a durable service** (so it survives logout/reboot) rather than a
bare `npm start` in a terminal. On this Windows server the simplest options are
a scheduled task set to run at startup, or a process manager (e.g. `pm2` /
`nssm` wrapping `npm start`). The app must run on **SERVER-APP1** — it is the
MySQL host and the TotalETO SQL host (`10.0.0.7`), so both are local.

If a build ever fails the type check on a `/standard-sheet` route error, delete
the stale preview build dirs and rebuild: `rm -rf .next .next-preview*` then
`npm run build`. (They are git-ignored and tsconfig-excluded; this only matters
if an old dev:preview run left them behind.)

## Environment

All secrets live in `.env` (git-ignored): `DATABASE_URL`, the `PBI_*` Power BI
service-principal credentials, `TOTALETO_DB_*`, `AUTH_*` (next-auth + Entra),
and the Standard-Sheet / Audit-Log gate passwords. See `.env` for the full set.

## Tests

```bash
npm test           # node:test unit tests for the ETC / Standard Fees math
```

## Data sources & freshness

- **Hours worked, quoted hours, ETC history, Standard Fees** — pulled from the
  Power BI semantic model (Fabric warehouse + SharePoint) every 10 minutes.
- **Jobs / costing** — synced from TotalETO directly (`src/lib/sync-totaleto.ts`).
- The ETC header shows a red banner if Power BI's own upstream dataset refresh
  is failing, so stale-upstream data never goes unnoticed.

The committed `Job Hours Report - *.Report` / `.SemanticModel` folders are the
Power BI source of truth this app replicates; the `.SemanticModel` TMDL holds
every measure's DAX and was used to verify the app's calculations 1:1.
