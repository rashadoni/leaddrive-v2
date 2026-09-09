# Workforce / HRM H0 baseline

Date: 2026-08-28

Implementation branch: `codex/implement-hrm-plan`

Source plan: `docs/mtm-hrm-module-plan-2026-08-28.md`

## Frozen compatibility surface

The H0 compatibility contract keeps these legacy tables and adapters intact
while the independent Workforce surface is introduced:

- `mtm_agent_workdays` and `mtm_agent_workday_events`;
- `mtm_hrm_requests`;
- `/api/v1/mtm/mobile/workday`;
- `/api/v1/mtm/mobile/hrm`;
- Workforce operations in `/api/v1/mtm/mobile/sync/push`;
- `/api/v1/mtm/operations/hrm/{id}/decision`.

The canonical commercial capability is `workforce-hrm`. The four supported
combinations remain Neither, Workforce-only, Route & Field-only, and Both.
Existing `mtm` tenants retain the compatibility entitlement until they receive
an explicit `workforce-hrm` value; an explicit `false` always wins.

H0 did not authorize a destructive rename, drop, retention deletion, payroll
calculation, global QR/device enablement, or biometric-required attendance.
The later H1–H5 implementation adds only additive schema and capability-gated
server paths; it does not change a tenant until that tenant is deliberately
enabled.

## Reproducible database snapshot

Run `scripts/workforce-hrm-baseline.sql` with a read-only PostgreSQL role and an
explicit tenant ID. Store the timestamped output outside git because it may be
contract- or customer-sensitive.

The query reports:

- active employees;
- workday events in the selected window, average per active UTC day, and peak;
- open shifts from an earlier date;
- pending HRM requests;
- database persistence-lag percentiles as an offline/queueing diagnostic.

Persistence lag is **not** API latency. It can include a legitimate offline
interval between `occurredAt` and `createdAt`.

## Current evidence status

| Evidence | Status | Reason / source |
|---|---|---|
| Legacy API/table contract | Implemented | Contract tests in `src/__tests__/workforce-legacy-contract.test.ts` and existing MTM API tests |
| Tenant data counts | NOT RUN | No database credentials are present in this worktree session |
| Workday events/day | NOT RUN | Same database prerequisite |
| Online critical-event API p95 | NOT RUN | Requires ingress/application latency telemetry; DB timestamps are not a substitute |
| Mobile outbox age p50/p95/max | NOT RUN | Requires per-domain device sync telemetry introduced by H4 |
| Physical-device baseline | NOT RUN | Reserved for the H6 pilot matrix |

## Recorded owner decisions

The owner decisions previously listed as an H0 stop condition are now recorded
in [the Workforce rollout runbook](./workforce-pilot-rollback-retention-runbook-2026-08-28.md#2-owner-gate-before-schema-or-pilot-work):

- employee-facing name: «Рабочее время»; manager-facing name: «Табель и
  команда»;
- first release exports approved timesheets only; payroll is excluded;
- time facts and decisions: 1 year; raw GPS: 30 days;
- ordinary release has QR, device trust and biometric-required attendance
  disabled; a separately recorded H5/H6 physical pilot may test QR/device
  trust without global enablement;
- managers may make a direct correction only with a mandatory reason and
  immutable audit; an approved period receives a correcting record rather than
  an overwrite;
- supported offline horizon: 7 days.

The decisions unblock the additive H1–H5 implementation that now exists on
this branch. They do **not** authorize a retention purge, a payroll
calculation, a production capability toggle, a physical-device pilot or a
tenant-specific export delivery. Those remain separately controlled release
actions.

## H0 gate status

The contract and owner-decision portion is recorded. The production baseline
portion remains **NOT RUN** until a read-only, tenant-scoped database and
telemetry access is explicitly provided. Do not substitute development data,
database persistence timestamps or source-level tests for production p95,
outbox-age or active-employee evidence.
