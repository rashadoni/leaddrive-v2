# C8/C10 — derived Workforce evidence timeline

## Safe boundary delivered

`GET /api/v1/workforce/evidence/timeline` is a Workforce-only, human-session
endpoint for one exact employee and at most 31 tenant-local calendar days.
It does not reuse Route & Field GPS history.

Before any employee or evidence read, the endpoint requires:

- the `workforce-hrm` tenant capability and a live human session;
- a distributed per-principal rate-limit decision;
- a bounded `x-workforce-access-purpose` value;
- a bounded `x-workforce-access-reason-code` value;
- an exact employee scope;
- before granular cutover, the established tenant-admin boundary; after
  cutover, an effective `EVIDENCE_REVIEWER` grant for that employee or the
  organization.

The append-only `audit_logs` access audit must be written successfully before
the response is returned. It records the accountable session user, the
target employee, purpose/reason, optional opaque case reference, date range,
row count and `DERIVED_ONLY` projection. An unavailable audit produces a
no-store `503` instead of returning unlogged evidence.

## Data minimization

The Prisma select and public response contain only:

- evidence identifier, capture source/time and raw-retention state;
- canonical workday action or site-transition claim and its review state;
- immutable assessment kind/version, verdict, bounded reason codes and time.

They do **not** select or return raw coordinates, encrypted envelopes,
redacted raw receipts, payload hashes, QR nonce/token material, trusted-device
proof, device enrollment, reversible distance or accuracy. The response says
explicitly that a derived verdict is not identity or physical-presence proof.

Route & Field location history remains a separate module and endpoint. This
change neither grants Workforce roles access to Route GPS nor changes a Route
manager's existing Route entitlement.

## Verification

- PASS: targeted ESLint for the route, access resolver, parser, rate limit and
  tests.
- PASS: 3 new test files / 11 tests cover purpose/reason validation, exact
  grant behavior, API-key and manager denial, derived-only projection,
  rate-limit containment, output bounds and mandatory-audit failure.
- PASS: existing Workforce report rate-limit suite, 1 file / 6 tests.
- PASS: `git diff --check`.
- NOT RUN locally: full typecheck/build/browser E2E; the GitHub PR gates own
  heavy verification.
- NOT RUN: raw-evidence decryption/disclosure, because an accountable
  investigation policy and UI have not been approved or implemented.
- NOT RUN: periodic access-review exercise and browser evidence.

## Remaining status

WF-C8-009 and WF-C10-006 remain **PARTIAL**. The derived server boundary is
ready, but the visible timeline, separately reviewed raw-investigation flow
and periodic audit review still require their own checkpoints and evidence.
