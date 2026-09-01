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
- One in-memory action-attempt fence permits only one live scan and ignores a
  late cancellation/failure/token callback after that attempt or logout.
- Cancellation and unreadable-token recovery copy is resource-backed in
  EN/AZ/RU and states only that no action was sent; it does not render a QR
  token or internal scanner detail.

## Evidence and privacy posture

- The manifest declares no `CAMERA` permission. It declares foreground/action-time
  location and `USE_BIOMETRIC` only; it has no background-location permission,
  location service, listener or receiver. When an active server manifest
  requires location for an exact employee action, `WorkforceActionTimeLocationCapture`
  obtains one user-triggered foreground-only `getCurrentLocation` sample with
  no stale last-known fallback. It rejects fixes older than 30 seconds or
  outside coordinate and accuracy bounds, exposes the platform mock flag for
  server assessment, cancels after 15 seconds, and returns explicit permission,
  provider, platform and timeout states. Those states send no action and have
  no offline bypass; the flow remains inactive until a tenant publishes the
  separate proof policy and passes its physical/privacy gates.
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
- Every allowed server segment mode (`SITE`, `REMOTE`, `FIELD`, `TRAVEL`,
  `ON_CALL`, `EXCEPTION`) now maps through a local EN/RU/AZ resource instead
  of exposing a lower-cased transport enum. An unknown future value renders a
  neutral unavailable schedule-type label rather than an invented translation
  or inferred mode.
- The Today start time is formatted from its server instant in the server
  snapshot's tenant timezone, never by device timezone or a raw ISO string.
  Invalid instant/timezone input renders a localized unavailable value rather
  than exposing the transport value or calculating a local replacement.

## Opt-in local reminders (`WF-C9-011`, partial)

- The employee must explicitly turn on the local reminder. Android 13+ asks
  for `POST_NOTIFICATIONS` only after that employee action; a denied permission
  or a system-disabled notification channel produces a safe visible state and
  schedules nothing.
- The server's own immutable `WorkforceShiftSnapshot.plannedEndAt` is an input.
  When the server has selected exactly one **next** immutable segment, it may
  additionally return its server-resolved `startsAt`; Android does not derive
  that instant from the Baku default, a device timezone, a local date or a
  clock. The client does not use current site, location, QR or device proof to
  create a reminder. If no current approved schedule context is returned, or
  all approved windows have passed, it cancels prior reminders instead of
  guessing.
- Each WorkManager request stores `Data.EMPTY` and one fixed generic name;
  no workday, employee, tenant, site, segment, location, proof or action
  identifier is written to local WorkManager metadata. Sign-out, tenant/account
  change, disabling the option, completed workday and stale/no-plan state
  cancel every reminder.
- The worker displays only “LeadDrive Workforce — Open Workforce to review
  your work-time status.” It contains no time, name, site, location, QR or
  device information. A notification failure ends the one-shot job rather than
  retrying and possibly showing a duplicate alert.
- This is intentionally only a private **missed-finish or next-segment**
  reminder. There is no push credential, start reminder before a workday
  exists, server no-show action or delivery receipt. Those flows remain
  unimplemented until an approved server-side notification contract and
  physical-device evidence exist.

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
- The root runtime statuses (sign-in, refresh, encrypted-outbox queue, request
  submit/cancel, trusted-device action/enrollment/revoke and sign-out) are now
  resource-backed in EN/AZ/RU. API failures render a local conflict, request
  failure, unavailable transport or known managed-Play update outcome; the app
  does not reflect `WorkforceApiException.message` into employee UI. The update
  mapping accepts only the two fixed server release codes and does not expose a
  server/platform diagnostic. Successful device operations render the known
  local lifecycle resource instead of an internal API message. This keeps
  recovery useful without exposing server, device or request diagnostics.
- The per-use Android biometric prompts for the exact action and device
  enrollment are resource-backed too. The action prompt uses the existing
  localized action label; the enrollment prompt includes only its server
  expiry, never proof material.
- The static employee UI around Today, Recovery, Requests, Work Time history
  and the known workday state is now resource-backed in EN/AZ/RU. It preserves
  the safety boundaries: the Today disclosure still says that location is not
  background-tracked and that an outbox entry is not an accepted fact; the
  Recovery introduction still promises metadata-only recovery; Requests still
  distinguish a review claim from approved time or payroll. Free-form
  reviewer notes and server-returned calendar/request values are not
  machine-translated by the client.
- The on-device reminder and encrypted-outbox Recovery surfaces now carry
  typed, non-sensitive local state/hint codes from the data layer and resolve
  all employee wording in EN/AZ/RU Compose resources. This preserves the same
  queue safety: unknown stored domain/state fails closed to generic
  `Workforce action`/`Needs review`; no operation ID, ciphertext, reason, QR,
  location or proof becomes a translation input. The local data layer no
  longer stores English display text for these recovery values.
