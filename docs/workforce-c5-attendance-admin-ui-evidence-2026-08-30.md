# Workforce C5 attendance administration UI — partial evidence

**Status:** partial; no C5 acceptance task is closed by this slice
**Date:** 2026-08-30
**Scope:** administrator visibility and safe lifecycle controls for the existing
short-lived QR and trusted-device backend primitives.

## Delivered boundary

The Workforce configuration page now contains an administrator-only
**Attendance security controls** surface.

- It lists the existing tenant-scoped QR stations and their status, bound site
  label/reference and rotation interval.
- An administrator selects an attendance action and requests a fresh QR for an
  active station. The server converts the already-issued short-lived signed
  payload into an image data URL; the web surface renders the image and expiry,
  but never renders, stores or logs the QR token as text.
- A station can be disabled. This is a lifecycle action, not destructive
  deletion.
- It lists the existing trusted-device lifecycle without public keys,
  fingerprints, attestation material or proof payloads. Only a key-verified
  pending enrollment exposes **Approve**; only an active enrollment exposes
  **Revoke**.
- All requests remain behind the existing Workforce attendance admin routes
  and their tenant/capability/role checks. This UI does not turn on QR, device
  trust, location, Route or an attendance policy for a tenant.

## Deliberately not claimed

This does **not** complete WF-C5-007 or WF-C5-008:

- no mobile enrollment, device replacement, lost/stolen workflow, recovery,
  separation-of-duties policy, hardware attestation or physical device proof;
- no station creation/replacement workflow, controller health telemetry,
  clock-skew detection, kiosk hardware integration or physical display test;
- no claim that QR, a registered device or an authenticated account proves the
  named human was physically present;
- no browser E2E, Android build, physical-device test or production deployment.

The work therefore remains a safe, reviewable web administration slice, not a
pilot-ready anti-fraud control.

## Verification

Run sequentially on Contabo (Node 20):

```text
PASS  npx vitest run src/__tests__/api-workforce-attendance.test.ts \
      src/__tests__/workforce-attendance-management.test.ts \
      src/__tests__/workforce-attendance-administration-ui-contract.test.ts \
      --pool=forks --maxWorkers=1
      (3 files, 15 tests)
PASS  npx eslint src/app/api/v1/workforce/attendance/stations/[id]/qr/route.ts \
      src/components/workforce/workforce-attendance-administration.tsx \
      src/app/(dashboard)/workforce/configuration/page.tsx \
      src/__tests__/api-workforce-attendance.test.ts \
      src/__tests__/workforce-attendance-administration-ui-contract.test.ts
PASS  npm run i18n:check (20,994 EN leaf keys; RU/AZ missing=0, extra=0)
PASS  git diff --check
NOT RUN  full build, browser E2E, Android and physical QR/device checks:
         prohibited heavy/physical gates on the Contabo development host.
```
