# Session theft and cookie hardening audit — 2026-07-22

## Scope

Checked the browser/session theft path from the original security checklist:

- main CRM NextAuth session cookie
- JWT/session invalidation after password change and "log out all devices"
- pending 2FA session behavior
- organization deactivation behavior for session-cookie helpers
- OAuth state cookies
- customer portal JWT cookie

## Result

Fixed one P1 issue in the central API auth helper.

Before this patch, `requireAuth()` blocked sessions with pending 2FA, but the lighter `getSession()` / `getOrgId()` helpers could still resolve an authenticated `orgId` for a session whose JWT had `needs2fa` or `needsSetup2fa`. Many routes use those helpers directly through `withRls` or local route code, so a stolen pre-2FA cookie could potentially reach data paths that did not use `requireAuth()`.

After this patch, `getSession()` returns `null` when:

- `session.user.needs2fa` is set
- `session.user.needsSetup2fa` is set
- the organization is inactive, for non-superadmin users

Because `getOrgId()` calls `getSession()` first, the fix also prevents those sessions from resolving an `orgId`.

## Evidence

### Existing protections confirmed

- Main CRM session uses JWT strategy with `maxAge = 8 hours`.
- Main session cookie is configured as:
  - `httpOnly: true`
  - `sameSite: "lax"`
  - `secure: true` in production
  - `__Secure-authjs.session-token` name in production
- `passwordChangedAt` is used as a session-valid-after cutoff.
- Self-service password change updates `passwordChangedAt`.
- Self-service "log out of all devices" updates `passwordChangedAt`.
- `requireAuth()` already blocks pending 2FA and stale password-change sessions.
- Cross-tenant tenant-subdomain mismatch clears the shared session cookie and redirects to login.
- Social OAuth state cookies are short-lived (`maxAge: 1800`) and use `httpOnly`, `sameSite: "lax"`, and production `secure`.

### Fixed behavior

- `getSession()` now mirrors the same MFA floor as `requireAuth()`.
- `getSession()` now blocks inactive organizations for normal users, closing lighter-helper routes that do not pass through `requireAuth()`'s org-status gate.
- Regression tests assert:
  - `getSession()` returns `null` when `needs2fa` is pending.
  - `getSession()` returns `null` when `needsSetup2fa` is pending.
  - `getSession()` returns `null` for inactive organizations.
  - `getOrgId()` does not resolve an org while 2FA is pending.

## Residual findings

### P2 — Portal login returns JWT in JSON for native clients

`POST /api/v1/public/portal-auth` sets an `httpOnly` `portal-token` cookie for web and also returns the same JWT in the JSON body for native clients. The web login page ignores `json.token`, but browser JavaScript can still read the response body.

This is intentional for the native loyalty app, which has no cookie jar and stores the Bearer token in device keychain. Still, the safer future design is to split web and native token issuance, for example:

- web login: set only the `httpOnly` cookie, no token in JSON
- native login: require an explicit native client header/version and return the Bearer token

Not changed in this patch to avoid breaking existing native clients without confirming their request contract.

### P3 — No per-device session list

The app supports "log out all devices" through `passwordChangedAt`, but there is no first-class per-device session registry for viewing and revoking one device at a time. This is not a bypass because all-session revocation works, but device-level revocation would improve containment after suspected token theft.

## Reusable checklist for other projects

1. Confirm auth cookies are `httpOnly`, `secure` in production, `sameSite=lax/strict`, and have a constrained path/domain.
2. Confirm session lifetime is bounded.
3. Confirm password change invalidates old sessions.
4. Confirm "log out all devices" invalidates old sessions.
5. Confirm pending 2FA sessions cannot access any API helper, not only the main guard.
6. Confirm inactive/deleted users fail closed.
7. Confirm inactive organizations fail closed.
8. Confirm cross-tenant/subdomain mismatch clears or rejects shared cookies.
9. Confirm OAuth state cookies are signed, short-lived, and `httpOnly`.
10. Confirm no browser login endpoint exposes bearer/session JWTs in JSON unless explicitly required.

## Verification

Commands run from `/tmp/leaddrive-session-audit-w9xD4e`:

- `./node_modules/.bin/vitest run src/__tests__/lib-api-auth.test.ts src/__tests__/session-invalidation.test.ts src/__tests__/api-users-me-change-password.test.ts`: passed, 48 tests
- `./node_modules/.bin/vitest run src/__tests__/lib-api-auth.test.ts`: passed, 36 tests
- `./node_modules/.bin/eslint src/lib/api-auth.ts`: passed
- cookie-setting scan reviewed for main session, OAuth state cookies, and portal token cookie
- `git diff --check`: passed

Notes:

- Full project `npm run typecheck` was not rerun in this worktree; the previous dependency-audit worktree hit Node heap OOM even at 4 GB.
- `node_modules` was symlinked from `/tmp/leaddrive-dependency-audit-oHYtVY/node_modules` because this machine's disk was at 100% and a fresh `npm ci --ignore-scripts` failed with `ENOSPC`.
