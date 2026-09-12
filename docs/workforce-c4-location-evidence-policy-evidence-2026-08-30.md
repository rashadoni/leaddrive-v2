# Workforce C4 — location-evidence quality policy

> **Checkpoint:** `WF-C4-003` — 2026-08-30
>
> **Scope:** a reversible technical baseline for action-time location quality.
> It does not authorize real location collection, background tracking,
> discipline, payroll use or a tenant-specific proof configuration.

## Baseline v1

`workforce-location-evidence-v1` returns an explainable assessment before
C4-002 geometry can influence a workflow:

| Signal | Baseline result |
|---|---|
| Fresh (≤120 seconds), accuracy ≤100 m, `FUSED` or `GPS`, not mock-flagged | `ELIGIBLE_FOR_GEOFENCE` only — not an attendance acceptance |
| Stale/future clock, accuracy over 100 m, mock flag, `NETWORK`/`PASSIVE`/`UNKNOWN` provider | `REVIEW_REQUIRED`, preserving every applicable stable reason code |
| Permission denied, provider disabled or service unavailable | `UNAVAILABLE`, with a non-coordinate reason code |

The 100 m accuracy limit follows the C2 technical calibration baseline. The
two-minute action-time freshness and 60-second future clock tolerance are
conservative defaults, not a replacement for a tenant policy or site-local
calibration. No location-quality result asserts a human identity or silently
approves a time fact.

## Boundaries

- OD-03/OD-05/OD-12 remain required before collection for a real employee
  cohort. This code does not start background location or change a tenant.
- C4-005 will combine proof methods per segment/action. C4-008 still needs an
  approved equitable recovery for `UNAVAILABLE`/`REVIEW_REQUIRED`; this
  checkpoint exposes a safe state rather than inventing a bypass.
- C4-006/C10 remain responsible for persistence, restricted access and the
  30-day raw-GPS retention/purge procedure.

## Verification

```text
npx vitest run src/__tests__/workforce-location-evidence-policy.test.ts \
  src/__tests__/workforce-evidence-envelope.test.ts \
  src/__tests__/workforce-geofence-evaluation.test.ts \
  --pool=forks --maxWorkers=1

3 files passed, 12 tests passed

npx eslint src/lib/workforce/location-evidence-policy.ts \
  src/__tests__/workforce-location-evidence-policy.test.ts \
  src/lib/workforce/geofence-evaluation.ts \
  src/__tests__/workforce-geofence-evaluation.test.ts
PASS

git diff --check
PASS
```

The suite covers fresh calibrated evidence, all simultaneous review signals,
future clock handling, denied permission and valid zero coordinates.

## Not run

- Full TypeScript check, production build, browser E2E, Android and load:
  **NOT RUN** — heavy gates belong to GitHub CI/approved worker.
