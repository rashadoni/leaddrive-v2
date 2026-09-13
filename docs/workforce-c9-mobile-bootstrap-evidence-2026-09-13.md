# WF-C9-002 — Workforce mobile bootstrap foundation

## Delivered boundary

The existing authenticated mobile bootstrap now exposes one additive
Workforce release contract beside the already separated tenant module,
principal permissions, attendance policy and sync manifest.

- `modules.workforce.configVersion` carries the exact effective attendance
  policy identity instead of pretending an unversioned cache is current.
- A future Android client may send `x-workforce-app-version-code` and receives
  a deterministic minimum/recommended/maximum compatibility decision.
- An explicitly configured stale, missing, malformed or too-new client is
  told not to submit new Workforce actions. The response keeps a distinct
  drain-before-update or contact-support recovery state.
- An incoherent server policy fails closed. No version value, package name,
  signing identity or store URL is guessed.
- With all release variables absent, the contract is `NOT_CONFIGURED` and is
  inert for installed legacy Field clients. Existing API authorization,
  evidence and idempotency checks remain server-authoritative.
- Once a coherent window is configured, direct and offline mobile Workforce
  writes enforce the same release decision before creating new state. An exact
  stored idempotent replay remains readable so an expired client can drain and
  reconcile its outbox before updating. Route-only and browser paths remain
  independent.

## Configuration

The server-only variables are documented in `.env.example`:

- `WORKFORCE_ANDROID_MIN_VERSION_CODE`;
- `WORKFORCE_ANDROID_RECOMMENDED_VERSION_CODE`;
- `WORKFORCE_ANDROID_MAX_VERSION_CODE` (optional).

All values are strict positive Android version codes. The feature is not an
activation mechanism: production remains inert until an accountable signed
client and release owner set a coherent policy through the normal secret and
deployment path.

## Verification

- Targeted pure tests cover unconfigured, capability-disabled, missing,
  malformed, stale, recommended, supported, too-new and invalid-policy cases.
- The bootstrap API contract covers the additive forced-update response while
  retaining HTTP 200 for state recovery and the legacy response shape.
- Direct-workday and mixed mobile-sync contracts cover missing, malformed,
  expired, too-new and invalid server-policy outcomes, including the
  replay-before-version-fence recovery order.
- PR #149 passed all five required checks and merged as
  `93a1a1d8bd716c8ffca1d781174521866b51bdeb`.
- `NOT RUN`: full typecheck/build and browser/Android checks on Contabo; CI or
  the approved heavy/mobile runner owns them.
- `NOT RUN`: signed app, package/signing custody, Play distribution and
  physical-device behavior. Those remain WF-C9-001/C9-003..014/C14 gates.

## Status

WF-C9-002 is **DONE** at its Mobile/Backend server-contract boundary: secure
authenticated bootstrap supplies the split tenant manifest, permissions,
effective attendance configuration, exact wire-schema support and release
decision, and every supported new mobile Workforce write is server-fenced.
Native UI/outbox consumption, package/signing custody and physical-device
evidence remain explicitly separate WF-C9-001/C9-003..014/C14 tasks.
