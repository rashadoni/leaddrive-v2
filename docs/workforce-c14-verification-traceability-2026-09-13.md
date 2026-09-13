# Workforce C14 verification traceability

**Status:** accepted source-test register for `WF-C14-001`.
**Date:** 2026-09-13.

This register maps every C14-001 calculation domain to executable tests. It is
not evidence of a signed-device run, browser matrix, staging load drill or human
pilot. Those remain separate C14 gates and cannot be inferred from unit tests.

| Domain | Required invariant | Maintained executable evidence |
|---|---|---|
| Time | Ordered START/PAUSE/RESUME/FINISH transitions remain idempotent; replayed immutable facts reproduce bounded worked/pause/deviation totals | `src/__tests__/lib-mtm-workday.test.ts`; `src/__tests__/workforce-timesheet-calculation.test.ts`; `src/__tests__/workforce-workday-facts-replay.test.ts` |
| Schedules | Tenant-local dates, overnight shifts, effective versions and published snapshots resolve deterministically without rewriting started days | `src/__tests__/workforce-calendar.test.ts`; `src/__tests__/workforce-shift-resolution.test.ts`; `src/__tests__/workforce-policy-resolution.test.ts` |
| Geofence | Accuracy-aware distance and boundary decisions fail to review rather than claim presence; GPS edge inputs stay finite and bounded | `src/__tests__/workforce-geofence-evaluation.test.ts`; `src/__tests__/workforce-gps-edge-matrix.test.ts`; `src/__tests__/workforce-location-evidence-policy.test.ts` |
| Evidence composition | Versioned evidence envelopes and configured QR/location/device combinations retain provenance and do not manufacture stronger assurance | `src/__tests__/workforce-evidence-envelope.test.ts`; `src/__tests__/workforce-proof-policy.test.ts`; `src/__tests__/workforce-evidence-storage.test.ts` |
| Assessment | Trust, risk signals and human-readable explanations remain deterministic, bounded and review-oriented | `src/__tests__/workforce-attendance-trust.test.ts`; `src/__tests__/workforce-attendance-risk-signals.test.ts`; `src/__tests__/workforce-assessment-explanation.test.ts` |
| Exceptions | Intake, no-show/missed-finish candidates and append-only case facts preserve exact subject and human lifecycle boundaries | `src/__tests__/lib-workforce-exception-intake.test.ts`; `src/__tests__/lib-workforce-no-show-candidate.test.ts`; `src/__tests__/lib-workforce-missed-finish-candidate.test.ts`; `src/__tests__/lib-workforce-exception-case-ledger.test.ts` |
| Retention | Raw location and time-decision deletion windows obey holds, tenant scope, bounded batches and fail-closed preflight | `src/__tests__/workforce-raw-location-retention.test.ts`; `src/__tests__/workforce-retention-guard.test.ts`; `src/__tests__/workforce-time-decision-retention.test.ts` |
| Approvals | Immutable calculations, blockers, revision hashes and export allowlists prevent approval or export of incomplete/live-mutated facts | `src/__tests__/workforce-timesheet-approval.test.ts`; `src/__tests__/workforce-timesheet-approval-service.test.ts`; `src/__tests__/workforce-timesheet-export.test.ts`; `src/__tests__/workforce-timesheet-rehydration.test.ts` |

`src/__tests__/workforce-c14-traceability.test.ts` is the maintenance guard:
it requires all eight domains, at least two distinct executable test files per
domain, an exact mention of every mapped file in this register, and a real
non-skipped test declaration in every mapped file. A renamed or deleted test
therefore fails CI instead of silently eroding the release argument.

## Explicit boundary

The mapped tests prove server/source invariants only. They do not prove that a
specific Android build received a real GPS fix, scanned a physical rotating QR,
passed provider attestation, survived OS process death/reboot/date rollover, or
was accepted by a named worker. `WF-C14-004`, `WF-C14-006`, `WF-C14-007` and
`WF-C14-009` retain their independent physical/external evidence requirements.
