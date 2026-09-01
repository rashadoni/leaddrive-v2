# Workforce C6 no-show review scheduler evidence

**Status:** `WF-C6-003` partial; default-deny review-only worker

**Updated:** 2026-09-13

## Delivered boundary

`runScheduledWorkforceNoShowReview` turns the existing C6 candidate and
transaction-only materializer into one bounded, tenant-scoped operational
slice. It is not activated by the Workforce entitlement alone.

- A global expiring job lease and the already-deployed bounded
  `system_job_cursors` table serialize one small slice at a time. The opaque
  JSON cursor contains only progression IDs and date keys, never employee
  attributes, schedule, location, proof, device, QR, explanation or case
  outcome. It is length-checked and fails closed on malformed state.
- The scanner begins only with the immediately preceding fully elapsed UTC
  date. Every candidate then independently re-resolves its own historical
  published shift timezone/start, grace, employment, calendar/leave and
  existing-workday state. The UTC collector date therefore does not become a
  guessed tenant timezone or an attendance conclusion.
- A tenant must have both `workforce-hrm` and the explicit
  `workforce-no-show-review-v1` feature. A Workforce tenant without that flag
  cannot read an employee candidate, call the materializer, create a case or
  receive an audit row from this worker.
- Only an already valid `REVIEW_CANDIDATE` reaches the existing canonical
  transition lock and is re-read in the same serializable transaction. A
  concurrent START, leave/calendar change, missing historical data or lost
  eligibility results in no case. The immutable deduplication subject remains
  exact tenant + employee + segment + expected work date.
- A successful worker can append only the existing raw-proof-free `NO_SHOW`
  review case and its already-defined metadata-only audit. It cannot append a
  human decision, create/fabricate a workday event, notify anyone, change
  payroll, apply discipline or close a case. A second aggregate audit contains
  counts and work date only.
- The CRON_SECRET route exists in source and returns only aggregate `no-store`
  status on success and failure. It is deliberately absent from deployment
  cron configuration until load evidence proves a cadence that satisfies the
  recorded C12 SLO without starving other jobs.

## Explicit non-activation

The worker reuses the generic scheduler cursor migration already carried by
the active repository; this slice adds no schema. No tenant has been given the
no-show feature flag. No deployment cron line, case, notification, decision,
employee appeal, schedule activation, policy activation or production
operation is performed by this checkpoint. The code is a fenced source
implementation, not a claim that LeadDrive is detecting absences.

The outstanding work is still material: database/RLS concurrency proof, named
responsible reviewers and employee-visible schedule-only appeal path, tenant
rollout decision, measured SLO/cadence sizing, isolated staging rehearsal,
physical/mobile evidence and pilot observation.

## Verification

```text
PASS  npx vitest run
      workforce-no-show-review-scheduler,
      api-cron-workforce-no-show-review
      (2 files, 8 tests)
PENDING exact-SHA required PR checks

NOT RUN  full typecheck/build/browser E2E/Android/load; disposable-DB
         RLS/concurrency; actual Cron, tenant-flag, notification, staging,
         physical-device, pilot and production verification. Contabo is not a
         heavy-run or staging substitute.
```
