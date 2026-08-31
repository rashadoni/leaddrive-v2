# Workforce C9 — action-time location binding v4

> **Status:** source-only partial evidence for `WF-C9-007` and compatibility
> evidence for `WF-C13-001/003`; not a signed Android build, geofence verdict,
> encrypted evidence persistence, physical-device result, tenant activation or
> pilot.
> **Recorded:** 2026-08-31

## Delivered source path

1. A server policy can require location only for explicit attendance actions.
   The Android client first sees that server-owned manifest requirement, then
   requests foreground permission only after the employee presses that action.
2. The client obtains exactly one `getCurrentLocation` sample. It has no
   listener, receiver, foreground service, background permission or last-known
   location fallback. Permission/provider/unavailable/unsupported states send
   no work-time action and point to the approved review path.
3. The fresh sample is sent with the immediate v4 canonical workday mutation:
   coordinates/accuracy remain the existing top-level raw-location transport;
   source provider, mock flag and capture time are under `attendance.location`.
   Raw location is an ephemeral proof: it is never admitted to the encrypted
   Android outbox after a transient transport result.
4. The server accepts the v4 metadata only with complete coordinates and
   accuracy, binds it into the idempotency request hash and applies the shared
   `LOCATION` quality policy before accepting a location-required action. A
   missing, stale, mock, weak or non-eligible-provider claim fails closed to a
   reviewed-fallback error rather than silently passing.
5. When a trusted device is also required, its exact-action signature includes
   the location capture time, coordinates, accuracy, provider and mock flag.
   The legacy no-location signature format remains byte-for-byte unchanged.

## Compatibility and deliberate limits

- `schemaVersion` v4 is additive; v1-v3 requests and hashes retain their old
  behavior. The new migration changes only the existing schema-version check
  from `(1, 2, 3)` to `(1, 2, 3, 4)` and contains no data rewrite.
- This is **not** an inside/outside geofence result. It has not yet selected a
  snapshotted site/geofence, encrypted a `WorkforceEvidenceEnvelope`, written
  an evidence assessment, or created a reviewed exception case. Those are
  still necessary before an office GEO policy can be activated.
- The current raw-coordinate retention job remains responsible for the
  compatibility workday/event copies. No retention run or migration apply was
  executed.
- The implementation intentionally captures location before a QR scan, so no
  QR token is kept while Android shows an OS permission prompt. A later QR or
  device proof remains one immediate action only.

## Verification

Passed in this worktree:

```text
vitest: 8 targeted files / 205 tests
  lib-mtm-workday, attendance trust/security, week writer, mobile sync,
  v3/v4 migration contracts and Android source contract
eslint: modified production modules and new focused tests — passed
git diff --check — passed
```

The legacy `lib-mtm-workday.test.ts` and `api-mtm-week.test.ts` contain
pre-existing `no-explicit-any` diagnostics, so they were covered by Vitest but
not represented as a full-file ESLint pass. No lint baseline or suppression
was added.

`NOT RUN`: Android Gradle lint/unit for this exact SHA, migration apply,
Prisma generate/validate after the new migration, full typecheck/build,
browser E2E, signed Android/permission/GPS/QR/biometric matrix, isolated
staging load/restore and physical pilot.
