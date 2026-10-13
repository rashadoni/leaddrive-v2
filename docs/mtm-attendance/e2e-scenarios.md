# MTM attendance end-to-end scenarios

## Execution and meaning of results

The executable suite is `scripts/mtm-attendance-browser-evidence.mjs`, with its
empty-database fixture in `scripts/fixtures/mtm-attendance-e2e.mjs`. It runs only
through `.github/workflows/mtm-attendance-e2e.yml` on GitHub-hosted Ubuntu 24.04.
The input is an exact 40-character commit SHA; the script verifies the checkout
and hashes the tested sources. PR runs also use the exact PR head.

The environment is a real Next development server, Chromium, real credentials
sign-in and a disposable PostgreSQL 16 database. No authentication mocks, HTTP
response fixtures or production tenants are used. Six web principals cover the
administrator, read-only HR, team manager, office employee, field employee and a
foreign tenant. Office and field credentials also obtain real mobile tokens.
A 58-person fictional roster exercises pagination and automatic participation.

A result is **not yet a test pass merely because this file exists**. The current
run's `manifest.json` records PASS, FAIL or NOT_RUN separately for every named
case, alongside transport, dates, source hashes, screenshots and a control
inventory. An earlier setup failure leaves subsequent cases NOT_RUN. A failed
assertion fails the workflow. `workflow-result.json` preserves setup failures
that occurred before the harness could start.

`browser-navigation` means a real page, data response and sidebar destination;
it does not mean every control was exercised. `browser-action` means actual
clicks, text entry or selection and server-side confirmation. `authenticated-http`
and `mobile-http` are real route flows but **not browser clicks or APK tests**.
The control inventory is explicitly inventory-only. No global claim that every
possible combination was tested is permitted.

## Scenario ledger

| Family | Real HTTP / database assertions | Browser interactions |
| --- | --- | --- |
| Main report | Tenant/team scopes; denied employees; invalid range; exact snapshot Excel/PDF | Six forms; month grid; next/previous page; date/team/employee filters; invalid range; real downloads |
| Personal forms | Create/replay/update/stale/delete; owner isolation | Save/open/rename; cancel deletion; confirm deletion |
| Delivery schedules | Empty initial recipients; invalid recipient; disabled create/replay/update/stale/delete; no receipt queued | Invalid recipient; disabled create/edit format/frequency; cancel/confirm delete |
| Rules/calendar | Future version; invalid clock; holiday create/edit/delete; stale and past edits rejected | Initial rendering; rule/calendar mutation click flows tracked separately below |
| Day kinds | Rename; stale revision; cannot remove system kind | Open/search/edit/save; cancel new kind and preset |
| Request quotas | Save; invalid values rejected | Open/change hours and count/save |
| HR grant | Grant; stale write; all-employee reading; write rejection; fresh-session revocation | Search; start and cancel revocation |
| Employees | Existing/new user automatic inclusion; no invented hire facts; exclude/reinclude/idempotency; preserve field role; HR write denied | Search, pagination, included/excluded filtering, switch round trip, history open/close |
| Employment history | Hire/termination/rehire order; stale chain rejected | Read history panel |
| Branches | Create/replay/revise/stale; primary assignment; manager cannot assign outside team | Create/cancel/edit/archive |
| Branch report | Real shared report snapshot | Date/team/employee filters; PDF download |
| Geo policy | OFF default; no legal text rejected; fictional publication/consent/withdrawal; restore OFF | Incomplete text disables activation; save OFF; no coordinates submitted |
| Employee requests | Submit/replay; approved/rejected/cancelled; revoke annual leave; HR/foreign denial | Expand, approve, require rejection reason, reject, cancel revocation, revoke; employee sees result |
| Decision journal | Persisted decisions from real requests/HR recording | Date/status filter, export, request deep link |
| HR recording | Multi-person batch; replay; duplicate employee rejection; HR read-only denial | Team selection, day kind/date/reason, preview, save, start new record |
| Installations | Request; approve/reject/revoke/replay; HR denial | Approve, required reason, history, revoke; employee sees state |
| QR | Real policy route and generated code | Enable, display, refresh, hide on background, return, disable |
| Risks | Seeded fictional clock hint; real dismissal/replay; HR denial; workday unchanged | Initial report rendering; dismissal click flow tracked separately below |
| Shifts | Day/night plans; cycle and roster; stale revision | Create/cancel, night clocks, add/remove cycle slot, publish |
| Leave balances | Missing policy; fictional tier/profile; calculated allowance; HR write denial | Pagination; edit opening balance and publish |
| Closed months | Prior-period fact; stale preview; close/replay; frozen table survives rename; Excel/PDF; foreign denial | Select frozen period/snapshot, Excel/PDF download |
| Mobile workday | Actual credential login; START/PAUSE/RESUME/FINISH; exact operation retries; four events; immutable completed fact | Reflected in web reports; physical APK explicitly NOT_RUN |
| Layout/navigation | All 14 routes require successful authenticated data reads | 13 sidebar active destinations + recording page; AZ/RU/EN employee view; 390px overflow check |

