# Workforce C9 — mobile device replacement source (2026-09-01)

## Scope

The Android trusted-device screen can now start a replacement enrollment from a
new or already-revoked local device. It displays only the employee's
server-returned active device labels and sends an optional
`replacesEnrollmentId` in the existing enrollment request.

The mobile client never chooses a replacement while it is resuming a pending
proof/provisioning state or while its current key is active/pending manager
approval. This prevents a fresh replacement choice from being mixed with a
previous enrollment attempt.

## Server-authoritative lifecycle

- The server independently confirms that the selected enrollment is an active
  device owned by the authenticated employee.
- The new key remains `PENDING` after possession proof; a different accountable
  administrator must approve it. The mobile replacement selector cannot
  self-approve, revoke the old device or activate device trust.
- On an approved replacement the existing server transaction, not Android,
  retires the prior active enrollment and preserves its lifecycle history.
- The flow sends only the opaque enrollment identifier selected from the
  employee's own lifecycle response. It does not return or log a public key,
  signature, QR token, attestation certificate, biometric result or location.

## Verification

Passed in this worktree:

```text
vitest: workforce-android-foundation plus attendance/mobile contract regression set
eslint: updated Android source-contract test
git diff --check
```

`NOT RUN`: Android Gradle lint/unit for this SHA, signed build, replacement
transaction against a disposable database, physical two-device/manager
approval/biometric exercise, hardware attestation verification, staging and
pilot.
