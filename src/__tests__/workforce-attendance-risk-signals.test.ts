import { describe, expect, it } from "vitest"
import { evaluateWorkforceAttendanceRiskSignals } from "@/lib/workforce/attendance-risk-signals"

describe("Workforce attendance risk signals", () => {
  const current = {
    claimedAt: new Date("2026-08-30T09:00:00.000Z"),
    capturedAt: new Date("2026-08-30T09:00:10.000Z"),
    serverReceivedAt: new Date("2026-08-30T09:00:20.000Z"),
  }

  it("emits no signal for an ordinary transition", () => {
    expect(evaluateWorkforceAttendanceRiskSignals({
      current,
      previous: { departedAt: new Date("2026-08-30T08:00:00.000Z"), distanceToCurrentSiteMeters: 5_000 },
    })).toEqual([])
  })

  it("marks extreme transit speed and clock anomalies as review-only signals", () => {
    const signals = evaluateWorkforceAttendanceRiskSignals({
      current: {
        claimedAt: new Date("2026-08-30T09:10:00.000Z"),
        capturedAt: new Date("2026-08-30T09:16:00.000Z"),
        serverReceivedAt: new Date("2026-08-30T09:00:00.000Z"),
      },
      previous: { departedAt: new Date("2026-08-30T09:09:00.000Z"), distanceToCurrentSiteMeters: 10_000 },
    })
    expect(signals.map((signal) => signal.code)).toEqual([
      "CLOCK_FUTURE_SKEW",
      "CAPTURE_AFTER_CLAIM",
      "IMPOSSIBLE_SITE_TRANSITION",
    ])
    expect(signals.every((signal) => signal.severity === "REVIEW")).toBe(true)
  })

  it("rejects invalid derived inputs instead of inventing a risk result", () => {
    expect(() => evaluateWorkforceAttendanceRiskSignals({
      current,
      previous: { departedAt: new Date("2026-08-30T08:00:00.000Z"), distanceToCurrentSiteMeters: -1 },
    })).toThrow(/non-negative/i)
  })
})
