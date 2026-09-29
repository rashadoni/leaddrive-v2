import { describe, expect, it } from "vitest"
import {
  isWorkforceExceptionDecisionEnabledForResponseRollout,
  resolveWorkforceExceptionResponseRecording,
  WORKFORCE_EXCEPTION_RESPONSE_FLAG,
} from "@/lib/workforce/exception-response-rollout"

describe("Workforce employee exception response rollout", () => {
  it("fails closed for absent, malformed, and unrelated organization features", () => {
    for (const features of [undefined, null, {}, ["workforce"], "workforce"]) {
      expect(resolveWorkforceExceptionResponseRecording(features)).toBe("MIGRATION_REQUIRED")
    }
  })

  it("requires the explicit post-migration tenant feature flag", () => {
    expect(resolveWorkforceExceptionResponseRecording([WORKFORCE_EXCEPTION_RESPONSE_FLAG])).toBe("AVAILABLE")
  })

  it("fails closed only for the manager decision that requires the response channel", () => {
    for (const features of [undefined, null, {}, ["workforce-hrm"], "workforce-hrm"]) {
      expect(isWorkforceExceptionDecisionEnabledForResponseRollout(
        "REQUEST_EMPLOYEE_RESPONSE",
        features,
      )).toBe(false)
      expect(isWorkforceExceptionDecisionEnabledForResponseRollout("ACKNOWLEDGE", features)).toBe(true)
      expect(isWorkforceExceptionDecisionEnabledForResponseRollout("REQUEST_TIME_CORRECTION", features)).toBe(true)
      expect(isWorkforceExceptionDecisionEnabledForResponseRollout("FUTURE_DECISION", features)).toBe(true)
    }

    expect(isWorkforceExceptionDecisionEnabledForResponseRollout(
      "REQUEST_EMPLOYEE_RESPONSE",
      [WORKFORCE_EXCEPTION_RESPONSE_FLAG],
    )).toBe(true)
  })
})
