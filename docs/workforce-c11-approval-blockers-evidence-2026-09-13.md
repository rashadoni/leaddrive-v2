# Workforce C11 approval blockers evidence — 2026-09-13

## Scope

This checkpoint closes `WF-C11-002` and the matching `WF-C7-008` approval
fence. It does not activate an exception detector, infer a missing schedule,
change an attendance fact, decide pay/discipline, or resolve an HR case.

## Server-owned approval decision

The approval request continues to contain only employee and bounded date
scope. Under the canonical per-employee workday fence, the server rebuilds
every row from immutable policy, shift, event and correction history. It now
returns exact safe blockers for:

- an unfinished recorded workday;
- a missing policy or shift snapshot;
- workday history that cannot be replayed;
- an unresolved current-calculation attendance deviation;
- an unresolved C6 case linked by workday, workday event, or an expected
  no-show date in the requested period;
- an unknown, invalid or overlong C6 decision history, which is presented as
  data-integrity review rather than guessed as resolved.

Only a complete C6 decision sequence whose evaluated stage is `RESOLVED` is
non-blocking. A stale calculation exception from an older calculation version
does not block a newer correction revision. Case and decision reads are hard
bounded; overflow fails closed instead of silently truncating approval facts.

Approval acquires the canonical employee workday fence, discovers the bounded
case set, locks every C6 decision stream in deterministic case-ID order using
the same advisory-lock helper as the decision writer, and then re-reads the
lifecycle. A resolution or reopen that wins the lock is therefore visible to
approval; one that waits is serialized after the approval transaction.

## Reviewer disclosure and minimization

The session-only approval endpoint returns `private, no-store` and `nosniff`
headers. A blocker contains only date, optional workday ID, safe `WF-` case
reference, allow-listed exception type and lifecycle stage. It contains no
coordinates, QR token, device proof, biometric data, employee explanation,
decision reason or mutable calculated input.

The Workforce timesheet validates that response against fixed allow-lists and
shows the exact date, safe reference, reason, type and stage in EN/RU/AZ. An
unexpected server value is not interpolated as a translation key.

## Verification

PASS in the exact checkpoint tree:

- `npx vitest run src/__tests__/workforce-timesheet-approval-service.test.ts src/__tests__/api-workforce-timesheet-approvals.test.ts src/__tests__/workforce-timesheet-approval-blockers-ui-contract.test.ts src/__tests__/lib-workforce-exception-case-writer.test.ts --pool=forks --maxWorkers=1` — 4 files / 28 tests, including a deterministic reopen-before-lock case;
- scoped ESLint for the service, route, UI and three test files;
- `npm run i18n:check` — EN/RU/AZ parity;
- `git diff --check`.

`NOT RUN`: local full TypeScript compile, production build and browser E2E.
They are heavy gates reserved for GitHub CI. Real tenant cases, a signed
physical Android client, two device classes and the named human pilot remain
external evidence and are not claimed by this source checkpoint.
