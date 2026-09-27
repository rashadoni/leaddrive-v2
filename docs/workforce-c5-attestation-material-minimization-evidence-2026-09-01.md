# Workforce C5 — Android attestation material minimization (2026-09-01)

**Status:** `WF-C5-004` partial; no hardware-trust activation

## Delivered source boundary

`WorkforceDeviceKeyManager.createEnrollmentKey` continues to generate a
challenge-bound P-256 Android Keystore key and returns only the opaque local
alias and public SPKI needed by the existing manager-reviewed proof flow.

The app no longer calls `KeyStore.getCertificateChain`, Base64-encodes the
attestation certificates, or carries a certificate-chain collection in
`WorkforceEnrollmentKey`. The current server contract has no vetted verifier
and cannot accept that material, so copying it into application memory would
have no security purpose. The raw chain stays in Android Keystore.

If a later attestation enrollment protocol is approved, it must read the chain
only for the immediate authenticated submission to the separately reviewed
server verifier; it must verify the server-issued nonce, trusted Google root,
revocation status and final app identity before atomically consuming the
preflight. It must then discard the chain and persist only the reviewed,
minimal receipt. This checkpoint neither adds that endpoint nor accepts an
attestation result.

## Non-claims and remaining blockers

- No Android key is newly described as hardware-attested or trusted.
- No certificate, device identifier, biometric template/result, nonce or key
  fingerprint is stored or sent by this change.
- The official Kotlin verifier boundary, live Google root/revocation feed,
  final managed-Play package/signing identity, server receipt transaction and
  signed physical device matrix remain `NOT RUN` / externally blocked.

## Verification

```text
PASS  CI=true PATH=/home/codex-alt/.local/bin:$PATH npx vitest run --maxWorkers=1 \
      src/__tests__/workforce-android-foundation.test.ts \
      src/__tests__/workforce-attendance-security.test.ts --reporter=dot
      (2 files, 22 tests)
PASS  scoped ESLint for the changed source contract; git diff --check
NOT RUN  Android Gradle lint/unit, signed package, emulator/physical Android,
         Keystore/StrongBox, biometric, QR and device-lifecycle checks. These
         require GitHub CI or a physical-device worker, not Contabo.
```
