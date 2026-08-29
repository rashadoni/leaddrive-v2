# Workforce C1a — attendance provenance and offline-boundary evidence

> **Status:** implementation evidence for C1a; C1 gate remains open
> **Recorded:** 2026-08-30T00:43:00+02:00
> **Applies to:** the independent `workforce-hrm` workday ledger and its web
> and mobile-sync adapters; it does not enable a physical attendance pilot.

## Contract implemented

`MtmAgentWorkdayEvent` now preserves distinct employee claim, local capture,
durable outbox queue, server receipt and transactional application times.
`occurredAt` remains the backward-compatible transport field and must equal
`claimedAt`; a client cannot supply a competing workday time. The server
assigns `serverReceivedAt`, and `appliedAt` is written only inside the
canonical state-transition transaction.

| Version | Compatibility contract |
|---|---|
| `1` | Existing clients may omit new provenance values. The server records claim/capture as `occurredAt`, records its receipt, and marks `schemaVersion=1`. No omitted evidence is fabricated. |
| `2` | `claimedAt`, `capturedAt` and `queuedAt` are explicit, valid and ordered; `claimedAt` equals `occurredAt`. The server supplies receipt/application time. |

The shared parser used by both the legacy week endpoint and mobile sync rejects
claims older than seven days and any timestamp over five minutes in the future.
A genuine retry of an accepted C1 operation may replay after that window, but a
new stale event cannot become a normal attendance fact.

## Idempotency and integrity boundary

New workday events and mobile-sync result pins store a SHA-256 request digest.
It binds tenant, authenticated employee, operation ID, action, workday ID,
claim/capture/queue times, schema version, coordinates, accuracy, note and
non-reversible QR/device-proof fingerprints. Raw QR tokens and device
signatures are never stored as event data.

The C2 segment slot is reserved as a canonical `null` field until C2 adds an
effective-dated segment identifier. `WF-C1-004` is therefore **PARTIAL**:
changed payloads already fail deterministically for today's workday model, but
the final digest cannot bind a segment that does not yet exist. C2 must replace
the reserved value with an immutable segment reference and add a segment replay
test before that task is done.

Legacy facts and old sync pins have no digest/provenance added retroactively.
They use compatibility replay only; their evidence remains `LEGACY/UNKNOWN`,
never attested by a migration.

## Migration and safety

The additive migration adds nullable provenance fields, a `(1, 2)` schema
version constraint, a receipt-time query index and the sync-operation digest.
It contains no `UPDATE`, `DELETE`, `TRUNCATE`, rename or backfill. Existing
immutable events retain null unknown fields and version `1`.

No automatic approval, payroll or disciplinary decision is introduced.
`WF-C1-003` still needs an immutable claim/review case and the owner-approved
`PENDING_REVIEW` policy. `WF-C1-005` still needs failure-injection evidence
that every accepted decision has a reconstructable audit projection.

## Evidence

| Requirement | Evidence |
|---|---|
| `WF-C1-001` | Versioned parser contract and event provenance columns; parser unit tests cover v2 fields and server-owned receipt time. |
| `WF-C1-002` | The shared parser is called by the week and mobile-sync workday adapters; unit/API tests cover seven-day rejection and adapter behavior. |
| `WF-C1-004` | A changed v2 mobile payload under an already pinned operation ID returns `WORKFORCE_WORKDAY_IDEMPOTENCY_MISMATCH`; segment binding is deferred to C2. |
| `WF-C1-009` | The migration contract test proves no historical rewrite; dry-run counts/reconciliation remain C13/DBA work. |

### Checks run in this worktree

- `PASS` — `npx prisma validate` with an inert local validation URL; no database
  connection or mutation was made.
- `PASS` — `npx prisma generate`.
- `PASS` — targeted Vitest: `api-mtm-mobile-sync`, `api-mtm-week`,
  `lib-mtm-workday`, and `migration-workforce-c1-attendance-provenance`:
  150 tests passed.
- `PASS` — `git diff --check`.
- `NOT RUN` — full typecheck/build, browser E2E, Android/physical-device,
  migration apply and load testing; these need an approved heavy or isolated
  environment.
