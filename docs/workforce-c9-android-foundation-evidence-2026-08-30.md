# Workforce C9 — native Android foundation

> **Status:** safe partial source foundation for `WF-C9-001`, `WF-C9-002`,
> `WF-C9-003`, `WF-C9-004`, `WF-C9-005`, `WF-C9-006`, `WF-C9-008`,
> `WF-C9-011`, `WF-C9-012`, `WF-C9-013`, `WF-C9-014` and `WF-C5-003`. It is not an Android build, signed app, device-attestation
> acceptance, Play upload or location-collection activation.
> **Recorded:** 2026-08-30

## Architecture selected

The approved Android-first managed-Play direction is implemented as a separate
native Kotlin/Compose project at `apps/workforce-android`, while it remains in
the same LeadDrive repository and dedicated HRM worktree. This is not an Expo
or Route & Field wrapper: Android Keystore attestation, non-exportable keys and
per-use device authentication are first-class requirements for the approved
high-assurance `GEO + rotating QR` path.

The project pins AGP 9.3.0, Gradle 9.5.0, JDK 17, compile SDK 37, Kotlin
2.4.20, KSP 2.3.12, Compose BOM 2026.08.00, Room 2.8.4 and WorkManager
2.11.2. It follows the Android
offline-first direction using a bounded local source of truth, while still not
claiming Gradle, physical-device or seven-day recovery evidence.

## Safe identity and network posture

- Debug uses an intentionally non-production package suffix and
  `https://invalid.invalid/`; it cannot silently connect to a guessed API.
- Every release task requires an externally supplied final application ID,
  HTTPS base URL, semver and positive version code. The Gradle project contains
  no signing key, Play credential, production host or release identity.
- The debug CI workflow only runs `lintDebug` and unit tests. It cannot sign,
  upload, deploy or read production secrets. Pull requests are path-filtered
  and superseded runs are cancelled under the repository CI cost policy.
- Login is tenant-slug scoped against the existing mobile-auth endpoint. The
  password is request-only and never stored. Bootstrap is Workforce-only,
  sends both the human-readable version and integer version code, and carries
  the server-owned Android release state.
- Today restores a secure session after process death and reloads the canonical
  `/workday` state. It displays only server-provided actions, sends one v3
  state-transition operation with a fresh idempotency key, and reloads server
  truth after the acknowledgement. A server-rejected request creates neither
  a local fact nor a hidden queued action; only a transient transport result
  retains the same immutable operation in the explicit encrypted outbox. If
  the server exposes an older active workday separately, the client refuses
  to offer a new `START` action.
- Android Keystore protects AES-GCM session/tenant/install-selector state;
  logout/account switch removes the encrypted token, selector and key.
- Backups and device transfer exclude shared preferences and databases.
- The Room outbox stores only queue metadata plus an Android-Keystore AES-GCM
  ciphertext envelope, authenticated to its operation ID/domain. The tenant
  slug, action and all server payload remain encrypted. It has a seven-day
  expiry, eight-attempt bound, oldest-first domain ordering, connected-network
  WorkManager drain and terminal conflict/expiry/review states.
- A process-wide account-boundary mutex prevents a drain from racing logout,
  tenant switch or enqueue. A delayed head operation remains the absolute
  domain head, so a later action cannot overtake it while backoff is active.
- The queue also compares the decrypted operation domain with the
  authenticated Room-row domain before replay. A mismatch is terminal review,
  never a request to another endpoint.
- A logout or tenant switch first destroys the outbox key and then clears all
  rows. A different tenant can never submit a former tenant's operation; an
  unexpected scope mismatch is discarded rather than replayed.
- The managed-Play Google Code Scanner scans QR only when the current signed-in
  server manifest requires it for a specific action. The app has no `CAMERA`
  permission and receives only the single raw token callback. A token is sent
  immediately in that one action, is never saved in state/outbox/logs, and a
  transient failure asks for a fresh scan instead of queuing an expired proof.
