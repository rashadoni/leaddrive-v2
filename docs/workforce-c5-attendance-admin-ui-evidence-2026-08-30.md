# Workforce C5 attendance administration UI — partial evidence

**Status:** partial; no C5 acceptance task is closed by this slice
**Date:** 2026-08-30
**Scope:** administrator visibility and safe lifecycle controls for the existing
short-lived QR and trusted-device backend primitives.

## Delivered boundary

The Workforce configuration page now contains an administrator-only
**Attendance security controls** surface.

- It lists the existing tenant-scoped QR stations and their status, named
  Workforce-site label and rotation interval; a stale/deleted site is shown as
  unavailable rather than exposing a raw site identifier.
- An administrator can create a station through named active Workforce-site
  and effective calibrated-circle choices, with an effective date, 30–300
  second rotation and optional named area. The server still validates the
  selected tenant/site/geofence timeline, appends the station identity and
  writes its audit. The UI never asks an administrator to type a site or
  geofence ID.
- An administrator selects an attendance action and requests a fresh QR for an
  active station. The server converts the already-issued short-lived signed
  payload into an image data URL; the web surface renders the image and expiry,
  but never renders, stores or logs the QR token as text.
- A station can be disabled. This is a lifecycle action, not destructive
  deletion.
- An MFA-gated administrator can perform an explicit **Emergency replace**
  operation. It takes a new code/name and optional rotation only: the server
  revalidates the retired station's active site and effective calibrated-circle
  revision, creates a successor at exactly that binding, disables the prior
  station and writes one redacted replacement audit record in a transaction.
  The confirmation text makes the terminal retirement clear; it does not show
  a QR token or accept a raw site/geofence identifier. A concurrent retirement
  aborts the transaction instead of leaving two claimed successors.
- It lists the existing trusted-device lifecycle without public keys,
  fingerprints, attestation material or proof payloads. Only a key-verified
  pending enrollment exposes **Approve**; only an active enrollment exposes
  **Report lost / revoke**. A revoke remains an immutable containment action,
  not destructive deletion.
- A replacement enrollment visibly names the replaced device, and the prior
  record visibly names its replacement. `REPLACED` is a distinct terminal
  state rather than a misleading active or revoked label.
- A session administrator whose `MtmAgent.userId` matches the enrollment's
  employee is rejected before a pending device can become active. A different
  MFA-gated administrator must approve it. Self-revoke remains allowed because
  containment of a lost factor is safer than retaining it.
- A metadata-only Workforce Android source path now lists an authenticated
  employee's own enrollments and requires an explicit confirmation before it
  can revoke a `PENDING`/`ACTIVE` one. Its server route is Workforce-capability
  and self-mutate gated, scopes both transaction queries to the mobile
  `agentId`, requires a linked audit user and never accepts a key, proof, QR,
  biometric value or offline retry. It deletes a matching local key only after
  a server `REVOKED` acknowledgement. This does not turn on QR, device trust,
  location, Route or an attendance policy for a tenant.

## Deliberately not claimed

This does **not** complete WF-C5-007 or WF-C5-008:

- no signed managed-Play mobile release, recovery factor, hardware attestation
  or physical device proof. The source-level employee self-revocation flow and
  server replacement transaction do not make a supported mobile binary
  available;
- no controller health telemetry, clock-skew detection, kiosk hardware
  integration or physical display test. The emergency replacement flow only
  changes the server-side lifecycle and cannot prove a replacement display is
  physically present or correctly clock-synchronised;
- no claim that QR, a registered device or an authenticated account proves the
  named human was physically present;
- no browser E2E, Android build, physical-device test or production deployment.

The work therefore remains a safe, reviewable web administration slice, not a
pilot-ready anti-fraud control.

## Verification

Latest targeted check, run sequentially on Contabo (Node 20):

```text
PASS  npx vitest run src/__tests__/workforce-attendance-management.test.ts \
      src/__tests__/api-workforce-attendance.test.ts \
      src/__tests__/workforce-attendance-administration-ui-contract.test.ts \
      --reporter=dot
      (3 files, 24 tests)
PASS  npx eslint src/lib/workforce/attendance-management.ts \
      src/app/api/v1/workforce/attendance/stations/[id]/replace/route.ts \
      src/components/workforce/workforce-attendance-administration.tsx \
      src/__tests__/workforce-attendance-management.test.ts \
      src/__tests__/api-workforce-attendance.test.ts \
      src/__tests__/workforce-attendance-administration-ui-contract.test.ts
PASS  npm run i18n:check (21,289 EN leaf keys; RU/AZ missing=0, extra=0)
PASS  git diff --check
NOT RUN  full build, browser E2E, Android and physical QR/device checks:
         prohibited heavy/physical gates on the Contabo development host.
```
