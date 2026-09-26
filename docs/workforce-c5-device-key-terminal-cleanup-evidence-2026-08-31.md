# Workforce C5 — terminal device-key cleanup

> **Status:** source-only partial evidence for `WF-C5-003` and `WF-C9-009`.
> **Recorded:** 2026-08-31

## Delivered source boundary

- Android refreshes the employee's own server-returned device-enrollment
  metadata before changing a local binding.
- When, and only when, that metadata resolves the bound enrollment to
  `REVOKED` or `REPLACED`, the repository deletes the matching Android
  Keystore private key and clears its encrypted local binding.
- The returned UI state still names the server-confirmed terminal lifecycle.
  On a later refresh the client is simply unenrolled and may begin a new,
  separately approved enrollment.
- Unknown, missing, `PENDING_PROOF`, `PENDING_MANAGER_APPROVAL` and `ACTIVE`
  states do not delete any key. A transient query failure is not treated as a
  revocation. The cleanup creates no server mutation, approval, replacement,
  proof, QR, location record or outbox item.

## Deliberate limits

- This is cleanup after an existing authoritative server terminal state, not
  key rotation transport, hardware-attestation validation, manager approval
  or a claim that the device's storage was exercised.
- Android Gradle lint/unit, Keystore/StrongBox behaviour, account-switch and
  two-device terminal-state tests remain **NOT RUN** on Contabo and require CI
  or controlled physical devices.

## Verification

The Android foundation source contract verifies that both terminal lifecycle
states clear the local binding while the existing proof/revoke boundaries
remain in place. No terminal enrollment or key was created, read, deleted or
changed in any real tenant by this checkpoint.
