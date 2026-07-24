/**
 * PM2 Ecosystem Config — SDC ETC Planner (standalone)
 *
 * Next.js 16 app (Prisma/MySQL) on port 3010. Runs as its own PM2 app under the
 * same interactive-user PM2 daemon as the rest of the SDC Tools estate, so it
 * survives an RDP session closing / a reboot (with `pm2 save` + startup).
 *
 * The Scheduler team board calls this app's /api/integration/employees, so it
 * must be running for the board's Unassigned/Inactive cards to populate.
 *
 * ── Deploy ─────────────────────────────────────────────────────────────────
 *   1. Build:            npm run build          (from this folder)
 *   2. Stop any dev:     stop `npm run dev` / preview on 3010 first
 *   3. Start:            pm2 start ecosystem.config.js
 *   4. Persist:          pm2 save
 *   restart after code change:  npm run build && pm2 restart sdc-etc-planner
 *
 * Env: Next.js auto-loads this folder's .env (DATABASE_URL, SCHEDULER_SHARED_TOKEN,
 * TotalETO/PowerBI creds, etc.) — no need to duplicate secrets here.
 *
 * ── Port ───────────────────────────────────────────────────────────────────
 *   sdc-etc-planner   3010   (open inbound TCP in Windows Firewall for LAN)
 */

module.exports = {
  apps: [
    {
      name:          'sdc-etc-planner',
      // `next start` — serves the production build in .next. Invoke the Next
      // CLI directly so PM2 manages a single node process (no npm shim).
      script:        'node_modules/next/dist/bin/next',
      args:          'start -p 3010',
      interpreter:   'node',
      cwd:           'D:\\AI Projects\\sdc-etc-planner',
      env: {
        PORT:             '3010',
        NODE_ENV:         'production',
        NODE_NO_WARNINGS: '1',
      },
      watch:         false,
      max_restarts:  10,
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:    true,
    },
  ],
};
