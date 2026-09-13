# LeadDrive Workforce Android

This is the standalone, Android-first employee Workforce client. It is not a
Route & Field app and it does not contain Route endpoints or an automatic
location/background-tracking service.

## Source and release boundaries

- The module is native Android/Kotlin/Compose because the approved high-
  assurance path needs Android Keystore attestation and exact-action signing.
- The untrusted debug build uses `com.leaddrive.workforce.debug.dev` and an
  inert `https://invalid.invalid/` API base. It cannot be configured to contact
  a guessed host.
- A release task requires all of the following CI/release-management Gradle
  properties: `WORKFORCE_APPLICATION_ID`, `WORKFORCE_API_BASE_URL`,
  `WORKFORCE_VERSION_NAME` and `WORKFORCE_VERSION_CODE`. No value is committed.
- A final Play application ID, signing key/Play App Signing configuration,
  supported device/OS matrix and managed Play organization track are external
  release decisions. This project must not be uploaded before they are
  recorded and verified.
- Keystores, `local.properties`, build directories and secret Gradle property
  files are ignored by the parent repository.

## Current safe foundation

- login goes only to `/api/v1/mtm/mobile/auth` with an explicit organization
  slug; it never retains the password after the request;
- bootstrap goes only to `/api/v1/mtm/mobile/bootstrap`, sends a random
  per-account-installation device selector and exposes the server-owned
  Workforce release state;
- session token, tenant slug and selector are AES-GCM encrypted under a
  non-exportable Android Keystore key and are deleted on logout/account switch;
- camera and foreground/action-time location permissions are declared, but
  there is **no** `ACCESS_BACKGROUND_LOCATION`, background location service or
  location capture implementation;
- the device-key foundation requests a non-exportable ECDSA Android Keystore
  key with an attestation challenge and per-use secure device credential or
  strong biometric authorization. It never reads or exports biometric data.

The project intentionally does **not** claim delivered Today/history/request
screens, durable Room outbox, QR scanner, attestation-server validation,
device enrollment API transport, physical device support, managed Play upload
or legal activation. Those slices remain independently gated in C5/C9/C10/C14.

## Required external verification

Run from CI or a permitted heavy worker with JDK 17, Android SDK API 37,
Build Tools 36.0.0 and Gradle 9.5.0:

```text
gradle -p apps/workforce-android :app:lintDebug :app:testDebugUnitTest
```

The Contabo development worktree has no JDK, Android SDK or Gradle, so Android
Gradle/emulator/device checks are intentionally `NOT RUN` there. Do not install
an SDK or use an unbounded build on this host.
