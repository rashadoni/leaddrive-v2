# Workforce C9 — explicit action-time location policy contract

> **Status:** source-only partial evidence for `WF-C9-007`; not a location
> collection activation, Android build, signed app, device test or pilot.
> **Recorded:** 2026-08-31

## Delivered contract

- `attendance.location.requiredActions` is now a strict, versioned Workforce
  attendance-policy field. It accepts only the canonical `START`, `PAUSE`,
  `RESUME` and `FINISH` action names and does not infer a requirement from a
  module entitlement, schedule, site or Route configuration.
- The server-owned mobile bootstrap manifest exposes
  `locationRequiredActions` only when the resolved policy is valid and active.
  A policy with no `attendance` block still advertises no attendance
  requirement, preserving existing tenants' behavior.
- The Android parser treats this as an immediate action requirement only while
  the manifest status is `ACTIVE`; it has no local default and no background
  job, receiver or location subscription.
- The existing foreground-only `getCurrentLocation` primitive is still not
  invoked by this checkpoint. Therefore this change cannot begin collecting
  coordinates merely by shipping the client or publishing a generic Workforce
  entitlement.

## Safety boundary and next slice

This checkpoint intentionally does **not** claim that a GEO-required action is
currently accepted as an inside-geofence attendance fact. The next source
slice must bind one fresh foreground capture to one operation, send it through
the canonical Workforce workday writer, and have the server persist/evaluate
the encrypted evidence envelope and snapshotted site policy. It must preserve
the current no-background/off-shift boundary and define a reviewed recovery
path for unavailable permission/provider/accuracy signals.

No tenant policy is enabled here. Publishing a `location` rule before that
server/action binding is complete would be premature and is not a supported
activation procedure.

## Verification

Passed in this worktree:

```text
vitest: workforce-attendance-security, api-mtm-mobile-bootstrap,
        workforce-android-foundation — 44 tests passed
eslint: attendance-policy, mobile bootstrap, policy/security and Android
        source-contract tests — passed
git diff --check — passed
```

`NOT RUN`: Android Gradle lint/unit for this exact SHA, signed build,
permission/GPS/QR/device physical matrix, browser E2E, isolated staging,
load/restore and pilot. Those require GitHub CI, a designated heavy worker or
real devices and are not substituted with Contabo checks.
