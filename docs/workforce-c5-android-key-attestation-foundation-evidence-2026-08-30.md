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

## 2026-08-31 standards-alignment hardening

The verifier now has a strict, pure adapter for Google's official attestation
status-list JSON. It preserves the source's lower-case certificate serial
numbers, normalizes the equivalent X.509 serial representation (colon
separators and a DER-positive leading zero), and rejects a chain if any
certificate is listed as either `REVOKED` or `SUSPENDED`. The existing optional
fingerprint deny-list is only an additive internal containment measure; it
cannot replace the official serial-number status list.

The adapter does not fetch or cache the list. A future operational owner must
fetch `https://android.googleapis.com/attestation/status` on the server,
honour its `Cache-Control` response policy, record the checked time without
logging a certificate chain, and fail closed if it cannot supply a current
valid list.

The Android documentation now explicitly recommends Google's attestation
verification **Kotlin** library rather than a custom verifier. LeadDrive's
application server is TypeScript, so this source slice deliberately does not
invent an ASN.1 parser or falsely label one as vetted. Before an enrollment
endpoint can be activated, Security must select and operate a separately
reviewed verifier boundary that uses the recommended library (or document an
equivalently reviewed service) and returns only the minimal validated claims
to this fail-closed gate.

## Explicitly not activated

The Android client now obtains a one-time server preflight nonce before it
creates a new key and passes those bytes directly to KeyStore. It still retains
the certificate chain locally and only sends a public key until this verifier
has a vetted ASN.1 implementation, live Google root/revocation operations,
final managed-Play app identity and a reviewed server enrollment protocol.
The preflight is not consumed by the existing enrollment endpoint, so no
device becomes hardware-trusted, no evidence is collected, and no biometric
result/template or device ID is stored by this checkpoint.

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
          (2 files, 7 tests)
    PASS  targeted ESLint and git diff --check

    NOT RUN  Vetted Kotlin/verifier-service integration, live Google
             root/revocation-feed cache operation, endpoint/DB migration, full
             typecheck/build, Android Gradle/device, Play Integrity, browser
             E2E, load and physical key/biometric/QR matrix. Heavy and physical
             gates are not run on Contabo.
