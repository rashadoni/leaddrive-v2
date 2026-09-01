# Workforce C5 Play Integrity exact-action binding evidence

**Status:** WF-C5-005 partial
**Date:** 2026-08-30

## Delivered fail-closed contract

`src/lib/workforce/play-integrity.ts` derives a SHA-256 base64url Standard API
`requestHash` from the exact Workforce action: tenant, employee, enrollment,
operation, workday, action, canonical occurrence time and schema version. It
contains no GPS, QR token, device signature, biometric data or employee text.

The evaluator accepts only a result declared as server-decoded by the Google
Play Integrity backend and requires an exact request hash, `PLAY_RECOGNIZED`
package/certificate set, configured minimum version, managed-Play license and
the configured device-integrity tier. A missing device tier becomes an
explainable reviewed fallback; request, app identity, version and licensing
failures are rejected, with only the appropriate generic `GET_LICENSED`
recovery marker. The pure evaluator persists nothing, so no prior valid
verdict can be used as an authorization cache for a different action.

## 2026-08-31 server-verdict hardening

The evaluator now also verifies the Google-decoded `requestPackageName` and
`timestampMillis` before any app/device verdict. The timestamp must not be in
the future and must fall inside a caller-configured, bounded 0–300-second
freshness window. A package/hash mismatch is rejected; a stale or missing
timestamp is rejected with a generic retry marker.

The decoder boundary is runtime-validated, not merely TypeScript-typed:
malformed nested objects, duplicate certificate digests/device labels,
non-canonical version/timestamp values and unrecognised enum values fail
closed. The device-label collection remains forward-compatible, but only the
policy's known required label can reach an accepted assessment.

## 2026-09-01 default-off server and Android integration

`src/lib/workforce/play-integrity-decoder.ts` is the only production decoder
boundary. It uses the Google Play Integrity v1 server decode API only when all
of these server-only configuration values are valid:

- service-account JSON;
- Android package name and exact signing-certificate SHA-256 digest set;
- minimum version and device-integrity tier; and
- bounded verdict age and licensing policy.

The raw Standard API token, Google payload and service credential never leave
that boundary. It returns only the fixed accepted/review/rejected assessment;
missing or invalid configuration, transport failure and malformed payload fail
closed. A policy must explicitly list `attendance.playIntegrity.requiredActions`
and must require the same action's verified device-trust factor. Without that
policy the decoder is not invoked and legacy attendance behaviour is unchanged.

For a policy-enabled mobile action, the existing transactional attendance path
requires the current device signature first, then verifies the exact request
hash with Google. Only the tenant-bound SHA-256 fingerprint of the opaque
token is written as a `PLAY_INTEGRITY` row in the existing append-only
verification ledger. The v5 workday transport binds a separate non-reversible
fingerprint into idempotency; it never stores or returns the token. The new
additive schema migrations first create the PostgreSQL enum value and only in
a separate transaction add its constraint/trigger, preserving v1-v4 events.

The Android client ships a default-zero public Cloud-project-number field, so
an unconfigured APK cannot request a token. After an authenticated manifest
that explicitly requires it, the Standard API provider may warm in memory;
after the employee confirms the existing device-key signature, a fresh token
is requested for the exact v5 hash and immediately sent with that action. QR,
device, location and Play tokens all remain excluded from the encrypted outbox.
An Android-side unavailable/decode outcome and server reviewed fallback show
generic EN/RU/AZ recovery copy, not a verdict, device or credential detail.

## Explicitly not activated

There is no real Play Console/Cloud credential, final app package/signing
identity, non-zero Cloud-project number, tenant enforcement policy, capability
toggle, migration application or verdict cache. The implemented chain remains
default-off and fails closed until the managed-Play app and supported version
matrix are approved. No real employee event has used it.

## Sources consulted

- [Android Developers — Make a standard API request](https://developer.android.com/google/play/integrity/standard)
- [Android Developers — Integrity verdicts](https://developer.android.com/google/play/integrity/verdicts)

## Verification

    PASS  CI=true PATH=/home/codex-alt/.local/bin:$PATH npx vitest run \
          --maxWorkers=1 --reporter=dot \
          src/__tests__/lib-workforce-play-integrity.test.ts \
          src/__tests__/lib-workforce-play-integrity-decoder.test.ts \
          src/__tests__/workforce-attendance-security.test.ts \
          src/__tests__/workforce-attendance-trust.test.ts \
          src/__tests__/lib-mtm-workday.test.ts \
          src/__tests__/migration-workforce-play-integrity-attendance.test.ts \
          src/__tests__/migration-workforce-c9-workday-schema-v4.test.ts \
          src/__tests__/api-mtm-mobile-bootstrap.test.ts \
          src/__tests__/workforce-android-foundation.test.ts
          (9 files, 93 tests)
    PASS  CI=true PATH=/home/codex-alt/.local/bin:$PATH npx vitest run \
          --maxWorkers=1 --reporter=dot \
          src/__tests__/api-mtm-mobile-sync.test.ts \
          src/__tests__/api-mtm-week.test.ts \
          src/__tests__/workforce-workday-facts-replay.test.ts \
          src/__tests__/workforce-attendance-trust.test.ts \
          src/__tests__/lib-mtm-workday.test.ts \
          src/__tests__/workforce-android-foundation.test.ts
          (6 files, 214 tests)
    PASS  DATABASE_URL=postgresql://… PATH=/home/codex-alt/.local/bin:$PATH npx prisma validate
    PASS  DATABASE_URL=postgresql://… PATH=/home/codex-alt/.local/bin:$PATH npx prisma generate
    PASS  scoped ESLint for new/changed Workforce source and tests; git diff --check

    NOT RUN  Google server token decode with a real credential, Play
             Console/Cloud configuration, final package/signing identity,
             Android Gradle lint/unit or signed APK, full typecheck/build,
             migration apply/disposable DB trigger validation, browser E2E,
             load, physical QR/device/biometric matrix and anti-tamper matrix.
             Heavy and physical gates do not run on Contabo.