All 14 attendance routes are enumerated directly: root, requests, decisions,
employees, branches, branches/report, shifts, leave-balances, months,
installations, branch-qr, review, location-settings and recordings.

## Remaining acceptance work (must not be relabelled PASS)

The first hosted execution and selector/fixture stabilization remain **NOT RUN**
until the workflow actually completes. At initial authoring the following still
need browser mutation cases beyond their existing real HTTP coverage:

- Rules save and calendar create/edit/delete/cancel.
- Actual HR grant/revoke confirmation, employment history recording, day-kind
  create/archive/restore, and primary branch assignment.
- Risk dismissal; leave policy publication; month preview/blockers/close.
- Uncertain-network recovery controls and queued offline state; deliberately
  stale browser tabs; attachment upload/download/invalid file checks; exhaustive
  pagination at each separate queue limit and every permission/role combination.
- Physical Samsung S23 Ultra APK, real camera QR, Android permissions, offline
  queue, process death/restart, background/foreground, and overnight endurance.
- Real outbound email and client-approved legal text: intentionally no provider
  sends, cron execution, real recipients or client location collection here.

A bounded automated suite cannot establish an exhaustive claim about “all
scenarios”; changes must extend the named ledger and show their actual result.
The physical-device run is an additional artifact, never inferred from CI.

## Database fidelity and safety

The harness refuses any non-loopback target, production NODE_ENV, missing
GitHub/CI flags, wrong database name or role, and a non-empty initial fixture.
`prisma db push` supplies the current complete schema. The fixture then replaces
only empty attendance tables/columns and replays the actual attendance
migrations, employment history, retained workforce immutable/RLS block,
completed-workday guard and the later completed-workday function replacement.
This restores real request, branch, consent, risk, installation, month,
participation and lifecycle guards rather than permissive lookalikes.

The runtime role is NOSUPERUSER/NOBYPASSRLS. Remaining tenant tables without
shipping RLS in this schema fixture receive the application's tenant-context
policy; existing attendance/workforce policies are not broadened. The harness
checks unscoped and foreign-tenant reads fail closed. Admin connection privileges
exist solely for synthetic fixture preparation and invariant inspection.

The seeded risk is marked as a seeded case: its detector algorithm is not
proved by the dismissal test. Historical month facts are also explicitly seeded
DB fixtures, not claimed phone submissions. Final privacy invariants check geo
and QR OFF, no coordinate rows, no delivery schedules, and the foreign tenant
unchanged.

No auth cookies, tokens, passwords, raw SQL, runtime logs or network trace are
uploaded. Failure records contain a safe route/status, source line and error
class; screenshots show only disposable fictional data. The workflow holds no
production secrets and neither invokes a deployment nor contacts production.

## Authoring verification — 2026-10-14 (Asia/Baku)

- PASS: syntax checks for both new modules.
- PASS: GitHub runner policy for the workflow set.
- NOT RUN on Contabo: install, full application build, full typecheck,
  PostgreSQL integration and Chromium. Host contract puts heavy work in CI.
- Hosted execution: pending; this document is a scenario plan, not a green run.
