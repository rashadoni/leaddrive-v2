# Workforce C5 local-biometric signature foundation evidence

**Status:** WF-C5-006 partial
**Date:** 2026-08-30

## Delivered source boundary

The Android Workforce source uses the operating-system-owned
`BiometricPrompt` only to release one already-prepared `CryptoObject` signature
for the exact enrollment or attendance challenge. `WorkforceDeviceKeyManager`
creates a non-exportable P-256 Android Keystore key with per-use
`AUTH_BIOMETRIC_STRONG`; `WorkforceDeviceAuthenticator` requires that same
strong-biometric capability and receives only the returned `Signature`.

The app deliberately does **not** enable a device credential as an equivalent
per-use cryptographic authenticator. When strong biometric is unavailable, it
returns a safe manager-review recovery path rather than silently weakening the
action. This is an intentional v1 restriction, not a claim that a PIN, device
credential or a local biometric proves the named employee's identity.

No biometric template, matching result or biometric data is read, persisted or
sent by the Android source. The enrollment transport contains only the public
key and the later proof transport contains only the one challenge/signature
pair. The locally read Android attestation certificate chain is not serialized
by the API client while server-side attestation validation remains incomplete.

## Security boundary and residual risk

The OS prompt establishes local intent to use a device key; it does not prove
physical presence, prevent a person who has enrolled their biometric on a
shared device, validate server trust of the device, or replace QR/GEO policy.
Server-side Key Attestation and Play Integrity remain separate fail-closed
contracts and are not yet wired into an enrollment or attendance mutation.

No local biometric fallback may be used to auto-approve a time fact, resolve an
exception, calculate payroll or take disciplinary action. A failed or
unavailable prompt leaves the action unconfirmed and must follow the existing
human review/correction path.

### 2026-09-01 terminal-callback containment

The prompt adapter now permits exactly one terminal result for each prepared
signature. A cancellation or late Android error after a success is ignored
rather than attempting to resume the completed attendance coroutine a second
time. This does not change the chosen authenticator, collect a biometric
result, retry an action, or make a successful local signature into a
server-accepted attendance fact.

## Verification

    PASS  PATH=/home/codex-alt/.local/bin:$PATH npx vitest run \
          src/__tests__/workforce-android-foundation.test.ts \
          --pool=forks --maxWorkers=1 --no-file-parallelism
          (1 file, 17 tests)
    PASS  git diff --check

    NOT RUN  Kotlin/Android lint: the repository ESLint configuration does
             not lint `.kt` files (it reports only an ignored-file warning).
             GitHub Android CI must compile/lint this exact source SHA.

    NOT RUN  Android Gradle build, signing, emulator/device execution, packet
             capture/log inspection, accessibility verification, hardware-key
             lifecycle, attestation/Play server integration and the physical
             QR/device/biometric pilot matrix. These require a permitted heavy
             worker, Google configuration or real managed devices; they do not
             run on Contabo.
