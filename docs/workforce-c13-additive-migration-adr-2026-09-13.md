# ADR: Workforce additive migration and compatibility boundary

**Status:** accepted for the current server foundation.
**Date:** 2026-09-13.

## Decision

Workforce evolves only through forward-compatible additions while a supported
legacy client can still submit workday operations. Existing workday rows and
events are never rewritten to claim provenance, site, device, QR or evidence
that was not captured at the time.

The deployed sequence starts at `20260828223000_workforce_h3_foundation` and
continues through the current C1-C7 tables, constraints, indexes, RLS policies,
append-only triggers and default-profile provisioning. Each migration may add
or replace a validation constraint, but the Workforce sequence contains no
table/column drop, table/column rename, row delete or rewrite that fabricates
historical evidence, provenance, policy, location, device or assurance.

The one reviewed metadata-backfill exception is
`20260927014100_workforce_exception_case_revisions_backfill`. It fills only the
new nullable `workforce_exception_decisions.caseRevision` structural ordinal,
derived deterministically from the existing immutable decision ledger by
tenant/case and stable `createdAt, id` order. It does not alter an existing
decision fact or infer external evidence. The update is separately tracked,
transactional and time-bounded; keeps the append-only trigger enabled; admits
only `NULL -> positive` for a relation-owner member under the explicit
backfill setting; and compares every other column byte-for-byte through
`to_jsonb`. Every other Workforce migration remains UPDATE-free.

## Compatibility rules

1. The direct `/api/v1/mtm/week/workday` adapter and the v1 offline sync push
   adapter both parse their transport and call the one canonical
   `applyMtmWorkdayEvent` state machine. A second write authority is prohibited.
2. Workday request schema v1 remains legacy-compatible, v2 adds ordered
   provenance, and v3 may bind a snapshotted segment. Unknown versions are
   rejected before mutation. Evidence envelopes independently pin schema v1.
3. Bootstrap advertises protocol v2 only for an exact server-enrolled stream
   cohort. An old client keeps protocol v1 and ignores additive fields.
4. Existing events default to `LEGACY_UNKNOWN`. No migration fabricates
   `queuedAt`, request hashes, segment identity, evidence or assurance.
5. New approval/report paths consume immutable policy/shift/schedule snapshots
   where present. A legacy day without required snapshots returns the explicit
   `SNAPSHOT_MISSING` blocker; it is not recalculated from a current live policy.
6. Route Field and Workforce entitlements remain independent in bootstrap,
   navigation, web/API guards and v2 stream cohorts. Neither, HRM-only,
   Routes-only and Both are valid server modes.

## Rollout and rollback

Schema additions remain installed during rollback. Rollback disables an exact
cohort or the Workforce capability, preserves the canonical event ledger and
does not clear an outbox/cursor or rewrite/delete history. The compatibility
window and v1 census are defined in `mobile-sync-v2-rollout-runbook.md`.
Actually retiring v1 still requires the recorded adoption threshold, offline
drain and physical client evidence; no current migration or flag performs that
retirement.

## Verification boundary

The source contract scans every Workforce migration and fails on destructive
DDL/DML. It rejects every UPDATE except the exact named structural-revision
phase, for which it positively pins the target table/column, deterministic
ordering, NULL-only predicate, transaction timeouts, owner-membership guard,
all-other-columns equality and uninterrupted append-only trigger. It also pins
both adapter imports/calls, version constants, legacy-unknown defaults,
explicit missing-snapshot approval behavior and the four entitlement modes.
Disposable-database apply, before/after production reconciliation and signed
mobile compatibility remain later C13/C14 evidence.

## Amendment — 2026-09-27

The original 2026-09-13 source contract rejected the lexical presence of every
top-level `UPDATE`. The case-local lifecycle cutover exposed that this was
stricter than the accepted `WF-C13-001` requirement to prohibit *destructive*
backfills: a deterministic ordinal for an existing immutable decision is
structural metadata, not fabricated historical assurance. This amendment does
not permit a general backfill class or baseline waiver. It names one migration
and replaces the blanket lexical check with the positive fail-closed contract
above; any second migration or broader mutation still fails CI.

## Amendment — append-only statement guard, 2026-09-27

The inactive C6 exception-policy revision ledger adds a statement trigger that
rejects direct table clearing as well as row update/delete. The original source
contract rejected the word used by that protective trigger because it could
not distinguish a destructive command from a `TG_OP`/`BEFORE` guard.

The compatibility contract now names only
`20260927070000_workforce_exception_policy_revision_foundation`, positively
requires its exact append-only function, exact statement trigger and rejection
message, and still rejects any top-level destructive command in every
Workforce migration. All other Workforce migrations remain forbidden from
containing that token. This amendment permits no data rewrite, seed, backfill,
table clearing or reusable exception class.
