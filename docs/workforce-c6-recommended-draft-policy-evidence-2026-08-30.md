# Workforce C6 — recommended exception-policy draft evidence

**Status:** WF-C6-001 done as a non-active product contract; no tenant policy
is activated.
**Date:** 2026-08-30

## Recorded v1 recommendation

With explicit owner authorization, the source now records
`WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1` in
`src/lib/workforce/exception-policy-draft.ts`.

- The taxonomy covers calculated deviations (`LATE_START`, `UNDERTIME`,
  `OVERTIME`, `LONG_PAUSE`), `NO_SHOW`, `MISSED_FINISH` and a bounded
  `ATTENDANCE_PROOF_REVIEW` intake. It does not create a category for payroll,
  discipline or biometric identity decisions.
- Severity is intentionally a **non-disciplinary review triage**:
  `ROUTINE_REVIEW` or `ATTENTION_REVIEW`, never a conclusion about employee
  fault. The owner is `HR_ADMIN`, with `TENANT_ADMIN` escalation.
- The proposed acknowledgement/resolution targets are 24/72 business hours
  for routine review and 8/48 business hours for attention review. They are
  targets only; a tenant calendar and an accountable activation are required
  before any measurement or escalation.
- The employee must be visible before a final HR decision. The policy forbids
  automated outcomes and explicitly excludes payroll, disciplinary and
  biometric-identity decisions.
- A pure lifecycle evaluator permits only human-visible review transitions:
  acknowledgement/escalation, an employee response or correction request,
  final resolution from HR review, and an explicit re-open. Unknown or invalid
  transitions fail closed.

## Deliberate non-activation boundary

This checkpoint adds no Prisma state, tenant setting, endpoint, queue,
notification, case creation, deadline clock, automated escalation, workday
update, payroll integration or disciplinary action. The existing safe intake
baseline remains unassigned until a future tenant-scoped C6 rollout persists
an accountable policy revision and maps it to the immutable case/decision
ledger.

The outstanding C6 lifecycle, transaction, queue, employee appeal UI and
browser/device work remains open. This contract must not be treated as a real
HR SLA or cohort rollout.

## Verification

    PASS  PATH=/home/codex-alt/.local/bin:$PATH npx vitest run \
          src/__tests__/lib-workforce-exception-policy-draft.test.ts \
          src/__tests__/lib-workforce-exception-intake.test.ts --reporter=dot
          (targeted source tests)

    PASS  targeted ESLint and `git diff --check` in this worktree.

    NOT RUN  Prisma migration/apply, full typecheck/build, browser E2E,
             Android, scheduler/concurrency/load, legal review and physical
             pilot checks. The draft has no live tenant effect and heavy gates
             belong to CI or an approved external worker.
