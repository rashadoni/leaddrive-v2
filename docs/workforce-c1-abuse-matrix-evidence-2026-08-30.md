# Workforce C1i — workday abuse matrix evidence

> **Status:** `WF-C1-010` is **DONE** at its server Security/QA boundary. The
> time/replay/concurrent-device matrix and the configured Android-version
> mutation boundary are executable; native identity and physical-device proof
> remain separate C5/C9/C14 work.
> **Recorded:** 2026-08-30; updated 2026-09-13

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
| Missing, malformed, expired or too-new Android version after deliberate policy configuration | New Workforce mutation is rejected with a structured, retryable response before transaction/state write | `workforce-mobile-release-policy`, `api-mtm-week` and `api-mtm-mobile-sync` tests |
| Exact stored outbox replay from an expired client | Canonical stored outcome remains available without reapplying the mutation | `api-mtm-mobile-sync` expired-client replay test |

The second-device result is deliberately a **state-integrity** result, not an
identity conclusion.  It prevents two active workdays for the same authenticated
employee, but a request header or cohort device ID does not prove that the
employee, rather than a person holding their session, performed the action.
Cryptographic enrollment, key lifecycle, app attestation, local unlock and
concurrent-device risk policy remain C5/C9 work and must not be claimed by C1.

## App-version boundary

`schemaVersion` is a version of the Workforce request contract, **not** an APK
or iOS binary version. The separate Android `versionCode` policy is inert when
its server values are absent. Once an accountable release deliberately
configures a coherent minimum/recommended/maximum window, both the direct
mobile workday transport and offline sync reject **new** unsupported Workforce
mutations. Browser fallback and Route-only operations remain independent.

Offline reconciliation is not stranded: an exact operation already pinned in
the idempotency ledger still returns its canonical result. Unknown new outbox
operations are rejected after the separately required adoption/offline-horizon
drain decision; code in this slice does not set production values or guess a
package, signing identity, store, device matrix or adoption threshold.

## Checks and limits

- `PASS` — targeted Vitest: `workforce-mobile-release-policy` 6/6,
  `api-mtm-week` 47/47 and `api-mtm-mobile-sync` 97/97 (150 tests total).
- `PASS` — targeted ESLint for both production routes, release-policy source,
  release-policy test and mobile-sync test.
- `PASS` — `git diff --check`.
- `NOT CLEAN (pre-existing)` — whole-file ESLint for `api-mtm-week.test.ts`
  reports 19 existing `no-explicit-any` violations outside this diff; the new
  test adds none. Required repository CI remains authoritative.
- `NOT RUN` — local full typecheck/build, browser E2E, physical Android,
  QR/device-key and hardware-attestation checks; these stay in CI/heavy and
  C5/C9/C14 lanes.

This evidence adds no automatic discipline, payroll conclusion, device trust
or background location collection.
