# Workforce C9 — sign-in account-boundary ordering (2026-08-31)

## Scope

`WF-C9-006`/`WF-C9-009` now preserves the existing encrypted Android session,
outbox and local device key when a proposed new sign-in is rejected or cannot
reach the server. The application first receives a successful login response;
only then does it clear the old account boundary before writing the new token.

The ordering retains the security boundary: no token, device binding,
provisioning alias, generic reminder preference or encrypted outbox row can
cross into the newly authenticated account. It only avoids destructive local
data loss on a failed authentication attempt.

## Safety boundary

- This is local session handling only. It does not keep two employee sessions
  active, transfer an outbox row, reuse a device key or change server session
  revocation.
- A successful sign-in still calls the existing `clearAccountBoundary` before
  persisting the new encrypted session.
- QR, device-signature and action-time location proof remain immediate-only
  and cannot be queued by this change.

## Verification

Passed in this worktree:

```text
vitest: Workforce Android foundation source contract
eslint: updated Workforce Android source-contract test
git diff --check
```

`NOT RUN`: Android Gradle lint/unit for this SHA, signed-device failed-login
and account-switch exercise, process-death/logout race, browser E2E, full
typecheck/build, staging and pilot.
