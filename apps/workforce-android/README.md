# LeadDrive Workforce Android

This is the standalone, Android-first employee Workforce client. It is not a
Route & Field app and it does not contain Route endpoints or an automatic
location/background-tracking service.

## Source and release boundaries

- The module is native Android/Kotlin/Compose because the approved high-
  assurance path needs Android Keystore exact-action signing. A local
  attestation certificate is only a candidate until a server verifier exists.
- The untrusted debug build uses `com.leaddrive.workforce.debug.dev` and an
  inert `https://invalid.invalid/` API base. It cannot be configured to contact
  a guessed host.
- A release task requires all of the following CI/release-management Gradle
  properties: `WORKFORCE_APPLICATION_ID`, `WORKFORCE_API_BASE_URL`,
  `WORKFORCE_VERSION_NAME`, `WORKFORCE_VERSION_CODE` and a 40-character
  lowercase immutable `WORKFORCE_BUILD_SHA`. No value is committed.
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
- Today reloads the canonical server workday after restore, displays only its
  allowed transitions and uses one immutable v3/idempotency operation per
  action; a failed online transport cannot manufacture a local accepted fact;
- Today can show the current or next immutable server-selected segment and its
  scheduled site name. It receives no raw GPS, address, site ID, geofence,
  QR or device-proof value; the schedule is explicitly not a physical-presence
  verdict and the client never derives it from its local clock;
- a Room/WorkManager outbox stores operation metadata plus an Android
  Keystore AES-GCM encrypted tenant/action payload. It preserves oldest-first
  domain order, has a seven-day/eight-attempt bound and removes the encryption
  key plus rows on logout or tenant switch. QR and device proofs are never
  queued; server conflicts/rejections are never an offline bypass;
- foreground/action-time location and `USE_BIOMETRIC` permissions are declared,
  but there is **no** `CAMERA`, `ACCESS_BACKGROUND_LOCATION`, background
  location service or active location-capture flow;
- QR is scanned by the managed-Play delegated scanner and sent immediately;
- trusted-device enrollment stores only an encrypted account-bound key alias,
  public-key enrollment ID and lifecycle. An Android Keystore P-256 key signs
  only an exact enrollment/work-time challenge after an OS-owned per-use
  **strong-biometric** prompt. The client never reads, stores or sends
  biometric templates/results, raw QR/device proofs or its attestation
  certificate chain;
- device enrollment proof remains pending until an accountable server-side
  administrator approves it. Revocation/replacement is an administrator flow;
  sign-out removes only this phone's private key and local binding.
- local missed-finish reminders are optional and use only the immutable server
  shift end. Their WorkManager input/name and generic notification contain no
  employee, workday, tenant, site, location, QR or device-proof data; they are
  cancelled on sign-out/account change. There is no push, start or segment
  reminder and no notification delivery claim.
- core client actions, navigation, private-reminder and OS prompt strings have
  Android resource catalogs for English, Azerbaijani and Russian. Tabs expose
  selected state to accessibility services and explicitly use 48 dp minimum
  targets. Server/API error text and physical TalkBack/font-scale acceptance
  remain separate work; the resource files do not claim full translation.
- Existing mobile sync census receives only app semver, immutable build SHA,
  literal Android platform and coarse `phone`/`tablet`/`other` screen class.
  It does not collect model, serial, Android ID, IMEI, token, QR, GPS, employee
  reason or payload. A crash SDK, external telemetry collector and dashboard
  remain unselected and are not present in this source foundation.
- The server's Workforce-only managed-Play floor is parsed client-side as a
  typed, fail-closed decision. A required, invalid, unsupported or unknown
  release state leaves server reads available but disables new work-time,
  request and device-enrollment mutations; the server remains the enforcement
  authority.
- Before an outbox drain, the worker re-reads the release state. A mandatory
  update keeps encrypted pending rows intact without consuming their retry
  count; a supported sign-in/restore, including an in-place update, schedules
  the same rows for bounded oldest-first drain. There is no local payload
  migration, proof recreation or accepted-fact fallback.
- Before a planned uninstall, use Recovery first: sign-out/uninstall removes
  this phone's encrypted session, private key and pending local outbox, which
  cannot be restored. For a lost or replaced phone, contact an authorized
  administrator to revoke/replace its enrollment; removing the app does not
  revoke a server enrollment.

The project intentionally does **not** claim Android Gradle/build evidence,
physical Today/offline/QR/biometric tests, hardware-attestation-server
validation, server/mobile revoke-replace transport, physical device support,
managed Play upload or legal activation. Those slices remain independently
gated in C5/C9/C10/C14.

## Required external verification

Run from CI or a permitted heavy worker with JDK 17, Android SDK API 37,
Build Tools 36.0.0 and Gradle 9.5.0:

```text
gradle -p apps/workforce-android :app:lintDebug :app:testDebugUnitTest
```

The Contabo development worktree has no JDK, Android SDK or Gradle, so Android
Gradle/emulator/device checks are intentionally `NOT RUN` there. Do not install
an SDK or use an unbounded build on this host.
