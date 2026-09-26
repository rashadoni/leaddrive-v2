# Workforce C5 — attestation-receipt write fence (2026-09-01)

**Status:** `WF-C5-004` partial; no hardware-trust activation.

## Delivered safe boundary

An Android device enrollment can no longer become `ACTIVE` merely because it
proved possession of its submitted P-256 key. The server now requires the
already-reserved minimal attestation receipt before it will:

- let a device-security administrator promote a pending enrollment; or
- accept an active enrollment as a `DEVICE_KEY` attendance factor.

The receipt has only an immutable verifier timestamp, `TRUSTED_ENVIRONMENT`
or `STRONGBOX` level, and a root-certificate SHA-256 fingerprint. Its shape is
checked defensively in source: all fields must be complete, the timestamp must
not be in the future, and a `SOFTWARE` key or malformed root fingerprint is
rejected. No certificate chain, challenge bytes, device identifier, biometric
output, raw location, public-key material or root value is returned to an
employee action response.

An existing active proof-only enrollment now produces the explicit
`WORKFORCE_ATTENDANCE_DEVICE_ATTESTATION_REQUIRED` recovery result instead of
being treated as a trusted device. The Android source maps that code to
AZ/RU/EN safe guidance: no action was accepted and the employee must use the
approved review path. It does not promise that a retry or a manager approval
can make the key trusted.

## Deliberate non-claim

There is still no configured attestation chain-submission endpoint and no
writer for this receipt. That is intentional: the required verifier must first
be independently reviewed, validate Google's current roots/revocation status,
the exact server nonce and final managed-Play app identity, and persist only
the receipt atomically. Therefore a freshly generated Android key can remain
pending, but cannot become an attendance-trust factor. This checkpoint does
not claim Google verification, a usable trusted-device rollout, biometric
validation, migration application, tenant activation, Android build/device
exercise, staging or production evidence.

## Verification

```text
PASS  CI=true PATH=/home/codex-alt/.local/bin:$PATH npx vitest run --maxWorkers=1
      src/__tests__/workforce-attendance-trust.test.ts
      src/__tests__/workforce-attendance-management.test.ts
      src/__tests__/api-workforce-attendance.test.ts
      src/__tests__/workforce-android-foundation.test.ts --reporter=dot
      (4 files, 60 tests)

PASS  targeted ESLint for changed TypeScript sources and tests
PASS  DATABASE_URL=non-routable value npx prisma validate
PASS  git diff --check

NOT RUN  official Kotlin verifier integration, live Google root/revocation
         operation, certificate-chain endpoint and atomic receipt writer,
         disposable database/RLS migration, Android Gradle/lint/unit,
         signed-device, biometric, QR, browser, staging, load and production
         checks. Heavy/physical checks are not run on Contabo.
```
