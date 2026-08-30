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

## Explicitly not activated

There is no Play Console/Cloud project credential, Android SDK integration,
token decoder endpoint, final app package/signing identity, enforcement policy,
database storage, verdict cache or attendance mutation using this contract.
The runtime policy must be configured only after the managed-Play app and
supported version matrix are approved; otherwise assessment fails closed.

## Sources consulted

- [Android Developers — Make a standard API request](https://developer.android.com/google/play/integrity/standard)
- [Android Developers — Integrity verdicts](https://developer.android.com/google/play/integrity/verdicts)

## Verification

    PASS  PATH=/home/codex-alt/.local/bin:$PATH npx vitest run \
          src/__tests__/lib-workforce-play-integrity.test.ts \
          src/__tests__/lib-workforce-android-key-attestation.test.ts --reporter=dot
          (2 files, 7 tests)
    PASS  targeted ESLint and git diff --check

    NOT RUN  Google server token decode, Play Console/Cloud configuration,
             Android Standard API request, endpoint/DB/replay integration,
             full typecheck/build, Android Gradle/device, browser E2E, load and
             physical anti-tamper matrix. Heavy and physical gates do not run
             on Contabo.
