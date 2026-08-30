# Workforce C5 attendance-security MFA evidence

**Task:** `WF-C5-002`

**Date:** 2026-08-30

**Status:** partial server-side hardening; it protects critical attendance
security administration but does not claim a mobile per-use step-up or a
physical-device assurance result.

## Delivered safe slice

The following state-changing Workforce attendance security actions now require
all of the following before validation or a database write:

- a current human browser session (never an API key);
- the existing tenant admin/superadmin and add-on capability check; and
- a fresh database read of the accountable user's mandatory MFA policy with an
  enrolled factor: TOTP, or SMS with a verified phone.

The gate covers QR-station creation and retirement, QR issue, trusted-device
approval or revocation, and the high-impact mobile write-fence/cohort controls
that can enable a pilot cohort or stop mobile attendance writes. A missing
user, optional MFA, an unconfigured factor, a non-session principal, or an
MFA-policy lookup error denies the operation. The latter is a `503`, so an
unavailable policy lookup cannot turn into a fail-open write.

The session resolver still rejects sessions that are pending mandatory MFA;
the Workforce gate additionally makes the per-user enrollment requirement
explicit on these high-impact actions. Roles do not substitute for an MFA
factor. The code neither selects nor mutates recovery codes, so the established
accountable recovery/reset flow remains intact.

## Deliberate boundary

This server has no signed, short-lived "recent re-auth" assurance claim in its
session contract. It therefore cannot honestly claim a per-use step-up or
employee mobile MFA. Those require the real mobile client and C5-003 through
C5-006/C9 hardware/app assurance work. The gate is also intentionally limited
to attendance-security factor administration; it does not silently redefine
the broader HR configuration authorization policy.

## Checks run in this worktree

- targeted attendance MFA and attendance API Vitest suite — 12 tests PASS;
- `git diff --check` before checkpoint.

## Not run

- full typecheck/build, browser E2E, Android/device-authentication smoke,
  multi-instance/session-age testing, physical QR/controller test and staging
  pilot. These are CI, `codex-heavy-run`, a temporary Mac worker or controlled
  pilot checks and were not run on Contabo.