- Only attendance manifest version 1 in `ACTIVE` state is actionable. An
  invalid or unknown-version manifest blocks attendance controls instead of
  silently degrading to an unprotected action; biometric-required actions also
  remain blocked until the trusted-device proof flow exists.
- Cancellation and unreadable-token recovery copy is resource-backed in
  EN/AZ/RU and states only that no action was sent; it does not render a QR
  token or internal scanner detail.

## Evidence and privacy posture

- The manifest declares no `CAMERA` permission. It declares foreground/action-time
  location and `USE_BIOMETRIC` only; it has no background-location permission,
  location service or active location capture flow. `WorkforceActionTimeLocationCapture` is a user-triggered
  foreground-only `getCurrentLocation` primitive with no stale last-known
  fallback. It rejects fixes older than 30 seconds or outside coordinate and
  accuracy bounds, exposes the platform mock flag for later server assessment,
  cancels after 15 seconds, and returns explicit permission/provider/platform/
  timeout states. It is not wired until tenant proof policy is active.
- `WorkforceDeviceKeyManager` requests a challenge-bound ECDSA Android
  Keystore key, tries StrongBox where available, falls back only when the
  device reports StrongBox unavailable, and requires per-use **strong
  biometric** authorization through an OS-owned `BiometricPrompt` CryptoObject.
  Device credential is deliberately not claimed as an equivalent per-use
  cryptographic authorization. The mobile client sends only P-256 public-key
  enrollment and one exact-action proof; its local attestation certificate
  chain is neither uploaded nor asserted as verified.
- It does not read, persist or send biometric templates/results. Server-side
  attestation chain/root/app-identity validation and physical-device evidence
  are still absent, so no hardware-attestation claim is made.

## Immutable Today schedule context (`WF-C9-003`, partial)

- The v1 mobile workday adapter is now an explicit allow-list: the client gets
  only the server workday state, accumulated work time, allowed actions, the
  immutable planned start/end and at most one server-selected current or next
  segment. It does not serialize start/end GPS, event coordinates/accuracy/
  notes, address, site identifier, eligibility, geofence revision, proof
  policy reference, QR or device proof.
- The segment is calculated on the server from the immutable workday schedule
  snapshot and its stored timezone. Android renders the returned mode, planned
  local window and safe site name without re-evaluating it against the phone
  clock. A missing, malformed, ambiguous or exhausted snapshot renders no
  segment context rather than an inferred default.
- The screen says explicitly that a schedule is not proof of physical
  presence. QR requirements remain a separately server-disclosed immediate
  action requirement; foreground GEO capture remains disabled until legal
  notice and tenant proof-policy activation. This does not claim a QR/GEO/
  device physical validation result.

## Opt-in local missed-finish reminder (`WF-C9-011`, partial)

- The employee must explicitly turn on the local reminder. Android 13+ asks
  for `POST_NOTIFICATIONS` only after that employee action; a denied permission
  or a system-disabled notification channel produces a safe visible state and
  schedules nothing.
- The server's own immutable `WorkforceShiftSnapshot.plannedEndAt` is the only
  input. The client does not use the Baku default, device timezone, a local
  clock-derived shift, current site, segment, location, QR or device proof to
  create a reminder. If no current approved shift end is returned, or the
  window has passed, it cancels any prior reminder instead of guessing.
- The single WorkManager request stores `Data.EMPTY` and a fixed generic name;
  no workday, employee, tenant, site or proof identifier is written to local
  WorkManager metadata. Sign-out, tenant/account change, disabling the option,
  completed workday and stale/no-plan state cancel it.
- The worker displays only “LeadDrive Workforce — Open Workforce to review
  your work-time status.” It contains no time, name, site, location, QR or
  device information. A notification failure ends the one-shot job rather than
  retrying and possibly showing a duplicate alert.
- This is intentionally only a private **missed-finish** reminder. There is no
  push credential, segment reminder, start reminder, server no-show action or
  delivery receipt. Those flows remain unimplemented until an approved
  server-side notification contract and physical-device evidence exist.

