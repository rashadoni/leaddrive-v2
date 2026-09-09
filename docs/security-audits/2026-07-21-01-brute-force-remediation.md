# Remediation Report: Brute Force and Login Protection

- Date: 2026-07-21
- Scope: category 1 from the security audit standard
- Status: partially remediated; production deployment not performed
- Related finding report: `2026-07-21-01-brute-force.md`

## Implemented fixes

1. Two-factor verification is now server-authoritative. A short-lived nonce (5 minutes) is generated during the challenge, and the session callback clears `needs2fa` / `needsSetup2fa` only after an atomic database consume. A client cannot clear either flag by sending a forged session update.
2. The public POST rate limiter now runs before the middleware's public-route early return, so client portal login is covered by the coarse IP limit.
3. Client portal login has an additional per-organization-and-email limit (5 attempts/minute), using a one-way hash as the limiter key. Portal authentication failures now return a uniform 401 response.
4. CRM credential login has a principal limit (10 attempts/minute) in addition to the existing IP limit.
5. Admin and superadmin accounts are required to complete 2FA (or setup) for both credentials and OAuth sessions.
6. Password recovery endpoints are explicitly public and remain rate-limited; unauthenticated requests no longer get intercepted by the generic auth redirect.
7. MTM login no longer reveals whether an organization or agent exists; these cases return the same generic 401 response.

## Verification

- Targeted security/auth suite: **PASS** — 9 files, 235 tests.
- Full Vitest suite: **838 passed, 3 skipped, 3 unrelated failures** (RLS timing flake, versioned help-video asset expectation, and an environment/module-resolution failure in the WhatsApp webhook suite).
- `git diff --check`: **PASS**.
- TypeScript check: **NOT PASS / blocked** — `tsc --noEmit` exceeded the available memory at both the default limit and a 4 GB limit.
- Targeted ESLint: **NOT PASS** — existing `any`/`Function` lint violations remain in the touched legacy files; no new lint-only cleanup was attempted.
- Build and production smoke: **NOT RUN**; no deployment or external state change was made.

## Residual risks

- Rate-limit state is still process-local. A distributed deployment needs a shared Redis (or equivalent) limiter before this control can be considered resilient to worker restarts and rotating IPs.
- Portal and MTM user flows do not yet have a complete user-facing MFA enrollment/challenge flow. Admin and superadmin CRM/OAuth access is enforced; extending MFA to these clients needs a product decision and UX implementation.
- CRM invalid-user timing and persistent failed-login audit events are not fully uniform yet.

## Gate for the next category

The next audit category must not start until the remaining risks above are either accepted explicitly or scheduled with an owner and deadline. This report is the checkpoint for approval.
