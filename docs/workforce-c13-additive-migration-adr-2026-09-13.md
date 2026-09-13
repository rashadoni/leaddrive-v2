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
table/column drop, table/column rename, row delete or UPDATE backfill.

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
DDL/DML, pins both adapter imports/calls, version constants, legacy-unknown
defaults, explicit missing-snapshot approval behavior and the four entitlement
modes. Disposable-database apply, before/after production reconciliation and
signed mobile compatibility remain later C13/C14 evidence.
