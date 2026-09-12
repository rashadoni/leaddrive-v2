export type WorkforceAssessmentAudience = "EMPLOYEE" | "MANAGER"

export type WorkforceAssessmentExplanation = {
  status: "CONFIRMED" | "REVIEW" | "UNAVAILABLE"
  messageKey: string
  recoveryKey: "NONE" | "RETRY_CURRENT_ACTION" | "REQUEST_REVIEW" | "USE_APPROVED_FALLBACK"
}

/**
 * Maps stable assessment codes to locale keys without exposing coordinates,
 * QR/security tokens, device fingerprints or anti-fraud thresholds. Actual
 * AZ/RU/EN text is a presentation responsibility; callers must never display
 * an unknown internal code verbatim to an employee.
 */
export function explainWorkforceAssessment(input: {
  audience: WorkforceAssessmentAudience
  verdict: string
  reasonCode: string
}): WorkforceAssessmentExplanation {
  if (input.verdict === "INSIDE" && input.reasonCode === "INSIDE_WITH_ACCURACY") {
    return { status: "CONFIRMED", messageKey: "workforce.assessment.siteConfirmed", recoveryKey: "NONE" }
  }
  if (input.reasonCode === "LOCATION_PERMISSION_DENIED" || input.reasonCode === "LOCATION_PROVIDER_DISABLED") {
    return {
      status: "UNAVAILABLE",
      messageKey: "workforce.assessment.locationUnavailable",
      recoveryKey: "USE_APPROVED_FALLBACK",
    }
  }
  if (["LOCATION_STALE", "LOCATION_ACCURACY_EXCEEDED", "BOUNDARY_ACCURACY_OVERLAP"].includes(input.reasonCode)) {
    return {
      status: "REVIEW",
      messageKey: "workforce.assessment.locationNeedsReview",
      recoveryKey: "RETRY_CURRENT_ACTION",
    }
  }
  if (input.reasonCode === "GEOFENCE_SNAPSHOT_MISSING" || input.reasonCode === "LOCATION_EVIDENCE_REQUIRED") {
    return {
      status: "REVIEW",
      messageKey: "workforce.assessment.proofNeedsReview",
      recoveryKey: "REQUEST_REVIEW",
    }
  }
  return input.audience === "MANAGER"
    ? { status: "REVIEW", messageKey: "workforce.assessment.managerReviewRequired", recoveryKey: "REQUEST_REVIEW" }
    : { status: "REVIEW", messageKey: "workforce.assessment.reviewRequired", recoveryKey: "REQUEST_REVIEW" }
}
