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

---

## 10. Data-accuracy audit, corruption fixes, and production hardening (2026-07-14)

A full-day accuracy audit against the real manager-signed workbooks
(`Old ETC Sheets/` and `old standard sheets/` — April/May/June 2026
snapshots), followed by end-to-end testing that found and fixed four distinct
historical-month corruption vectors. Summary (full detail in the session
memory files under `reopen-run-report-corruption-fix` and friends):

### Data corrections
- **June 2026 ETC** had drifted (163 wrong cells, one job's data missing, two
  unreviewed jobs' quoted costs injected) because Power BI hadn't archived
  June yet and a test submission froze live/suggested values. Rebuilt
  April/May/June `EtcEntry` from the workbooks' `ETC Export`/`Managers Fill
  Out` tabs — verified 0 mismatches per month afterward.
- **Standard Fees.xlsx itself was found stale** (its per-job Execution ETC
  VLOOKUP never refreshed — byte-identical across 3 months). The app's live
  computation was correct; froze `StandardSheetSnapshot` for April–June from
  it, pulling per-job Contingency (the one live column) from the workbook.
- **CategoryPool history** verified against Power BI's `Standard Fees` archive
  (0 mismatches, 2025-10…2026-03). 2025-06's `needsReview` migration oversight
  fixed. July 2026 started via the real workflow (carry-forward verified).

### Corruption vectors found by testing, all fixed
1. **Run Report on a reopened historical month** re-seeded/pruned it against
   TODAY's job roster and actuals (proven: 42 real entries deleted, 62 wrong
   ones injected). → `isSafeForLiveEtcSync` guard (`etc.ts`); Run Report and
   Clear ETC now refuse any month but the single current one.
2. **Submit and Lock on a reopened historical month** pruned entries for
   since-completed jobs (366→323 rows, proven live). → `getEtcMonthJobWhere`
   renders historical months from their own entries even while unlocked;
   `submitMonth` never prunes historical months.
3. **Empty New ETC inputs on resubmit** were replaced with recomputed
   suggestions, erasing manager overrides. → historical `submitMonth` keeps
   stored values when inputs are empty/missing.
4. **The grid auto-fill seeded zero-worked cells with Prior ETC** (and blank
   for worked cells), so a no-touch UI resubmit posted wrong overrides (135
   cells at risk in April; ~120 corrupted once, restored). → `EtcSectionCells`
   /Parts Cost inputs seed from the stored confirmed value on historical
   months (`initialConfirmed`); reopen+resubmit proven a true no-op through
   the real `submitMonth`.

### Other hardening in this batch
- `StandardSheetLive` crashed on month switches (state seeded once from
  props; different month = different job set → `rates[jobId]` undefined).
  Fixed with safe fallbacks + backfill effect, AND at the root: both grids
  now remount per month (`key={month}`), which also fixes stale typed values
  surviving soft navigation in the ETC grid.
- Historical sync (`sync-etc-history.ts`) now detects months that are locked
  in-app but have since gained a real Power BI archive, and flags them in the
  audit log (`monthsOwnedWithPbiHistoryNow`, pools too) instead of silently
  trusting a premature lock forever.
- `middleware.ts` → `proxy.ts` (Next 16 deprecation); auth gating verified
  intact (307 to /login, /brand + /login still open).
- Audit Log gate brought up to the Standard Sheet gate's standard: refuses
  the default password in production, HMAC unlock cookie, constant-time
  compares.
- `?month=` params validated on /etc and /standard-sheet; all Standard Sheet
  month actions go through one validating choke point, so a crafted month
  can never freeze snapshot rows under a garbage key.
- `.gitignore` now excludes the local `.xlsx` source workbooks and design
  folders (company financial data stays out of the repo).

### Test coverage added
- `tests/etc.test.ts` grew to 23 tests: `isSafeForLiveEtcSync`,
  `hasPublishedHistory`, `groupStandardFeesRows` regression suites.
- One-off (not committed) harnesses exercised every server action against the
  real DB with request-scoped bits stubbed — 37/37 checks passed (validation,
  guards, writes, cleanup) — plus data-helper edge cases and a full
  reopen→submit round-trip through the real `submitMonth`.

### Known remaining gaps (deliberate, documented)
- `ExecutionRate` is not month-scoped: editing a rate affects the open
  month's live view (frozen snapshots immune). Schema change deferred.
- June 2026 has no independent source of truth until Power BI archives it —
  treat as provisional; "Sync History" will flag it when the archive lands.
- Cost Actual Historical stays frozen at migration values (no verified
  Power BI measure) — unchanged policy.

---

## 11. Standard Sheet consolidated into the Monthly ETC page (2026-07-15)

The separate `/standard-sheet` tab (App 1's confidential Standard Fees view)
was **retired** and its entire workflow folded into the Monthly ETC page's
password-gated Standard view. Committed as `27fb135`, `60a304d`, `64f5bc3`.

### Hidden entry point
- The Standard Sheet password box no longer appears on `/etc`. It renders only
  with a secret `?standards=1` flag, reached by **clicking the "Monthly ETC"
  sidebar item three times** (≤1.5s window). The real security is unchanged —
  the HMAC unlock cookie in `standard-sheet-gate.ts`; this only hides the door.

### Global execution rates (was per-job)
- The per-job ENGR/Shop/Parts rate columns were removed. Rates are now a single
  **global** set entered via an **"ETC Rates"** toolbar button, stored on the
  `StandardSheetSetting` singleton (migration `add_global_standard_rates` added
  `engrRate`/`shopRate`/`partsMarkup`; `contingencyRate` already lived there and
  joined the same popover). Applied to every job on the page.
- **Semantic shift to confirm with Dan/Lisa:** historical per-job rate
  exceptions (the sheet's orange overrides) are no longer applied — every job
  freezes at the global rate.

### Grid layout changes
- Column order in the grid: **Total (New ETC) now precedes Parts Cost**.
- The inline Standard block dropped its Eng/Shop/Parts ETC columns; it now runs
  Total ETC · % Total | Standard Fees | Contingency | Total Std Fees | Notes,
  with the sheet's heavy gray dividers between each block.

### Standard Fees By Department panel + full workflow on /etc
- A **side panel** next to the grid shows the department pool block, with the
  same carry-forward fallback the old tab used (also now applied to the inline
  fee math, so the two never disagree / collapse to $0).
- The panel is **editable** (Hours pulled + Rate) and hosts **Refresh Pools**
  (Power BI), **Save Pool Cells**, **Submit & Lock**, and **Reopen** (admin).
- Per-job **Contingency $ and Notes** are editable inline (autosave, one server
  action per field so neither clobbers the other).
- The month **freeze** (`submitStandardSheetMonth`) now stamps the **global**
  rates instead of per-job `ExecutionRate` rows. A **submitted month renders
  the frozen snapshot inline** (`StandardRatesProvider` `frozenRows`), immune to
  later rate/pool edits — the freeze-integrity guarantee the tab had.
- All actions moved to `src/lib/standard-sheet-actions.ts` (revalidate `/etc`).

### Deleted
- `/standard-sheet` route (`page.tsx`, `layout.tsx`) and the now-dead
  `StandardSheetLive`, `MonthSelect`, `ExecutionRateInput`, and
  `saveExecutionRateField`. Nav tab removed from the sidebar.

### Not yet done / caveats
- **Not verified live** — the migration touches the financial freeze but the dev
  preview can't authenticate past the external login, so the end-to-end
  Refresh→edit→Submit→Reopen flow still needs a real user pass before trust.
- `StandardSheetSnapshot` still carries per-row `engrRate/shopRate/partsMarkup`
  columns; they now just hold the global value for every row.
