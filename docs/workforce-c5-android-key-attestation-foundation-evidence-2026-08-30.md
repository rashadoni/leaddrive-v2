# Workforce C5 Android Key Attestation server foundation evidence

**Status:** WF-C5-004 partial
**Date:** 2026-08-30

## Delivered fail-closed verifier boundary

`src/lib/workforce/android-key-attestation.ts` implements the server-side
preconditions around an Android Key Attestation chain:

- bounded DER/Base64 X.509 parsing, certificate validity checks, leaf-to-root
  signature verification, self-signed root verification and duplicate-chain
  rejection;
- exact match between the attested leaf public key and the already-enrolled
  P-256 SPKI key;
- runtime-provided trusted Google root fingerprints, one-time challenge,
  exact package/signing-certificate set, revocation feed freshness and revoked
  certificate rejection — no guessed package, signing identity, root or cached
  verdict exists in source;
- required TEE/StrongBox level, locked `VERIFIED` boot, signing P-256/SHA-256,
  per-use strong biometric, empty unique ID and no device-identifier claims;
- no route or database writer calls this module. If the attestation extension
  parser, root, revocation result or any expected property is missing, the
  result is `REJECTED`.

The attestation extension is deliberately an injected, separately reviewable
ASN.1 inspector. It must locate the first trusted Android attestation
extension rather than trusting an arbitrary leaf extension. This matches the
current Android guidance to validate chain signatures, trusted Google root,
revocation and expected extension data on a separate trusted server.

## Explicitly not activated

The Android client still retains its certificate chain locally and only sends a
public key until this verifier has a vetted ASN.1 implementation, live Google
root/revocation operations, final managed-Play app identity and a reviewed
server enrollment protocol. No device becomes trusted, no evidence is
collected, and no biometric result/template or device ID is stored by this
checkpoint.

The remaining C5-004 work is therefore material: production-grade ASN.1
extension parsing, Google root/revocation feed operations, endpoint binding,
attestation persistence minimization, server transaction/replay tests and a
physical device matrix. This checkpoint cannot close the C5 gate.

## Sources consulted

- [Android Developers — Verify hardware-backed key pairs with key attestation](https://developer.android.com/privacy-and-security/security-key-attestation)
- [Android Open Source Project — Key and ID attestation](https://source.android.com/docs/security/features/keystore/attestation)

## Verification

    PASS  PATH=/home/codex-alt/.local/bin:$PATH npx vitest run \
          src/__tests__/lib-workforce-android-key-attestation.test.ts \
          src/__tests__/workforce-attendance-security.test.ts --reporter=dot
          (2 files, 6 tests)
    PASS  targeted ESLint and git diff --check

    NOT RUN  ASN.1 extension implementation integration, live Google
             root/revocation feed, endpoint/DB migration, full typecheck/build,
             Android Gradle/device, Play Integrity, browser E2E, load and
             physical key/biometric/QR matrix. Heavy and physical gates are not
             run on Contabo.
