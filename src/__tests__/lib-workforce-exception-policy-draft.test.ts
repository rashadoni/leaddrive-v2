import { describe, expect, it } from "vitest"
import {
  evaluateWorkforceExceptionDraftLifecycle,
  WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1,
} from "@/lib/workforce/exception-policy-draft"

describe("recommended Workforce exception-policy draft", () => {
  it("is explicit that it has no tenant effect or automated HR outcome", () => {
    expect(WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1).toMatchObject({
      activation: "DRAFT_ONLY_NO_TENANT_EFFECT",
      assignment: { primaryRole: "HR_ADMIN", escalationRole: "TENANT_ADMIN" },
      employeeVisibility: "REQUIRED_BEFORE_FINAL_HR_DECISION",
      automatedOutcomes: "FORBIDDEN",
      excludedOutcomes: ["PAYROLL", "DISCIPLINARY", "BIOMETRIC_IDENTITY_DECISION"],
    })
    expect(WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1.classifications).toHaveLength(7)
  })

  it("allows a human-visible review lifecycle without an automatic resolution", () => {
    expect(evaluateWorkforceExceptionDraftLifecycle([
      { decisionCode: "ACKNOWLEDGE" },
      { decisionCode: "REQUEST_EMPLOYEE_RESPONSE" },
      { decisionCode: "ACKNOWLEDGE" },
      { decisionCode: "RESOLVE_NO_CHANGE" },
    ])).toEqual({ valid: true, stage: "RESOLVED" })
  })

  it("requires HR review before resolution and permits an explicit re-open", () => {
    expect(evaluateWorkforceExceptionDraftLifecycle([{ decisionCode: "RESOLVE_WITH_CORRECTION" }]))
      .toEqual({
        valid: false,
        code: "WORKFORCE_EXCEPTION_DRAFT_TRANSITION_INVALID",
        stage: "OPEN",
      })
    expect(evaluateWorkforceExceptionDraftLifecycle([
      { decisionCode: "ACKNOWLEDGE" },
      { decisionCode: "RESOLVE_WITH_CORRECTION" },
      { decisionCode: "REOPEN_FOR_REVIEW" },
    ])).toEqual({ valid: true, stage: "HR_REVIEW" })
  })

  it("fails closed for an unrecognized decision code", () => {
    expect(evaluateWorkforceExceptionDraftLifecycle([{ decisionCode: "AUTO_PAYROLL" }]))
      .toEqual({
        valid: false,
        code: "WORKFORCE_EXCEPTION_DRAFT_DECISION_UNKNOWN",
        stage: "OPEN",
      })
  })
})
