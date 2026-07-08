# SDC ETC Planner & Standard Fees — Development Log

This document captures the full history of how these two apps came to be: the
original spreadsheet system they replace, every architectural decision, every
bug found and fixed, and the current state of both apps as of this writing.

---

## 1. Background — what existed before

Three Excel workbooks in `D:\AI Projects\sheets`:

1. **`End Of Month ETC Sheet.xlsx`** — the hub. `Managers Fill Out` tab is
   where managers enter monthly Estimate-to-Complete (ETC) hours per job/section.
   `Monthly ETC Process` / `Monthly ETC Process - Costs` are PivotTables wired
   to a Power BI semantic model (Paylocity for hours, TotalETO for costs).
2. **`Project Planner Data Control.xlsx`** — a parallel/superset workbook with
   an `Employees` tab, `Estimated Hours` tab (job costing ledger), and monthly
   archive tabs (`ETC 2025-02` … `ETC 2025-08`).
3. **`Standard Fees.xlsx`** — downstream. Per-job Execution Rates (ENGR/Shop/
   Parts), a "Standard Fees By Department" section (company-wide monthly hour
   pools per category: Engineering PM/Warranty, Shop Manufacturing/Warranty),
   and a "Submit All ETC and Standard Fees" macro/script chain that Dan
   described as unreliable ("sometimes it works, sometimes it doesn't").

### The meeting with Dan (transcript reviewed early in this project)
Key points that shaped everything below:
- Confidentiality: Standard Fees data must stay separate from the general ETC
  tool — only Dan and Lisa should see it. **Non-negotiable, confirmed two apps
  is the right split.**
- Employee/department lists were manual and drifting from reality — should
  sync from Paylocity. Departed employees' historical hours must never
  disappear (soft-delete, not hard-delete).
- Job/estimate data was manually re-typed into the Planner sheet when a
  project sold; Dan wanted this automated from "the project release" (a
  scheduling-tool concept, distinct from any of the three sheets above).
- The core ETC math: **New ETC = Prior ETC − Hours Worked This Month**, with
  a carry-forward rule (no hours worked ⇒ New ETC = Prior ETC), and manager
  override on top of the system suggestion.
- Dan flagged a stale/orphaned external link in `Project Planner Data
  Control.xlsx` referencing a file called "End of Month Numbers.xlsx" that he
  didn't recognize — confirmed later to be dead/irrelevant.

---

## 2. Decision: replace with two web apps

- **App 1 — SDC ETC Planner** (`D:\AI Projects\sdc-etc-planner`, runs on
  `localhost:3010`): open to managers, tracks jobs and monthly ETC entries.
- **App 2 — SDC Standard Fees** (`D:\AI Projects\sdc-standard-fees`, runs on
  `localhost:3011`): restricted to an allowlist (Dan + Lisa), tracks execution
  rates, fee allotments, category pools, and monthly snapshots.

**Stack:** Next.js (App Router) + TypeScript + Tailwind CSS v4 + Prisma ORM +
MySQL 9.7 (local instance at `D:\AI Projects\MYSQL Database`, databases
`sdc_etc_planner` and `sdc_standard_fees`, kept separate from the pre-existing
`sdc_scheduler` database). Auth via NextAuth (Credentials provider,
email+password, bcrypt-hashed) — a placeholder for eventual Microsoft/Azure AD
SSO, chosen deliberately so it can be swapped without touching the rest of the
app (`User.id` is what everything else keys off).

### Why this design survives future changes
- `Job.source` and `ActualHours.source` / `EstimatedHours` fields are tagged
  (`'manual'`, `'migration'`, `'totaleto_sync'`, `'power_bi'`) so ingestion
  method can change without touching UI or calculation logic.
- Prisma migrations are tracked in git-equivalent files — every schema change
  is reversible and versioned, unlike hand-edited Excel formulas.
- The ETC calculation (`src/lib/etc.ts`) is a pure function, decoupled from
  wherever the underlying hours came from.

---

## 3. Schema evolution (chronological)

