# Workforce administrator guide

This guide describes the current server-backed Workforce web module. It does
not describe Route & Field, payroll, background employee tracking or a released
mobile attendance app.

## Start safely

1. Open **HRM → Configuration** (`/workforce/configuration`). Only an
   administrator or superadministrator can use this surface.
2. Create policy and shift definitions as drafts. Review timezone, weekdays,
   expected work, tolerances, planned breaks and any ordered site segments.
3. Activate only a future-effective definition. Activation does not rewrite a
   workday that already started or finished.
4. Use named employee/team/site previews before publishing an assignment. A
   preview is discardable and does not grant access or modify a schedule.
5. Keep the tenant-wide default at the approved Baku baseline unless a reviewed
   tenant policy says otherwise: Monday-Friday, 09:00-18:00, eight expected
   work hours, 13:00-14:00 planned break and 15-minute late grace.

## Sites, geofences and attendance security

- A Workforce site is separate from a Route customer. Create the named site,
  then add a future-effective calibrated circle and review impacted Workforce
  assignments.
- A circle and a GPS result are review evidence, not proof of identity or
  physical presence. Weak, stale, mocked or boundary-overlapping GPS must not
  be silently accepted.
- QR stations bind to the tenant, Workforce site, effective geofence revision,
  action, expiry and nonce. A valid QR can still be photographed or relayed;
  the physical trust pilot remains mandatory before stronger claims.
- Device approve/revoke/replace and station create/disable/replace operations
  require the server's Workforce admin boundary and enrolled MFA. Do not share
  an administrator session or approve your own linked device.
- The mobile write fence and exact cohorts are rollout/containment controls.
  Freezing Workforce must not disable Route & Field or delete queued/history
  data.

## Daily review

- **HRM → Today** (`/workforce`) shows current server state and allowed workday
  actions.
- **HRM → Timesheet** (`/workforce/timesheet`) shows recorded days and approval
  blockers. Never approve a period with missing snapshots, unresolved blocking
  cases or invalid history.
- **HRM → Requests** (`/workforce/requests`) contains leave, absence and time
  correction requests. A rejection requires an accountable note; route overlap
  is a conflict to review, not an automatic HR decision.
- **HRM → Exceptions** (`/workforce/exceptions`) is a human-review queue. It
  cannot by itself change pay, discipline or attendance facts.
- **HRM → Reports** (`/workforce/reports`) reads hash-verified immutable
  approvals. Overtime is an operational deviation, not a payable amount.
- **Site transitions** (`/workforce/reports/site-transitions`) reports claimed
  arrivals/departures and pair completeness without raw GPS/QR/device proof.

## Export and incident handling

Preview an approved revision before download. The ordinary export contains only
allowlisted time facts; it excludes raw coordinates, QR/device proof, free-text
appeals and payroll conclusions.

- Sync/outbox recovery: [Workforce sync support playbook](./workforce-sync-support-playbook.md)
- Privacy/security incident: [Workforce incident runbook](./workforce-c10-privacy-security-incident-runbook-2026-08-30.md)
- Cohort freeze/rollback and retention: [Workforce pilot runbook](./workforce-pilot-rollback-retention-runbook-2026-08-28.md)

Do not delete history, restore/drop a database, mass-enable a cohort or treat a
report as payroll/disciplinary evidence while handling an incident.
