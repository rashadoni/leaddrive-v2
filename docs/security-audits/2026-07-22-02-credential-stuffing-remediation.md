# Remediation Report: Credential Stuffing

- Date: 2026-07-22
- Related audit: `2026-07-22-02-credential-stuffing.md`
- Code commit: `b9084ad76`
- Status: partially remediated; production deployment not performed from this checkpoint
- 2FA: not enabled or changed

## Implemented

- Added a shared `passwordPolicyError` helper with a local high-signal denylist of common breached passwords.
- Added support for extending the denylist through `COMPROMISED_PASSWORDS` without logging values.
- Applied the policy to CRM user creation, admin password changes, self-service password changes, password reset, and portal password setup.
- Added regression tests for common-password rejection, accepted strong password, and length validation.

## Verification

- Targeted suite: **PASS** — 5 files, 56 tests.
- `git diff --check`: **PASS**.
- No production requests, password changes, or 2FA changes were made.

## Remaining risks

- Rate-limit state is still process-local; a shared Redis limiter is required for multi-worker resilience.
- No new-device notification or adaptive risk score is implemented yet.
- A successful login does not automatically revoke other active sessions; password change and explicit `revoke-sessions` do.
- The denylist is intentionally conservative and local; a larger managed breach corpus requires an operational update process.

## Gate

This category is paused before deployment. The owner must approve deployment of `b9084ad76` and decide whether the remaining risks are accepted or need a follow-up implementation. Do not start category 3 until that decision is recorded.