- The mobile history parser now converts known request type/status and calendar
  codes into typed values before Compose renders them. Known values use
  EN/AZ/RU resources; an unknown future server value displays a generic
  localized review state and is never cancelled locally. This prevents server
  enum literals from becoming accidental English UI while retaining an honest
  indication that human review may be needed. Dates and free-form reviewer
  notes remain server facts, not translation inputs.
- The latest Android CI candidate exposed a Compose compiler error in a prior
  trusted-device source line: `stringResource` was called from the non-
  composable `rememberSaveable` initializer. The source now resolves the
  default label before that initializer. The external Gradle rerun is still
  required; this record does not claim a compiled Android artifact.

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
  the existing account-bound encrypted Room rows, records a privacy-safe
  update-required recovery state and does not consume an operation retry. After
  a supported sign-in or restore (including an in-place update), it schedules
  those scoped rows for normal oldest-first drain. The additive v1-to-v2
  account-fence migration deliberately removes unscoped legacy rows instead
  of replaying them under a fresh sign-in. It never decrypts them merely to
  migrate, recreates an attendance proof or makes an accepted local fact.
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
- `PASS` — the targeted Android-foundation source contract (17 tests), exact
  EN/RU/AZ resource-key parity, scoped ESLint and `git diff --check` cover
  localized generic status/error copy, absence of raw API-message reflection,
  resource-backed device prompts and the composable-safe default device label.
- `PASS` — the same targeted source contract, resource-key parity, scoped
  ESLint and `git diff --check` cover the resource-backed Today/Recovery/
  Requests/History copy and localized known workday labels. The raw server
  calendar/request/reviewer values remain deliberately unmodified.
- `PASS` — resource-key parity, the targeted Android source contract, scoped
  ESLint and `git diff --check` cover type-only reminder/outbox recovery state,
  localized generic recovery hints and absence of data-layer display text.
- `PASS` — complete mobile Compose text-resource guard, resource-key parity,
  17 targeted Android source contracts, scoped ESLint and `git diff --check`
  cover typed request/calendar rendering, unknown-value fallback and no direct
  hard-coded UI text in `MainActivity.kt`.
- `PASS` — the current 17 Android source contracts, scoped ESLint and
  `git diff --check` cover the typed self-exception empty-list branch and the
  absence of the unused device-status display-text channel in the Android data
  model. This is source-level evidence only.
- `PASS` — GitHub Actions Android debug lint/unit completed successfully on
  candidate `f1e9dde44` after the repair below. Android Gradle lint/unit had
  previously run on candidate `4135083e4` and correctly rejected five
  `LocalContextGetResourceValueCall` errors. The pre-fix code read dynamic
  device-action, enrollment and lifecycle strings through
  `LocalContext.current.getString`, which could retain stale configuration
  values after a locale/configuration change. The current source resolves the
  action/lifecycle copy and an enrollment placeholder template through
  composition-aware `stringResource` values, then substitutes the server
  expiry only into that already-localized template. No lint baseline or
  suppression was added. This Contabo worktree did not run Gradle; the
  prescribed external gate did. The current PR candidate still requires its
  own GitHub Android debug lint/unit result for its later mobile changes.
- `FAIL / external` — GitHub Actions Android debug lint/unit for `26020f925`
  stopped at Kotlin compilation before lint or unit tests: `MainActivity.kt`
  used `emptyList()` as a `when` branch for the nullable typed exception-card
  list, leaving its generic type ambiguous. The successor source uses the
  typed `ownExceptions.isEmpty()` branch and has a source-contract guard.
  This is not a passing current-SHA Android result.
- `NOT RUN / next candidate` — the successor checkpoint requires the same
  prescribed GitHub Android debug lint/unit gate. Contabo must not substitute
  a local Gradle build.
- `NOT RUN` — Android Gradle lint/unit tests, build, emulator/device tests,
  camera/location/QR checks, notification permission/channel/delivery failure,
  TalkBack, AZ/RU/EN linguistic review, 200% font, contrast, reduced-motion
  and poor-vision exercise, Keystore attestation chain verification, managed
  Play upload and signing. Contabo has no Java, Android SDK or Gradle; the new
  GitHub workflow is the prescribed external debug gate.

## Deliberate remaining work

Today submits online first; a transport/ambiguous transient failure saves the
same immutable operation into the encrypted outbox. Explicit server rejections
and proof/state conflicts are never queued. A location-required action captures
one fresh foreground sample, sends it only with that immediate v4 workday
operation, and never places raw coordinates in the encrypted outbox; the
server applies its quality/geofence evidence boundary before accepting the
action. A QR-required action scans one fresh token and sends it immediately.
A device-required action can start/resume an
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
