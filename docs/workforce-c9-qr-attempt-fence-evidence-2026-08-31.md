# Workforce C9 — fresh QR action-attempt fence (2026-08-31)

## Scope

This source slice hardens `WF-C9-008`'s already delegated one-off QR path. It
does not enable QR for a tenant, change server TTL/nonce verification, persist
a QR token, or make a device scan physical-pilot evidence.

The Android UI now gives each active scan a monotonically increasing in-memory
attempt ID and the expected work-time action. While the scanner is open, that
action is marked busy and the other transition buttons are disabled. Only the
matching live callback can submit the token. Cancel/failure clears the same
attempt; sign-out clears it too. Thus a second tap cannot create parallel scans
and a callback that arrives after cancellation or account logout is ignored.

The token itself remains only in the immediate callback/transport call. It has
no `toString`, SavedState, Room, SharedPreferences, log or encrypted-outbox
path. Server QR nonce/action/tenant/expiry validation remains authoritative;
a phone cannot revoke a request already handed to transport before logout.

The callback now returns a one-use `WorkforceEphemeralQrToken`, rather than a
raw string exposed to the UI or repository API. Only
`WorkforceApiClient.newTodayOperation` can consume that object while it builds
the immediate action envelope. A second use is rejected, so a retry,
device-signature failure or duplicate callback requires a fresh station scan.
The raw value still exists only for that immediate envelope and remains
outbox-ineligible.

## Verification

Passed in this worktree:

```text
vitest: workforce-android-foundation
source contract passed
git diff --check passed
```

`NOT RUN`: Android Gradle lint/unit for this SHA, real scanner cancel/duplicate
callback tests, QR expiry/replay/relay exercises, accessibility review, staging
and the physical Android/pilot matrix. Those require GitHub CI or real
hardware/staging and are not represented as complete here.
