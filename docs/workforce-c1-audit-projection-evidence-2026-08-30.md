# Workforce C1b — transactional attendance and request audit evidence

> **Status:** `WF-C1-005` implementation evidence; C1 gate remains open
> **Recorded:** 2026-08-30T00:57:42+02:00

## Atomic audit contract

Each new canonical workday event now writes its standard `MtmAuditLog`
projection inside the exact transaction that writes the workday/event and, for
mobile sync, the idempotency result. The web and mobile adapters use the same
`writeWorkforceWorkdayAuditInTransaction` helper. An HR request decision now
writes its `hrm_request_decision` projection inside the transaction that changes
the request, availability calendar/correction facts and notifications.

The projection is deliberately minimal: action, channel, actor/workday/event
identity, provenance timestamps, schema version, request digest and redacted
before/after workday summaries. It never contains exact coordinates, QR tokens,
device signatures or transient biometric/device proof. Those facts remain in
the canonical event and dedicated verification ledger. Request-decision audit
data is limited to the decision, supplied decision note and conflicting Route
IDs; it does not add attendance evidence or raw location.

If an audit insert fails, it throws before a mobile sync result is pinned, a web
success response is returned, or an HR request decision is read back as
successful. In PostgreSQL's interactive transaction this rejects the whole
transaction, so the visible fact, immutable ledger and result pin/decision
cannot commit with an audit gap. A replay reads the immutable event or terminal
request rather than creating another audit projection.

## Verification

- `PASS` — web workday API test asserts its audit is an in-transaction
  `MtmAuditLog.create` and has no coordinate/accuracy/battery data.
- `PASS` — mobile workday API test asserts audit precedes the atomic sync pin.
- `PASS` — failure injection rejects the audit insert and produces no successful
  mobile result or idempotency pin; the real interactive transaction provides
  the database rollback boundary.
- `PASS` — request-decision unit/API tests assert the decision audit is
  transactional; an injected request-audit failure has no successful result.
- `PASS` — targeted workday/mobile-sync/request-decision tests: 172 tests
  passed.
- `NOT RUN` — full `tsc --noEmit`: `codex-heavy-run` correctly refused because
  the shared-host heavy-check lock is unavailable. No unwrapped heavy check was
  substituted.

`WF-C1-003` (immutable review case) and the C2 segment identity binding in
`WF-C1-004` are still open. This checkpoint does not mark the C1 phase gate
green.
