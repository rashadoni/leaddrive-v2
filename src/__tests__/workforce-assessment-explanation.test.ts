import { describe, expect, it } from "vitest"
import { explainWorkforceAssessment } from "@/lib/workforce/assessment-explanation"

describe("Workforce assessment explanation", () => {
  it("gives an employee a safe recovery for weak/unavailable location", () => {
    expect(explainWorkforceAssessment({ audience: "EMPLOYEE", verdict: "UNKNOWN", reasonCode: "BOUNDARY_ACCURACY_OVERLAP" }))
      .toEqual({ status: "REVIEW", messageKey: "workforce.assessment.locationNeedsReview", recoveryKey: "RETRY_CURRENT_ACTION" })
    expect(explainWorkforceAssessment({ audience: "EMPLOYEE", verdict: "UNKNOWN", reasonCode: "LOCATION_PERMISSION_DENIED" }))
      .toEqual({ status: "UNAVAILABLE", messageKey: "workforce.assessment.locationUnavailable", recoveryKey: "USE_APPROVED_FALLBACK" })
  })

  it("does not disclose unknown security details", () => {
    const explanation = explainWorkforceAssessment({ audience: "EMPLOYEE", verdict: "UNKNOWN", reasonCode: "INTERNAL_QR_NONCE_RELAY_SCORE_99" })
    expect(explanation).toEqual({ status: "REVIEW", messageKey: "workforce.assessment.reviewRequired", recoveryKey: "REQUEST_REVIEW" })
    expect(JSON.stringify(explanation)).not.toContain("NONCE")
    expect(JSON.stringify(explanation)).not.toContain("99")
  })
})
