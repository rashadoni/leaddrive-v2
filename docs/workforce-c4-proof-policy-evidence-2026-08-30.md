# Workforce C4 — proof-policy composition

> **Checkpoint:** `WF-C4-005` — 2026-08-30
>
> **Scope:** versioned rule resolution/evaluation only. It does not publish a
> tenant policy or convert a completed method combination into attendance.

## Delivered contract

`workforce-proof-policy-v1` defines an explicit rule for each segment/action
scope using three non-overlapping method groups:

- `allOf`: every listed proof is required;
- `anyOf`: one of the listed proofs is required;
- `optional`: signals that may be recorded/used by later review but do not
  make the rule pass by themselves.

The resolver chooses the most-specific `segmentMode`/action rule and fails
closed when none exists. Evaluation returns a stable list of missing methods
and a safe fallback state (`REVIEW_REQUIRED`, `MANUAL_REQUEST` or
`KIOSK_OR_BADGE`), never an automatic bypass. `MANUAL` may only be optional;
it cannot satisfy an automatic proof requirement.

The reversible baseline makes the recommended office/site rule explicit:
`LOCATION` **and** (`QR` or `KIOSK`), with `DEVICE` optional. Remote, field
and travel do not impose location collection by default. `SATISFIED` means
only “the configured combination is complete”; authenticated server action,
replay protection, snapshot and review rules remain separate prerequisites.

## Boundaries

- OD-04 and OD-16 remain owner gates for enabling a specific tenant/station
  policy and equitable recovery. The baseline is not silently written into a
  tenant’s policy JSON.
- C4-001..004 verify the inputs; C4-006 will append/persist assessments and
  C5/C9 implement trusted devices and the actual mobile/kiosk flows.
- The policy has no Route dependency. Field/travel defaults do not create
  background tracking or query customer/route data.

## Verification

```text
npx vitest run src/__tests__/workforce-proof-policy.test.ts \
  --pool=forks --maxWorkers=1

1 file passed, 4 tests passed

npx eslint src/lib/workforce/proof-policy.ts \
  src/__tests__/workforce-proof-policy.test.ts
PASS

git diff --check
PASS
```

The matrix covers office `allOf` + `anyOf`, remote/field/travel no-location
defaults, exact-rule precedence, missing-rule failure and invalid manual or
duplicate-method configuration.

## Not run

- Full TypeScript check, production build, browser E2E, Android and load:
  **NOT RUN** — heavy gates belong to GitHub CI/approved worker.
