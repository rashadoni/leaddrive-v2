# Workforce C14 security matrix

**Status:** partial source/server evidence for `WF-C14-002`.
**Date:** 2026-09-13.

| Threat lane | Executable evidence | Current result | Residual gate |
|---|---|---|---|
| Tenant/RLS | `src/__tests__/with-workforce-rls-auth.test.ts`; `src/__tests__/api-workforce-attendance.test.ts`; `src/__tests__/lib-workforce-access-grant-resolution.test.ts` | Tenant context is required, scoped grants fail closed and cross-tenant identifiers are not accepted as authority | Disposable PostgreSQL RLS exercise remains part of staging verification |
| Role/IDOR | `src/__tests__/lib-workforce-access-control.test.ts`; `src/__tests__/api-workforce-site-transition-reports.test.ts`; `src/__tests__/api-workforce-timesheet-approvals.test.ts` | Self, team, site and organization scopes remain explicit; missing/foreign records use bounded denial paths | Browser role matrix remains `WF-C14-003` |
| Replay/backdating | `src/__tests__/lib-mtm-workday.test.ts`; `src/__tests__/workforce-site-transition-facts.test.ts`; `src/__tests__/workforce-attendance-trust.test.ts` | Idempotency binds the full request; old/future transitions and a current QR attached to historical work time are rejected | Signed offline process-death/reboot evidence remains `WF-C14-004` |
| QR relay assumptions | `src/__tests__/workforce-attendance-security.test.ts`; `src/__tests__/workforce-attendance-trust.test.ts` | QR tokens bind tenant, station, site, geofence revision, action, nonce and short expiry | A photographed/relayed valid QR remains a documented residual risk until physical proximity/device evidence is exercised |
| GPS spoof/quality | `src/__tests__/workforce-location-evidence-policy.test.ts`; `src/__tests__/workforce-gps-edge-matrix.test.ts`; `src/__tests__/workforce-attendance-risk-signals.test.ts` | Mock, stale, weak, impossible-coordinate, clock and impossible-travel signals become review or unavailable, never automatic guilt/presence | Real provider/mock behavior on two signed devices remains `WF-C14-004` |
| Attestation/biometric | `src/__tests__/workforce-attendance-security.test.ts`; `src/__tests__/workforce-attendance-trust.test.ts` | Unsupported attestation declarations and unverified biometric requirements fail closed; a device signature binds the exact action | No physical hardware-backed attestation chain or biometric prompt has been verified |
| Admin abuse/recovery | `src/__tests__/workforce-attendance-management.test.ts`; `src/__tests__/workforce-attendance-security-mfa.test.ts`; `src/__tests__/workforce-mobile-write-fence.test.ts` | MFA, separation of duties, replacement lineage, revocation and cohort write fences are enforced at server boundaries | Named pilot ownership and real recovery drill remain `WF-C14-007`/`009` |

`src/__tests__/workforce-c14-security-matrix.test.ts` prevents a lane or mapped
test from silently disappearing and locks the three residual physical/staging
claims above. Green source tests do **not** mean that QR relay resistance,
hardware attestation, biometric user presence, production RLS or a signed-device
recovery flow has been proven. Therefore `WF-C14-002` remains `PARTIAL` until
those external gates are completed and the resulting findings are reviewed.
