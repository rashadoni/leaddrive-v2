# Workforce C5/C9 biometric manifest trusted-signature fence

**Date:** 2026-09-01
**Tasks:** `WF-C5-006`, `WF-C9-002`, `WF-C9-009`
**Status:** partial source-contract hardening; no assurance-tier activation

## What changed

The standalone Android client now parses the existing server-projected
`biometricRequiredActions` field from the Workforce attendance manifest.
`WorkforceAttendanceRequirements.requiresDeviceProof(action)` is the
single client decision for an action that must travel through the exact-action
device-signature path. It is true when either the ordinary device-trust policy
or the biometric policy names that action.

The latter fallback is deliberately fail-closed: a malformed or future manifest
that names a biometric action but accidentally omits the parent device-trust
action cannot downgrade the action to an unsigned attendance mutation. The
Today button label follows the same decision, so a QR plus biometric-policy
action remains a scan-and-confirm flow.

This does not enable biometric-required attendance. The server policy still
rejects that configuration until verified Android hardware attestation exists,
and Android continues to use only the OS-owned per-use `BIOMETRIC_STRONG`
signature release. LeadDrive receives neither a biometric template nor a
biometric result.

## Verification performed

On this feature worktree, after memory/disk/pressure precheck:

```text
CI=true PATH=/home/codex-alt/.local/bin:$PATH npx vitest run --maxWorkers=1 \
  src/__tests__/workforce-android-foundation.test.ts \
  src/__tests__/api-mtm-mobile-bootstrap.test.ts \
  src/__tests__/workforce-attendance-security.test.ts

PASS 3 files / 46 tests
```

`git diff --check` passed. The focused ESLint invocation had no errors for the
TypeScript contract test; Kotlin sources are intentionally outside this
repository ESLint configuration and were reported as ignored.

## Explicitly not evidenced

- `NOT RUN`: Android Gradle lint/unit compilation locally. It is a heavy
  workload on Contabo and remains the exact PR's GitHub Android gate.
- `NOT RUN`: a signed APK/AAB, managed-Play distribution, Android device,
  biometric prompt, QR scan, packet/log inspection and two-device matrix.
- `NOT RUN`: a real attestation verifier, Google root/revocation operation,
  attestation endpoint consumption or tenant policy activation.

The change adds no server write, database migration, tenant setting, device
enrollment, biometric data, QR token persistence, feature activation or
production action.
