# Workforce C9 — action-time location recovery copy (2026-08-31)

## Scope

The Android employee UI now converts the two explicit terminal Workforce
location codes into localized, recovery-safe status text:

- `WORKFORCE_ATTENDANCE_LOCATION_REQUIRED`: the employee must refresh and
  re-capture a fresh sample, or use the approved review path;
- `WORKFORCE_ATTENDANCE_LOCATION_REVIEW_REQUIRED`: the sample needs approved
  review and no attendance action was accepted.

The mapping applies to the canonical mobile-sync response after the server has
made the decision. It does not expose raw error content, coordinates, GPS
provider details, device proof, QR token, policy internals or a false promise
that an action was queued.

## Safety boundaries

- Location proof remains immediate-only. The existing encrypted outbox rejects
  it before retry, so these terminal codes never create a later re-capture or
  replay from a stored raw point.
- Capture-side permission/provider/unavailable states remain separate local
  messages. This slice covers only server-received, fail-closed decisions.
- It adds no background/on-duty tracking, no exception resolution, no tenant
  policy activation and no physical Android assertion.

## Verification

Passed in this worktree:

```text
vitest: 3 focused files / 132 tests
  Android source/resource contract, attendance trust and mobile-sync contract
eslint: updated Android source-contract test
git diff --check
```

`NOT RUN`: Android Gradle lint/unit for this SHA, signed device recovery,
permission/GPS/QR/device matrix, browser E2E, full typecheck/build, staging
and pilot.
