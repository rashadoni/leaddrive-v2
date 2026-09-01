# Workforce C5 — server-first Android attestation preflight (2026-08-31)

**Status:** WF-C5-004 partial; no hardware-trust activation

## Delivered source boundary

New Android keys no longer use a locally random attestation challenge. Before
`WorkforceDeviceKeyManager.createEnrollmentKey` calls
`setAttestationChallenge`, the Android client requests a short-lived,
tenant/employee-scoped nonce from:

`POST /api/v1/mtm/mobile/attendance/devices/enrollments/attestation-challenge`

The server stores only a tenant-bound HMAC fingerprint, expiry and one-way
consumption marker. Issuing a replacement consumes the earlier live nonce for
the same employee. The raw nonce stays only in Android memory for KeyStore key
creation; it is never put in encrypted preferences, Room, WorkManager or an
audit record. The app does not currently materialize the key's certificate
chain at all: it remains in Android Keystore until a separately reviewed
server-verifier submission protocol exists.

The new migration is additive, tenant-RLS-protected and has no delete grant.
It also reserves an immutable minimal receipt shape on an enrollment (verified
time, TEE/StrongBox level and root fingerprint). That shape deliberately has
no raw certificate, challenge, hardware identifiers or biometric material.

## Explicit non-claim and write fence

This is a protocol-ordering foundation, **not** server validation. The current
enrollment endpoint still receives only the P-256 public key and therefore
does not consume the new preflight row, upload a certificate chain or set the
receipt fields. It cannot represent an enrollment as hardware-attested.

The next endpoint integration must use a separately operated verifier based on
the official Android Kotlin key-attestation library, validate the exact raw
preflight nonce against the certificate extension, chain/root/revocation and
final app identity, then consume the preflight and insert the minimal receipt
atomically. Until that verifier, final managed-Play identity and live
revocation operation exist, the existing generic device-key proof remains no
more than a manager-reviewed possession factor; biometric-required policy is
still fail-closed.

## Verification

```text
PASS  prisma validate + generated client (non-routable DATABASE_URL)
PASS  targeted Vitest: management/API/migration/security/Android source
      contracts (5 files, 48 tests)
NOT RUN  disposable database migration/RLS transaction, official Kotlin
         verifier, Google root/revocation cache operation, chain submission
         and atomic consumption, Android Gradle/device and physical H5 matrix
```

## Sources

- [Android Developers — Verify hardware-backed key pairs with key attestation](https://developer.android.com/privacy-and-security/security-key-attestation)
- [Android Key Attestation verifier](https://github.com/android/keyattestation)
