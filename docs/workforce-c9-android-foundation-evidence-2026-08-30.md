# Workforce C9 — native Android foundation

> **Status:** safe partial source foundation for `WF-C9-001`, `WF-C9-002`,
> `WF-C9-003`, `WF-C9-004`, `WF-C9-006` and `WF-C5-003`. It is not an Android build, signed app, device-attestation
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
- A logout or tenant switch first destroys the outbox key and then clears all
  rows. A different tenant can never submit a former tenant's operation; an
  unexpected scope mismatch is discarded rather than replayed.

## Evidence and privacy posture

- The manifest declares camera and foreground/action-time location permissions
  only. It has no background-location permission, location service or action
  capture implementation.
- `WorkforceDeviceKeyManager` requests a challenge-bound ECDSA Android
  Keystore key, tries StrongBox where available, falls back only when the
  device reports StrongBox unavailable, and asks for per-use strong biometric
  or secure-device-credential authorization. It can export only the public key
  and DER certificate chain for the existing enrollment protocol.
- It does not read, persist or send biometric templates/results. Attestation is
  still not accepted as proof until server chain/root/app-identity validation
  and physical-device evidence exist.

## Source-level checks

- `PASS` — `workforce-android-foundation.test.ts` fixes the module boundary,
  no-background-location/backup posture, release-property guard, Workforce-only
  endpoint list, release-policy version header, bounded CI, secure-store
  requirements and attestation-key source contract.
- `NOT RUN` — Android Gradle lint/unit tests, build, emulator/device tests,
  camera/location/QR checks, Keystore attestation chain verification,
  managed Play upload and signing. Contabo has no Java, Android SDK or Gradle;
  the new GitHub workflow is the prescribed external debug gate.

## Deliberate remaining work

Today submits online first; a transport/ambiguous transient failure saves the
same immutable operation into the encrypted outbox. Explicit server rejections
and proof/state conflicts are never queued. It does not yet capture
action-time location, site, QR or device proof, so a tenant that requires
those proofs receives the server's non-acceptance response rather than a
bypass. Work Time history is a bounded self-HRM server read and explicitly
labels the returned workday/request state as accepted server truth; it never
calculates an accepted fact from an outbox entry. Requests, physical
offline/process-death/two-account exercise, action-time permission/capture, QR scanner, device-enrollment transport,
attestation-server verification, accessibility localisation, update/outbox-drain
drill and real device matrix remain their individual C5/C9/C10/C14 tasks.
