# Workforce C9 — action-time location transparency

> **Status:** source-only partial evidence for `WF-C9-007` and `WF-C10-008`.
> **Recorded:** 2026-08-31

## Delivered source boundary

- `WorkforceTodayCard` evaluates the active, server-owned
  `WorkforceAttendanceRequirements` for each allowed action.
- Only when `requiresLocation(action)` is true, the employee sees an
  AZ/RU/EN message directly beneath that action. It explains that selecting
  the named action asks Android for a current location for that action only,
  and that it does not enable background location tracking.
- The existing Today-level disclosure remains a general boundary. The new
  message is action-specific rather than a generic assertion that location is
  always collected.
- The UI neither changes a tenant policy nor supplies an action requirement.
  The existing foreground-only capture path still begins only after the
  employee explicitly selects an action for which the server manifest requires
  location.

## Deliberate limits

- This does not grant an Android permission, collect a coordinate, enable a
  tenant policy, start a foreground/background service, or turn a location
  sample into a presence decision.
- It is not evidence of Android rendering, accessibility review, employee
  acceptance, battery behavior, GPS/provider behavior or a physical pilot.

## Verification

The `workforce-android-foundation` source contract checks that the action-level
condition and resource are present in every core locale. The exact Android
Gradle lint/unit build and real-device permissions/accessibility exercise are
**NOT RUN** on Contabo; they require CI or a permitted heavy worker/device.
