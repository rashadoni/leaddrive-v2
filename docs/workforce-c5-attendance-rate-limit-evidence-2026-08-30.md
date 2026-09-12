# Workforce C5 attendance rate-limit evidence

**Task:** `WF-C5-011`

**Date:** 2026-08-30

**Status:** partial server-side hardening; no mobile, hardware-attestation,
central alerting or production exercise is claimed

## Delivered safe slice

Three security-sensitive endpoints now use separate, one-minute fingerprinted
rate-limit buckets after authentication and basic request validation but before
their security-sensitive database work:

- device-enrollment start: 3 requests per employee/tenant/minute;
- device-enrollment proof: 5 requests per employee/tenant/enrollment/minute;
- administrative QR issue: 60 requests per administrator/tenant/station/minute.

The limiter sees only a derived fingerprint key, not the tenant, employee,
administrator or station identifier. Each denial is a `429` with a bounded
`Retry-After: 60`, `cache-control: no-store` and a generic
`WORKFORCE_ATTENDANCE_RATE_LIMITED` code. It does not write a noisy audit row
or log a QR token, challenge, signature, public key, device identifier or
location material.

The pre-existing enrollment challenge expiry is still enforced transactionally:
the proof lookup requires `consumedAt: null` and `expiresAt > now`, then marks
the challenge consumed conditionally before marking a key verified. QR tokens
remain tenant/station/action-bound, short-lived and nonce-fingerprinted.

## Explicit remaining C5-011 work

- The current limiter is in-process. Multi-instance deployment requires a
  centrally shared rate-limit store and an SRE-owned availability/fail-open
  policy; this code does not pretend a process-local map is a fleet-wide
  defence.
- Key/secret rotation needs an approved key-management contract, key IDs and
  overlapping verification window. It is not safe to invent a rotation source
  or silently rotate the global auth secret here.
- Security-event alert routing/runbook and an alert delivery simulation remain
  open. The rate-limit response deliberately avoids event-log flooding.
- Physical Android key storage, attestation and biometric assertions remain
  C5-003 through C5-006/C9 work, not web/server evidence.

## Checks run in this worktree

- targeted attendance API/security/management and rate-limit Vitest suite —
  17 tests PASS;
- targeted ESLint for all changed source and test files;
- `git diff --check` before checkpoint.

## Not run

- centralized-store/multi-instance rate-limit test, secret rotation drill,
  security-alert delivery, full typecheck/build, browser E2E, Android or load
  test. Those are CI, `codex-heavy-run`, a temporary Mac worker or real
  controlled-staging work; they were not run on Contabo.