### `sdc_etc_planner`
| Model | Purpose | Added when |
|---|---|---|
| `User` | Auth (credentials) | Initial scaffold |
| `Employee` | Synced from Paylocity eventually; soft-delete via `active` flag | Initial scaffold |
| `Job` | Core job record | Initial scaffold |
| `EstimatedHours` | Per-job, per-section hours | Initial scaffold, **redesigned** later |
| `EtcEntry` | Monthly manager-submitted ETC (replaces "Managers Fill Out") | Initial scaffold |
| `ActualHours` | Per-employee/job/month worked hours (source-tagged) | Initial scaffold |
| `Job.customer`, `Job.type` | Confirmed from archive tabs (`ETC 2025-03/05/06`) — needed to show Completed-status jobs, which only exist in this data | After discovering jobs list showed 0 completed projects |
| `EstimatedHours` redesign | Changed from single `hours` field to three: `quotedHours`, `actualHistoricalHours`, `estimateToCompleteHours` — confirmed real structure from the "Estimated Hours" tab | When migrating that tab |
| `JobTask` | Per-employee task assignments (`taskName` + hours, keyed by `slot` 1-11) — free-text data, not fixed section codes | Same migration |
| `Job.startDate/completeDate/includeInTypeCalc/costQuoted/costActualHistorical` | Confirmed from "Estimated Hours" tab columns | Same migration |
| `Job.totEtoEstEngHours/totEtoActEngHours/totEtoEstMfgHours/totEtoActMfgHours/totEtoSyncedAt` | Live TotalETO sync fields | Live-sync build-out |
| `JobMonthlyActualHours` | Live Power BI actual-hours-by-month | Live-sync build-out |

