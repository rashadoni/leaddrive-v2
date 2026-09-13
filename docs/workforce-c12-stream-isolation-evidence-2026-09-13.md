# Workforce C12 stream-isolation evidence

**Status:** WF-C12-004 partial; server request pipelines are isolated, while
mobile scheduling, sustained overload and database-failover drills remain
open.
**Last verified:** 2026-09-13

## Delivered proof

The API contract exercises the separately entitled `routes` and `workforce`
v2 streams through their real handlers and shared guard boundary:

- a Workforce protection-service outage returns only a bounded no-store `503`
  with `Retry-After: 5`, while a concurrent Route pull completes normally;
- a Route snapshot dependency timeout returns its bounded `503`, after which a
  Workforce pull completes normally;
- both handlers address the guard with their exact stream key, and neither
  response contains or advances the other stream's cursor.

This is executable server isolation evidence. It does not simulate an Android
queue scheduler or claim that one physical handset keeps the second stream on
time under a long outage.

## Verification

- **PASS:** targeted ESLint for the isolation contract.
- **PASS:** targeted Vitest, 1 file and 2 tests, covering concurrent Workforce
  protection failure and a Route dependency timeout.
- **PASS:** `git diff --check`.
- **NOT RUN:** Android offline queue timing, sustained 503/429 overload,
  process death, database failover and staging load. Those remain part of the
  C12/C14 external exercise.
