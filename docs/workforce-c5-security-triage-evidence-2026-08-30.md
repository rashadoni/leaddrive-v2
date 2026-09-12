# Workforce C5 attendance-security triage evidence

**Task:** `WF-C5-009`

**Date:** 2026-08-30

**Status:** partial review-only server implementation; no fraud decision,
disciplinary action, device revocation or automated review-case lifecycle is
claimed

## Delivered safe slice

`GET /api/v1/workforce/attendance/security-triage` is a session-admin,
device-trust-entitled, bounded read-only diagnostic. For at most 500 active
employees, it examines only aggregate recent activity and returns a review
prompt if it finds one or more of:

- more than one distinct trusted device used for attendance verification in
  the last 15 minutes;
- three or more enrollment attempts in the last 24 hours; or
- twelve or more accepted attendance events in the last 15 minutes.

The response includes employee identity for the authorized reviewer and only
aggregate counts/risk codes. It never returns device enrollment IDs, key
material, signatures, QR tokens/nonces, coordinates or raw evidence. The audit
record contains only the aggregate number of examined employees/candidates,
rule codes and time windows — no employee/workday/device identifier.

Every result is explicitly `REVIEW_REQUIRED_NO_AUTOMATIC_ACTION`. A threshold
is not proof of fraud: multiple devices, replacement attempts and rapid event
activity can have legitimate explanations. The endpoint neither mutates a
workday nor changes a device state.

## Deliberate remaining boundary

`WF-C6` must define the accountable exception taxonomy, employee response,
appeal and append-only lifecycle before a triage result can create or resolve a
formal review case. The current review-case table has one immutable case per
event and cannot safely be repurposed for an unrelated, multi-event anomaly.
`WF-C7-001/002` must also replace the temporary tenant-admin access with a
separate device-security/reviewer scope. This slice does not guess either
policy.

The thresholds are conservative review prompts, not tenant policy settings.
They need controlled pilot calibration, fairness review and a real alerting
owner before any operational rollout.

## Checks run in this worktree

- targeted triage/API/trust/security Vitest suite — 14 tests PASS;
- targeted ESLint for all added triage source and tests;
- `git diff --check` before checkpoint.

## Not run

- database query-plan/5k employee check, central alert delivery, C6 formal
review workflow, pilot threshold calibration, full typecheck/build, browser
E2E, Android or staging load. These require CI, `codex-heavy-run`, temporary
Mac worker or real controlled-staging/pilot evidence and were not run on
Contabo.