### `sdc_standard_fees`
| Model | Purpose |
|---|---|
| `AllowedUser` | Hard access-control allowlist (Dan + Lisa only), with `passwordHash` |
| `Job` | Mirrors jobId/jobName/status (kept independent from App 1's DB) |
| `ExecutionRate` | Per-job ENGR/Shop/Parts rates — confirmed **not** a global constant; the sheet shows per-job override capability (orange-highlighted exceptions) |
| `FeeAllotment` | Per-job, per-category hour allotments — designed but the real sheet data didn't cleanly map here (see below) |
| `CategoryPool` | Company-wide monthly hour pools per category (Engineering PM/Warranty, Shop Manufacturing/Warranty) — the *actual* structure found in "Standard Fees By Department", added after `FeeAllotment` was found not to match reality |
| `MonthlySnapshot` | Replaces the "Submit All ETC and Standard Fees" script chain — one atomic DB transaction |

---

## 4. Migrations run (one-time, from the .xlsx files)

All read-only against the source files, never modified them.

1. **Employees** ← `Project Planner Data Control.xlsx` "Employees" tab → 122
   rows processed, 111 unique (duplicates collapsed on Paylocity ID — matches
   Dan's data-quality complaint).
2. **Jobs + Execution Rates** ← `Standard Fees.xlsx` "Standard Fees" tab →
   confirmed per-job rate structure (170/140/1.2 defaults, overridable).
   **Bug found and fixed:** initial migration read past the real job table
   (rows 8-60) into unrelated summary rows below, treating text like
   `"Engineering"` in column 0 as a fake Job Id → fixed by requiring `row[0]`
   to be numeric.
3. **Category Pools** ← same file, rows 68-100 ("Standard Fees By Department")
   → 4 rows (Engineering PM/Warranty, Shop Manufacturing/Warranty), confirmed
   exact dollar match to the sheet ($416,500 / $301,393 / $324,800 / $105,714,
   total $1,148,407).
4. **ETC Entries** ← `End Of Month ETC Sheet.xlsx` "Managers Fill Out" tab →
   458 entries across 16 auto-detected section blocks (detected by scanning
   for repeating "Prior ETC" column headers rather than hardcoding positions).
5. **Completed jobs + Customer/Type** ← `Project Planner Data Control.xlsx`
   archive tabs `ETC 2025-03/05/06` → the *only* place `Complete` status,
   `Customer`, and `Type` exist in the source data. Found because the app
   showed zero completed projects and investigation traced it to scope gaps
   in migrations 1-4.
6. **Estimated Hours tab (full)** ← `Project Planner Data Control.xlsx`
   "Estimated Hours" tab → 225 jobs updated with Quoted/Actual
   Historical/Estimate-to-Complete hours per section (1,803 rows), 57
   per-employee `JobTask` assignments, Cost Quoted/Actual, Start/Complete
   dates. This is the richest single source found — confirmed to be the
   literal upstream of the Power BI `Job` table (`Job[Data Source]` =
   `"Estimated Hours"`).

---

## 5. Live data integrations (replacing manual-entry stubs)

Discovered mid-project: real, working MCP server implementations already
existed at `N:\MCP_SERVERS\` for both Power BI and TotalETO (Claude Desktop
extensions, not wired into this session's tools directly, but their
credentials/queries were reusable):

- **Power BI** (`N:\MCP_SERVERS\Powerbi MCP`): interactive Entra login,
  DPAPI-cached token, REST `executeQueries` against workspace
  `d57acc39-0718-434d-a17c-1261d95a4d18` / dataset
  `5a47445c-a1c3-45b9-93e5-a9df3c465b29` (the same semantic model the original
  spreadsheet's `GETPIVOTDATA` formulas pulled from).
- **TotalETO** (`N:\MCP_SERVERS\TotalETO_Claude_Connector`): direct SQL Server
  connection (NTLM auth) to the production `SDC` database at
  `SERVER-APP1.stevendouglas.local`. Reused their hand-built, tested SQL
  queries (`vwProjects`, `vwProjectActualsVSEstimates`) rather than
  reverse-engineering the schema.

### Sync jobs built (all manual-trigger buttons on the App 1 dashboard, per
explicit choice — no scheduled/automatic sync yet)

1. **"Sync Jobs from TotalETO"** — pulls active ("Sold") projects + Est/Actual
   Engineering & Manufacturing hours from `vwProjects` /
   `vwProjectActualsVSEstimates`.
2. **"Sync Actual Hours from Power BI"** — DAX `SUMMARIZECOLUMNS` against the
   `Job` and `Date` tables with the `[Hours Actual]` measure → per-job,
   per-month actual hours (`JobMonthlyActualHours`).
3. **"Sync Quoted Hours & Cost from Power BI"** — `Hours Estimated` table
   (`Hours Quoted`, `Hours Estimated to Complete` per section) and `Cost
   Estimated` table (`Cost Quoted`) — confirmed to match the frozen migration
   values exactly (e.g. Job 788 Cost Quoted = $538,610 in both). **Cost Actual
   Historical was deliberately left un-synced** — no equivalent single Power
   BI measure exists for it (only a parts-specific `Part Cost Actual
   Historical` measure was found), so guessing at a reconstruction was
   rejected in favor of leaving the frozen, known-correct value in place.

### Critical policy: Type-gating on all live syncs
TotalETO has **no** "Type" (Custom/Duplicate/Hybrid/Service) field at all.
Early versions of the TotalETO sync created new `Job` rows for every active
TotalETO project, all with `type = NULL` — 247 phantom jobs. Per explicit
instruction, **a job must have a valid Type
(`Custom`/`Duplicate`/`Hybrid`/`Service`) to ever be imported or shown.**
Fixed by:
- `src/lib/job-filters.ts` — a shared `VALID_JOB_TYPES` constant and
  `validJobTypeFilter` Prisma where-clause, applied to every job-listing
  query app-wide (Dashboard, Jobs list, CSV export, Quoted tab).
- `syncFromTotalEto` now only **updates** jobs that already exist with a
  valid Type — it never creates a new job (since it can't set one correctly).
- The 247 already-created phantom jobs were deleted (cascading through
  `jobmonthlyactualhours`, `etcentry`, `estimatedhours`, `actualhours`,
  `jobtask` first to satisfy FK constraints).
- 2 legacy jobs from the original spreadsheet migration that also lack a
  Type (source data gap, not sync noise) were **kept** — they have real
  linked `EstimatedHours`/`JobMonthlyActualHours` data — but are filtered
  from every display view via the same `validJobTypeFilter`.
- The "New Job" manual-entry form now requires selecting a Type, closing the
  loophole for future manual entries too.

---

## 6. UI build-out

### App 1 — SDC ETC Planner
- **Design system**: SDC brand blue (`#0f6fb8`) + navy sidebar
  (`src/components/AppShell.tsx`), real SDC logo (`public/brand/`, copied from
  `D:\AI Projects\new app\logo`), route-group layout (`src/app/(app)/`) so
  every authenticated page gets the shell automatically.
- **Dashboard** (`/`): stat cards (Total/Active Jobs, Active Employees, ETC
  entries needing review), sync buttons with last-synced timestamps, recent
  jobs list.
- **Jobs** (`/jobs`): flat table (converted from a list view per explicit
  request) with search + auto-submitting status filter dropdown (fixed a UX
  bug where the filter required a separate button click), CSV export,
  Customer/Type columns, Complete/Active badges. Nav shortcuts: **All Jobs**,
  **Active Jobs**, **Completed Jobs**.
- **Job detail** (`/jobs/[id]`): month-selector tabs (fixed a bug where the
  page defaulted to the current calendar month even when a job's only data
  was in a past month — now defaults to the most recent month with data),
  ETC entries with confirm/needs-review workflow, Cost Quoted/Actual cards,
  "Live from TotalETO" card, "Actual Hours by Month (Power BI)" table,
  "Estimated Hours by Section" table (Quoted/Actual Historical/Estimate to
  Complete side by side), "Task Assignments" table.
- **Quoted** (`/quoted`): new flat wide table (24 columns) — Job Id, Name,
  Status, Start/Complete Date, Customer, Type, all 17 section-code quoted-hour
  columns, Cost Quoted, Cost Actual. Sticky first column for horizontal
  scrolling.
- **New Job** (`/jobs/new`): manual entry form, now requires a valid Type.

### App 2 — SDC Standard Fees
- Same design system, red "Restricted access" badge in the sidebar to
  visually distinguish it from the open ETC Planner.
- **Dashboard**: Jobs/Rates count, Category Pool count + latest month's total
  Standard Fee dollar figure (confirmed matches sheet exactly), Monthly
  Snapshot count, category pool breakdown table.
- **Jobs & Execution Rates**: flat table, per-job ENGR/Shop/Parts rate editing
  (inputs linked to off-table `<form>` elements via the `form` attribute,
  since HTML forbids `<form>` as a direct child of `<tr>`), search.
- **Fee Allotments**: category-color-coded table, manual entry form.
- **Monthly Snapshots**: submit button recalculates totals from Fee
  Allotments × Execution Rates as one atomic transaction, replacing the
  "Submit All ETC and Standard Fees" script chain Dan flagged as unreliable.

---

## 7. Bugs found and fixed (chronological)

1. **Migration row-bounds bug** — non-numeric Job Id values from summary rows
   below the real job table were treated as real jobs. Fixed with a `typeof
   row[0] !== "number"` guard.
2. **Cross-origin dev-resource block** — accessing via `server-app1:3010`
   instead of `localhost:3010` silently broke client-side hydration (Next.js
   blocks cross-origin requests to `/_next/*` dev resources by default). Fixed
   with `allowedDevOrigins` in `next.config.ts` on both apps.
3. **Interlaced PNG breaking Next Image optimizer** — the SDC logo file is
   interlaced, which the dev-mode Squoshi/WASM image optimizer can't handle
   (`400 Bad Request`). Fixed with the `unoptimized` prop.
4. **Middleware not excluding `/brand/*` static assets** — unauthenticated
   requests for the logo image got redirected to `/login` and served HTML
   with a `200` status instead of the actual image (silent failure, not an
   error). Fixed by adding `brand/` to the middleware matcher's negative
   lookahead on both apps.
5. **Job detail page defaulting to the wrong month** — always showed the
   current calendar month, so any job whose only data was in a past month
   (e.g. migrated data tagged `2026-06` while "today" is `2026-07`) appeared
   empty. Fixed to default to the most recent month with actual data.
6. **Status filter requiring an extra click** — the dropdown visually showed
   a selection but did nothing until a separate "Filter" button was clicked.
   Fixed with a small client component (`StatusFilterSelect.tsx`) that
   auto-submits the form `onChange`.
7. **`<form>` as a direct child of `<tr>`** — invalid HTML (the parser would
   silently hoist it out of the table, breaking layout). Fixed by rendering
   forms outside the `<table>` and linking inputs/buttons via the `form=`
   attribute.
8. **TotalETO sync creating 247 type-less phantom jobs** — see §5 above.

---

## 8. Explicit design decisions / things intentionally deferred

- **Two apps, not one** — confidentiality requirement from Dan; cannot be
  merged.
- **Manual-trigger sync buttons, not scheduled jobs** — user's explicit
  choice, to keep control/visibility while trusting the new live sources.
- **FeeAllotment vs CategoryPool** — initially assumed fee data was per-job
  (`FeeAllotment`); the real sheet data turned out to be company-wide monthly
  pools (`CategoryPool`). Both models were kept: `CategoryPool` is populated
  and correct; `FeeAllotment` remains in the schema for a hypothetical future
  per-job breakdown but has no real data behind it yet.
- **Cost Actual Historical not synced live** — no verified Power BI measure
  exists for the whole-job figure; left as the frozen, confirmed-correct
  migration value rather than reconstructed and potentially wrong.
- **Two still-open questions from the original Dan meeting, now largely
  resolved by the Power BI/TotalETO integration work**: the "Paylocity report
  scope" gap and the "job/estimate upstream source" question both turned out
  to be answerable directly from Power BI/TotalETO rather than needing a
  meeting with John — though the exact reconciliation between TotalETO's
  Sold-project list and the spreadsheet-derived Type/Customer classification
  is still evolving (see the Type-gating policy in §5).

---

## 9. Current state (as of this log)

- Both apps run locally: App 1 on port 3010, App 2 on port 3011.
- App 1: 228 jobs in DB (226 shown with valid Type, 2 hidden-but-preserved
  legacy rows), live sync buttons for TotalETO jobs/hours, Power BI actual
  hours, and Power BI quoted hours/cost.
- App 2: real Execution Rates, Category Pools (confirmed matching sheet
  totals), Monthly Snapshot workflow, restricted to Dan + Lisa via
  `AllowedUser` allowlist.
- Auth: temporary passwords set for testing (`abhikamuju36@gmail.com` on App
  1; Dan on App 2) — **real password resets still needed before handoff to
  actual users.**
- No production hosting yet — both run via `npm run dev` locally.
