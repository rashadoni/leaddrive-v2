# Workforce C4 — server-side geofence evaluation

> **Checkpoint:** `WF-C4-002` — 2026-08-30
>
> **Scope:** deterministic circle geometry only. It does not collect location,
> choose a proof policy, or establish identity/presence on its own.

## Delivered behaviour

`evaluateWorkforceSnapshottedGeofence` accepts a parsed version-1 location
evidence envelope and the immutable circle revision selected for the workday
or shift segment. It calculates the Haversine distance on the server and
returns only:

- `INSIDE` when the full reported accuracy circle is inside the geofence;
- `OUTSIDE` when the full reported accuracy circle is outside it; or
- `UNKNOWN` when no snapshot/usable location exists or the accuracy circle
  crosses the boundary.

The output includes the opaque geofence revision ID, numerical distance and
reported accuracy, plus a stable reason code. It never returns latitude or
longitude. A client cannot submit its own inside/outside conclusion.

The supported first geometry remains the calibrated 25–5,000 m circle from
C2. A later polygon or multi-entrance geometry needs a new snapshot contract;
it cannot silently reinterpret existing evidence.

## Explicit non-decisions

- Freshness, maximum accuracy, mock location, provider and permission-denied
  policy are C4-003. This evaluator makes none of those signals look like a
  successful presence decision.
- QR, device trust and kiosk proofs remain C4-004/C5 paths; their method
  verification is not replaced by GPS geometry.
- Evidence retention, append-only persistence and report-facing assessment
  storage are C4-006/C10 work.

## Verification

```text
npx vitest run src/__tests__/workforce-evidence-envelope.test.ts \
  src/__tests__/workforce-geofence-evaluation.test.ts \
  --pool=forks --maxWorkers=1

2 files passed, 8 tests passed

npx eslint src/lib/workforce/geofence-evaluation.ts \
  src/__tests__/workforce-geofence-evaluation.test.ts \
  src/lib/workforce/evidence-envelope.ts \
  src/__tests__/workforce-evidence-envelope.test.ts
PASS

git diff --check
PASS
```

The test matrix covers centre, boundary uncertainty, clearly outside location,
missing snapshot, unavailable permission and valid `(0, 0)` coordinates.

## Not run

- Full TypeScript check, production build, browser E2E, Android and load:
  **NOT RUN** — heavy gates belong to GitHub CI/approved worker.
