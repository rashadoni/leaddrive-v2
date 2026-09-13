# Workforce C7 durable access-review evidence

Date: 2026-09-13

Roadmap item: `WF-C7-010` (partial)

## Delivered boundary

- An MFA-protected, granular tenant-admin endpoint reads at most 1,000 durable
  Workforce grants from the tenant/RLS ledger.
- The existing pure reviewer now receives real expiry, revocation, principal
  status, role and exact scope data. It reports expired-unrevoked, inactive
  principal and incompatible active-role findings by grant ID.
- The review is dry-run and never revokes automatically. An accountable
  administrator must use the existing append-only revocation workflow.
- Exact per-grant usage telemetry is not yet stored. The response therefore
  marks activity evidence `UNAVAILABLE` and suppresses stale-use findings
  instead of treating absent telemetry as proof of inactivity.
- Corrupt scope rows fail closed; they are never downgraded to organization
  scope. The audit stores only aggregate counts and evidence state.

## Verification

- PASS: 3 focused Vitest files / 19 tests after rebasing onto the accepted
  retention-grant checkpoint.
- PASS: scoped ESLint.
- PASS: `python3 scripts/rls/find-context-gaps.py` (`RLS-CONTEXT GAPS: 0`).
- PASS: `git diff --check`.
- NOT RUN: disposable-database/RLS integration, scheduler SLA and browser
  workflow. These remain separate C7/C12 gates for CI or an approved heavy
  worker.

## Explicit exclusions

No automatic revocation, grant, tenant flag, scheduler or production data
change is introduced. Exact usage instrumentation, reviewed scheduling and
staging evidence remain open before `WF-C7-010` can be accepted.
