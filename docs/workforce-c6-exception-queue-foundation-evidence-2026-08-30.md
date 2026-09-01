# Workforce C6 — exception-queue foundation evidence

**Status:** WF-C6-005 partial safe web/API slice.
**Date:** 2026-08-31

## Delivered safe projection

`src/lib/workforce/exception-queue.ts` projects a case from an authorized,
tenant-scoped read. `GET /api/v1/workforce/exceptions` now preserves the
session-admin Workforce boundary until the explicit granular-access cutover;
after cutover it requires an organization-scoped `HR_ADMIN` grant with
`TEAM_EXCEPTION_READ`, an exact organization filter and a hard 250-case limit.
It returns only the display reference, employee display name,
approved taxonomy/triage level, age, derived lifecycle stage, evidence
availability, employee-response state and one explicit human next action.

- Raw location, QR, device material, evidence payload, decision reason and
  database identifiers are absent.
- The recommended lifecycle is evaluated from the complete supplied decision
  code sequence. Unknown/contradictory data is routed to
  `DATA_INTEGRITY_REVIEW`, never presented as resolved.
- A received employee response returns the case to HR acknowledgement/review;
  it cannot resolve, correct, pay or discipline automatically.
- Unknown type, invalid display data and a future-created case fail closed.
- The API sends `private, no-store` and `nosniff` headers. It refuses an
  oversized review result instead of silently truncating it.

## Delivered review surface

`/workforce/exceptions` renders a responsive, read-only tenant-admin workbench
in English, Russian and Azerbaijani. Each row shows the bounded safe fields
needed for normal triage: reference, employee, type, risk, localized age,
lifecycle stage, evidence completeness, employee-response state and next
human action. Error copy is generic, so server error detail is not reflected
to the browser.

The page has no raw-proof affordance and no mutation control. Its explicit
boundary says it cannot alter attendance, pay or discipline. The voice
navigation catalog also describes this administrator-only read surface without
claiming it can read or resolve case data.

## Deliberate non-activation boundary

This is not a complete exception lifecycle. It intentionally has no mutable
resolution, correction, payment or disciplinary action; no notification;
no raw-evidence reader; no historic team/site queue (a current employee team
must never authorize access to a historical case); and no real case-linked
employee appeal/response write. The current field is an honest `NOT_REQUESTED`
state until the C6-006 case/segment lifecycle is connected. A later C6/C7/C8
slice must provide indexed immutable case scopes, granular team/site queues,
immutable employee-visible response links and a reviewed resolution flow before
any case can be resolved.

## Verification

    PASS  CI=true npx vitest run \
          src/__tests__/voice-guide-coverage.test.ts \
          src/__tests__/voice-section-coverage.test.ts \
          src/__tests__/lib-workforce-exception-queue.test.ts \
          src/__tests__/api-workforce-exceptions.test.ts
          (4 files, 16 tests)

    PASS  npm run i18n:check (21,381 EN leaf keys; RU/AZ parity)

    PASS  targeted ESLint for the changed queue and voice files, and
          `git diff --check` in this worktree.

    NOT RUN  local browser E2E, full typecheck/build, migration apply,
             disposable-DB/RLS grant exercise, notification, Android, physical
             pilot and staging load. Contabo is restricted to small sequential
             checks; browser/Android/full-build evidence must come from CI or
             an approved heavy worker.
