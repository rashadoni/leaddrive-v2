/** Deterministic review hints. They are never an accusation or automatic outcome. */
export const WORKFORCE_ATTENDANCE_RISK_RULESET_VERSION = "workforce-attendance-risk-v1"

export type WorkforceAttendanceRiskSignal = {
  ruleVersion: typeof WORKFORCE_ATTENDANCE_RISK_RULESET_VERSION
  code: "IMPOSSIBLE_SITE_TRANSITION" | "CLOCK_FUTURE_SKEW" | "CAPTURE_AFTER_CLAIM"
  severity: "REVIEW"
  details: { observed: number; threshold: number; unit: "kmh" | "seconds" }
}

const MAX_SITE_TRANSITION_SPEED_KMH = 180
const MAX_FUTURE_CLOCK_SKEW_SECONDS = 5 * 60

function validDate(value: Date, name: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new RangeError(`${name} must be a valid timestamp`)
  return value
}

/**
 * Produces conservative, explainable hints from already-authorized derived
 * facts. It accepts no raw coordinate and never returns an accept/reject
 * decision. A review worker must consider travel mode, outage/clock context
 * and an employee recovery path before recording any case outcome.
 */
export function evaluateWorkforceAttendanceRiskSignals(input: {
  previous?: { departedAt: Date; distanceToCurrentSiteMeters: number }
  current: { claimedAt: Date; capturedAt: Date; serverReceivedAt: Date }
}): WorkforceAttendanceRiskSignal[] {
  const current = {
    claimedAt: validDate(input.current.claimedAt, "claimedAt"),
    capturedAt: validDate(input.current.capturedAt, "capturedAt"),
    serverReceivedAt: validDate(input.current.serverReceivedAt, "serverReceivedAt"),
  }
  const signals: WorkforceAttendanceRiskSignal[] = []
  const futureSkewSeconds = (current.claimedAt.getTime() - current.serverReceivedAt.getTime()) / 1_000
  if (futureSkewSeconds > MAX_FUTURE_CLOCK_SKEW_SECONDS) {
    signals.push({
      ruleVersion: WORKFORCE_ATTENDANCE_RISK_RULESET_VERSION,
      code: "CLOCK_FUTURE_SKEW",
      severity: "REVIEW",
      details: { observed: futureSkewSeconds, threshold: MAX_FUTURE_CLOCK_SKEW_SECONDS, unit: "seconds" },
    })
  }
  const captureAfterClaimSeconds = (current.capturedAt.getTime() - current.claimedAt.getTime()) / 1_000
  if (captureAfterClaimSeconds > MAX_FUTURE_CLOCK_SKEW_SECONDS) {
    signals.push({
      ruleVersion: WORKFORCE_ATTENDANCE_RISK_RULESET_VERSION,
      code: "CAPTURE_AFTER_CLAIM",
      severity: "REVIEW",
      details: { observed: captureAfterClaimSeconds, threshold: MAX_FUTURE_CLOCK_SKEW_SECONDS, unit: "seconds" },
    })
  }
  if (input.previous) {
    const departedAt = validDate(input.previous.departedAt, "departedAt")
    if (!Number.isFinite(input.previous.distanceToCurrentSiteMeters) || input.previous.distanceToCurrentSiteMeters < 0) {
      throw new RangeError("distanceToCurrentSiteMeters must be a non-negative finite number")
    }
    const elapsedSeconds = (current.claimedAt.getTime() - departedAt.getTime()) / 1_000
    if (elapsedSeconds > 0) {
      const speedKmh = (input.previous.distanceToCurrentSiteMeters / 1_000) / (elapsedSeconds / 3_600)
      if (speedKmh > MAX_SITE_TRANSITION_SPEED_KMH) {
        signals.push({
          ruleVersion: WORKFORCE_ATTENDANCE_RISK_RULESET_VERSION,
          code: "IMPOSSIBLE_SITE_TRANSITION",
          severity: "REVIEW",
          details: { observed: speedKmh, threshold: MAX_SITE_TRANSITION_SPEED_KMH, unit: "kmh" },
        })
      }
    }
  }
  return signals
}
