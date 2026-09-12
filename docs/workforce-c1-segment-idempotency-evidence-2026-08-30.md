# Workforce C1d — segment-bound attendance idempotency evidence

> **Status:** `WF-C1-004` implementation evidence; C1 gate remains open
> **Recorded:** 2026-08-30T07:24:00+02:00

## Contract

Workday event schema v3 accepts an optional `segmentId`. Its request digest is
bound to the organization, employee, action, complete time provenance,
schema-version, redacted QR/device-proof fingerprints, and that exact segment
identifier. Reusing an operation ID with a changed v3 segment therefore has the
same deterministic mismatch result as changing any other protected event fact.

The web workday and mobile-sync writers first create the employee workday's
append-only schedule snapshot for a `START` action. When a v3 `segmentId` is
present, the same database transaction requires the identifier to exist on that
employee's snapshot. The workday audit projection includes the segment ID but
never raw QR tokens, device signatures, or location evidence. An assertion
failure aborts the transaction, so it cannot leave an accepted event or sync
result pin behind.

Schema v1 and v2 remain readable and preserve their existing version-2 digest
shape. They cannot smuggle a segment into a v2 claim; a non-empty `segmentId`
requires v3. This is an additive wire contract and needs no data migration.

## Verification

- `PASS` — parser and digest tests prove distinct v3 segment IDs have distinct
  hashes; v2 retains its legacy digest and rejects a supplied segment ID.
- `PASS` — snapshot-writer test accepts only a segment pinned to the exact
  organization/workday/employee snapshot and rejects an unplanned identifier.
- `PASS` — targeted workday, schedule snapshot, site-transition, web/mobile
  adapter suite: 170 tests passed.
- `PASS` — ESLint for changed production files and `git diff --check`.
- `KNOWN BASELINE` — the full test-file ESLint invocation reports eight
  pre-existing `no-explicit-any` findings in older `lib-mtm-workday` test
  lines; the new tests add none.
- `NOT RUN` — full typecheck, build, browser E2E, Android, load and physical
  device checks. They are heavy-worker/CI or real-device gates and must not run
  unbounded on Contabo.

## Remaining C1 work

Effective-dated team history, state-transition risk codes, recovery contracts,
legacy-fact migration planning, and the abuse matrix remain open. This
checkpoint neither enables an attendance pilot nor passes Gate C1.