## Localisation and accessibility foundation (`WF-C9-012`, partial)

- Core native client navigation, sign-in, action, request-type, reminder,
  notification-channel and biometric-prompt copy is resource-backed in default
  English plus `values-az` and `values-ru`. The employee's device locale picks
  the correct resource without a tenant setting or a hidden tracking field.
- The existing Material `Button`/`TextButton` semantics remain intact. The
  selectable section/request tabs additionally announce their `Tab` role and
  selected/not-selected state; dynamic employee status uses a polite live
  region. All visible workday state includes words, not colour alone.
- Navigation and request-type tabs explicitly have a 48 dp minimum width and
  height. Text uses standard Material typography and no fixed font scale,
  clipping or custom motion. This is source posture only, not evidence that a
  200% device font scale reflows every screen.
- The trusted-device recovery surface now uses the same EN/AZ/RU resource
  catalogs for its explanation, enrollment state, pending/active labels,
  revoke confirmation and lost-device containment copy. It no longer reflects
  the repository's internal English lifecycle message into that UI. The server
  still remains authoritative for lifecycle state; this is localization and
  safe presentation only, not device verification evidence.
- Remaining hard-coded server/API/recovery messages deliberately stay outside
  this resource slice: safely localising them requires stable error codes and
  reviewed legal/HR translation, not unreliable client-side text matching.

## Privacy-safe mobile diagnostics (`WF-C9-013`, partial)

- A release build now requires an externally supplied immutable 40-character
  lowercase Git SHA (`WORKFORCE_BUILD_SHA`) in addition to its final package,
  URL and version properties. Debug intentionally reports `unknown`; it does
  not pretend to be a releasable artifact.
- The native client sends only app semver, that build SHA, literal `android`,
  and a coarse screen category (`phone`, `tablet` or `other`) on its existing
  Workforce API requests. The category is derived from the screen-layout
  bucket, not a model, serial, Android ID, IMEI, carrier or hardware ID.
- The existing server-side mobile census HMACs tenant and principal before it
  logs them. It accepts only the fixed SHA/platform/device-class grammar and
  converts all other header values to `unknown`. No raw request header,
  authentication token, QR proof, GPS coordinate, employee reason, outbox
  payload or device selector is emitted by this source slice.
- This intentionally does **not** install a crash SDK, DSN, crash collector,
  dashboard, analytics vendor or stack-trace pipeline. Selecting one and
  approving its data-processing, retention, access and release posture needs
  privacy/security approval and real operational ownership; therefore this
  task remains partial.

## Managed-Play update and outbox preservation (`WF-C9-014`, partial)

- The server's existing Workforce-only release state is now parsed as a typed
  client decision. `UPDATE_REQUIRED`, invalid/unsupported or unrecognised
  states are fail-closed for new work-time, HR-request and device-enrollment
  mutations; server state remains readable. The legacy Route &amp; Field client is
  not changed by this standalone-client gate.
- The current source matrix is intentionally narrow: `NOT_CONFIGURED` and
  `SUPPORTED` permit normal mutations; `UPDATE_REQUIRED`, `INVALID_VERSION`,
  `UNSUPPORTED_PLATFORM` and malformed/unknown statuses require an approved
  update. The update URL is shown only after local HTTPS validation; it is not
  a redirect or a source of authority.
- An outbox worker bootstraps before it drains. For a required update it retains
  the existing encrypted Room rows, records a privacy-safe update-required
  recovery state and does not consume an operation retry. After a supported
  sign-in or restore (including an in-place update), it schedules the same
  schema-v1 rows for normal oldest-first drain. It never decrypts them merely
  to migrate, recreates an attendance proof or makes an accepted local fact.
- Device guidance is visible in EN/AZ/RU: a planned removal requires Recovery
  review first because sign-out/uninstall removes this phone's encrypted local
  session, private key and pending outbox; a lost/replaced device needs prompt
  administrator revocation or replacement. Removing the app cannot revoke the
  server enrollment.
