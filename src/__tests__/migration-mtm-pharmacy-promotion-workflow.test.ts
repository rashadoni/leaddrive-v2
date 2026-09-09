import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const sql = readFileSync(resolve(
  "prisma/migrations/20260801170000_mtm_pharmacy_promotion_workflow/migration.sql",
), "utf8")

describe("SWM-09 pharmacy-promotion workflow migration", () => {
  it("starts every execution as a draft and validates the final two-level workflow at commit", () => {
    expect(sql).toContain("IF TG_OP = 'INSERT' AND new_status <> 'DRAFT' THEN")
    expect(sql).toContain('CREATE OR REPLACE FUNCTION "mtm_pharmacy_validate_execution_workflow_at_commit"()')
    expect(sql).toContain('CREATE CONSTRAINT TRIGGER "mtm_pharmacy_execution_workflow_atomic"')
    expect(sql).toContain("DEFERRABLE INITIALLY DEFERRED")
    expect(sql).toContain("WHEN 'IN_REVIEW' THEN")
    expect(sql).toContain("AND l1_count = 1 AND l1_decision = 'APPROVED'")
    expect(sql).toContain("AND l2_count = 1 AND l2_decision = 'APPROVED'")
    expect(sql).toContain("execution status, review states, and immutable decisions must commit atomically")
  })

  it("enforces ledger reversals in both directions at the transaction boundary", () => {
    expect(sql).toContain('CREATE CONSTRAINT TRIGGER "mtm_pharmacy_execution_approval_atomic"')
    expect(sql).toContain('CREATE CONSTRAINT TRIGGER "mtm_pharmacy_reward_claim_ledger_atomic"')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION "mtm_pharmacy_validate_reversal_subject_at_commit"()')
    expect(sql).toContain('CREATE CONSTRAINT TRIGGER "mtm_pharmacy_reversal_subject_atomic"')
    expect(sql).toContain("award reversal and REVERSED execution must commit atomically")
    expect(sql).toContain("reward debit reversal and CANCELLED claim must commit atomically")
  })

  it("keeps tenant isolation and append-only audit/financial facts database-enforced", () => {
    expect(sql.match(/FORCE ROW LEVEL SECURITY/g)?.length).toBeGreaterThanOrEqual(14)
    expect(sql).toContain('CREATE OR REPLACE FUNCTION "mtm_pharmacy_append_only_guard"()')
    expect(sql).toContain('CREATE TRIGGER "mtm_pharmacy_ledger_append_only"')
    expect(sql).toContain('CREATE TRIGGER "mtm_pharmacy_events_append_only"')
    expect(sql).toContain('CREATE TRIGGER "mtm_pharmacy_reviews_append_only"')
  })

  it("makes bulk-operation envelopes complete and terminal results immutable", () => {
    expect(sql).toContain("new bulk operation must start PENDING at version 1")
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON "mtm_pharmacy_promotion_operations"')
    expect(sql).toContain('"succeededCount" + "failedCount" = "selectedCount"')
    expect(sql).toContain('"status" = \'COMPLETED\' AND "succeededCount" = "selectedCount" AND "failedCount" = 0')
    expect(sql).toContain('"status" <> \'PENDING\' AND "completedAt" IS NOT NULL AND "resultPayload" IS NOT NULL')
    expect(sql).toContain("completed bulk operation result is immutable")
  })

  it("uses the same five-minute source clock tolerance as application freshness", () => {
    expect(sql).toContain('"sourceObservedAt" <= "sourceReceivedAt" + INTERVAL \'5 minutes\'')
    expect(sql).toContain('"capturedAt" <= "sourceObservedAt"')
  })

  it("normalizes the immutable event subject chain and bulk-review batch link", () => {
    for (const column of ["formulaId", "approvalPolicyId", "evidenceId", "reviewId"]) {
      expect(sql).toContain(`"${column}" TEXT`)
      expect(sql).toContain(`FOREIGN KEY ("organizationId", "${column}")`)
    }
    expect(sql).toContain('CONSTRAINT "mtm_pharmacy_event_actor_contract" CHECK')
    expect(sql).toContain("\"eventType\" = 'SYSTEM_BULK_OPERATION_RECOVERED'")
    expect(sql).toContain("AND COALESCE(current_setting('app.rls_bypass', true), '') = 'on'")
    expect(sql).toContain('CONSTRAINT "mtm_pharmacy_reviews_batch_fk"')
    expect(sql).toContain('FOREIGN KEY ("organizationId", "batchId") REFERENCES "mtm_pharmacy_promotion_operations"')
    expect(sql).toContain('"batchId" IS NOT DISTINCT FROM NEW."operationId"')
    expect(sql).toContain("event review subject chain is inconsistent")
    expect(sql).toContain("event target and planning operation hierarchy is inconsistent")
  })

  it("permits only a reasoned governed eligibility override and requires its immutable event", () => {
    expect(sql).toContain("('PENDING', 'ELIGIBLE', 'INELIGIBLE', 'OVERRIDDEN')")
    expect(sql).toContain("a target cannot start with an eligibility override")
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON "mtm_pharmacy_promotion_targets"')
    expect(sql).toContain("OLD.\"eligibilityStatus\" = 'INELIGIBLE' AND NEW.\"eligibilityStatus\" = 'OVERRIDDEN'")
    expect(sql).toContain('CONSTRAINT "mtm_pharmacy_target_eligibility_snapshot" CHECK')
    expect(sql).toContain("\"eligibilitySnapshot\" #>> '{override,reason}' = \"eligibilityOverrideReason\"")
    expect(sql).toContain("\"eventType\" = 'PROMOTION_TARGET_ELIGIBILITY_OVERRIDDEN'")
    expect(sql).toContain("\"payload\" ->> 'operationId' = NEW.\"eligibilitySnapshot\" #>> '{override,operationId}'")
    expect(sql).toContain("\"actorUserId\" = NEW.\"eligibilitySnapshot\" #>> '{override,actorUserId}'")
    expect(sql).toContain("\"payload\" ->> 'occurredAt' = NEW.\"eligibilitySnapshot\" #>> '{override,occurredAt}'")
    expect(sql).toContain('CREATE CONSTRAINT TRIGGER "mtm_pharmacy_target_override_audit_atomic"')
    expect(sql).toContain("DEFERRABLE INITIALLY DEFERRED")
    expect(sql).toContain("eligibility override and immutable audit event must commit atomically")
    expect(sql).toContain("eligibility_override_active BOOLEAN")
    expect(sql).toContain("NULLIF(BTRIM(target.\"eligibilityOverrideReason\"), '') IS NOT NULL")
    expect(sql).toContain("IF eligibility_override_active THEN")
    expect(sql).toContain("required_evidence := 0")
  })

  it("rejects deleted or incomplete controlled visits at submit and at deferred eligibility validation", () => {
    expect(sql).toContain('visit_row."deletedAt" IS NOT NULL')
    expect(sql).toContain('visit_row."status" <> \'CHECKED_OUT\' OR visit_row."checkOutAt" IS NULL')
    expect(sql).toContain('require_completed_visit BOOLEAN')
    expect(sql).toContain("(version.\"eligibilityDefinition\" ->> 'requireCompletedVisit')::boolean")
    expect(sql).toContain('visit."status" = \'CHECKED_OUT\'')
    expect(sql).toContain('visit."checkOutAt" IS NOT NULL')
    expect(sql).toContain('visit."deletedAt" IS NULL')
    expect(sql).toContain('submitted execution requires an active completed visit under signed eligibility')
  })
})
