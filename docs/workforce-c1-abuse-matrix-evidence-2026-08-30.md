# Workforce C1i — workday abuse matrix evidence

> **Status:** `WF-C1-010` is **PARTIAL**.  The server-side time/replay and
> concurrent-device cases are covered; a binary app-version policy cannot be
> truthfully implemented before the Android application, distribution owner
> and supported-version window are approved.
> **Recorded:** 2026-08-30

## Covered negative cases

| Threat / misuse | Server result | Automated evidence |
|---|---|---|
| New claim older than the seven-day offline horizon | Rejected before transaction or event write | `lib-mtm-workday`, `api-mtm-week`, mobile-sync adapter tests |
| New web claim older than its five-minute online allowance | Rejected before workday mutation | `api-mtm-week` workday boundary test |
| Any client-controlled occurrence/capture/queue time over the five-minute future skew | Rejected by the shared parser | `lib-mtm-workday` future-controlled provenance test |
| Exact retry / cross-channel replay | Replays canonical immutable result without a second state mutation | `lib-mtm-workday`, `api-mtm-week`, `api-mtm-mobile-sync` replay tests |
| Same event/operation ID with changed payload, actor, evidence or segment | Deterministic idempotency conflict and canonical recovery; no new write | digest/replay tests in the same three suites |
| A second mobile device tries a distinct `START` while the employee already has an active workday | Per-agent transaction lock returns canonical conflict; no second workday/event is created | `api-mtm-week` second-mobile-device test |
| Unknown workday protocol schema | Rejected before state mutation | `lib-mtm-workday` unsupported schema test |

The second-device result is deliberately a **state-integrity** result, not an
identity conclusion.  It prevents two active workdays for the same authenticated
employee, but a request header or cohort device ID does not prove that the
employee, rather than a person holding their session, performed the action.
Cryptographic enrollment, key lifecycle, app attestation, local unlock and
concurrent-device risk policy remain C5/C9 work and must not be claimed by C1.

## App-version boundary

`schemaVersion` is a version of the Workforce request contract, **not** an APK
or iOS binary version.  C1 correctly rejects unknown request schemas but has
no mobile binary, signed build identity, distribution track, adopted-version
telemetry, approved minimum/maximum version, forced-upgrade behaviour or safe
offline-drain period from which to decide that an application is expired.

Enforcing a guessed version header would be unsafe: it could strand a valid
seven-day offline outbox or block an employee without the approved non-mobile
fallback.  Therefore the remaining condition is intentionally held for
`OD-01`/`OD-15`, `WF-C9-001/002/014` and `WF-C13-003/008`.  Their eventual
contract must return an explicit structured upgrade response only after the
owner records the supported window and drain policy.

## Checks and limits

- `PASS` — targeted Vitest `lib-mtm-workday` + `api-mtm-week`: 66 tests
  passed, including the new future, unknown-protocol and second-device cases.
- `PASS` — `git diff --check`.
- `NOT RUN` — CI/browser E2E, physical Android/app-version, QR/device-key and
  hardware-attestation checks.  No mobile app or approved temporary worker is
  present in this worktree; full checks remain outside Contabo.

This evidence adds no automatic discipline, payroll conclusion, device trust
or background location collection.