- No managed-Play package/track, signing setup, supported Android device/OS
  matrix, production policy variables, update exercise, rollback drill or
  uninstall/lost-device physical test has been claimed. Those need a real
  release owner and device matrix before this task can become complete.

## Source-level checks

- `PASS` — `workforce-android-foundation.test.ts` fixes the module boundary,
  no-background-location/backup posture, release-property guard, Workforce-only
  endpoint list, release-policy version header, bounded CI, secure-store
  requirements, per-use strong-biometric source contract, exact canonical
  device-proof wire labels, no-proof-outbox rule and generic
  server-snapshotted reminder source contract.
- `PASS` — targeted mobile `/workday`, bootstrap and Android-foundation tests
  cover serialization of an immutable planned end plus the reminder boundary
  (19 tests across the `/workday` and Android-foundation files in this
  checkpoint; bootstrap behavior remains covered by its earlier checkpoint).
- `PASS` — `workforce-android-foundation.test.ts` verifies all three core
  catalogs, resource-backed native notification/biometric prompts, tab state
  semantics, polite status announcements and explicit 48 dp target source.
- `PASS` — targeted telemetry, mobile bootstrap, legacy sync, `/workday` and
  Android-foundation tests cover the bounded header grammar, legacy-call
  compatibility and absence of raw diagnostic collection (154 tests total in
  this checkpoint); scoped ESLint and `git diff --check` also pass.
- `PASS` — `workforce-android-foundation.test.ts` asserts the typed
  fail-closed release state, client mutation guards, deferred update outbox
  path, supported-resume scheduling and the EN/AZ/RU loss/uninstall guidance
  source contract.
- `PASS` — two targeted mobile `/workday` and Android-foundation files (24
  tests) cover the allow-list workday projection, server-only
  current/next segment selection, raw-coordinate/geofence/proof exclusion and
  the Android display-only parsing contract; scoped ESLint and
  `git diff --check` also pass.
- `NOT RUN` — Android Gradle lint/unit tests, build, emulator/device tests,
  camera/location/QR checks, notification permission/channel/delivery failure,
  TalkBack, AZ/RU/EN linguistic review, 200% font, contrast, reduced-motion
  and poor-vision exercise, Keystore attestation chain verification, managed
  Play upload and signing. Contabo has no Java, Android SDK or Gradle; the new
  GitHub workflow is the prescribed external debug gate.

## Deliberate remaining work

Today submits online first; a transport/ambiguous transient failure saves the
same immutable operation into the encrypted outbox. Explicit server rejections
and proof/state conflicts are never queued. It does not yet capture
action-time location or site proof. A QR-required action scans one fresh token
and sends it immediately. A device-required action can start/resume an
encrypted account-bound enrollment, get an OS-only per-use strong-biometric
signature, and send its device proof immediately; server truth still requires
manager approval before that device can sign a work-time action. Neither proof
condition has an offline bypass. Work Time history is a bounded self-HRM server
read and explicitly
labels the returned workday/request state as accepted server truth; it never
calculates an accepted fact from an outbox entry. The Android client can
create/cancel leave, absence and correction claims through the same encrypted
per-domain outbox. Employment reasons remain only in live draft memory or
encrypted transport/outbox payloads, not saved UI state or ordinary
diagnostics. Physical offline/process-death/two-account
exercise, action-time permission/capture, device enrollment transport,
attestation-server verification, device-revocation/replace API, accessibility localisation, update/outbox-drain
drill and real device matrix remain their individual C5/C9/C10/C14 tasks.

The Recovery view returns metadata-only queue state and an approved recovery
message; it never decrypts or displays an operation ID, request reason, QR
value, GPS coordinate, tenant identity or device proof. Its source rules tell
the employee to refresh server truth, request correction after expiry, and
never re-scan/retry a proof as an offline bypass.
