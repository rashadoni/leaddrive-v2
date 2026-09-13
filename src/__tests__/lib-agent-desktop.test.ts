import { describe, expect, it } from "vitest"
import {
  agentDesktopPeriod,
  calculateAgentDesktopMetrics,
  compareAgentQueueRows,
} from "@/lib/ticketing/agent-desktop"

const date = (value: string) => new Date(value)

describe("agent desktop metric contract", () => {
  it("uses one cohort and reports nullable metrics with honest sample sizes", () => {
    const now = date("2026-09-04T12:00:00Z")
    const metrics = calculateAgentDesktopMetrics([
      {
        createdAt: date("2026-09-01T08:00:00Z"),
        firstResponseAt: date("2026-09-01T09:00:00Z"),
        resolvedAt: date("2026-09-01T12:00:00Z"),
        slaFirstResponseDueAt: date("2026-09-01T10:00:00Z"),
        slaDueAt: date("2026-09-01T14:00:00Z"),
        satisfactionRating: 5,
      },
      {
        createdAt: date("2026-09-02T08:00:00Z"),
        firstResponseAt: date("2026-09-02T12:00:00Z"),
        resolvedAt: null,
        slaFirstResponseDueAt: date("2026-09-02T10:00:00Z"),
        slaDueAt: date("2026-09-03T08:00:00Z"),
        satisfactionRating: null,
      },
    ], now)

    expect(metrics).toEqual({
      averageFirstResponseSeconds: 9_000,
      firstResponseSample: 2,
      averageResolutionSeconds: 14_400,
      resolutionSample: 1,
      resolutionRatePct: 50,
      resolutionRateSample: 2,
      slaCompliancePct: 50,
      slaObligationSample: 4,
      csatAverage: 5,
      csatSample: 1,
    })
  })

  it("does not turn missing observations into zero performance", () => {
    expect(calculateAgentDesktopMetrics([], new Date())).toEqual({
      averageFirstResponseSeconds: null,
      firstResponseSample: 0,
      averageResolutionSeconds: null,
      resolutionSample: 0,
      resolutionRatePct: null,
      resolutionRateSample: 0,
      slaCompliancePct: null,
      slaObligationSample: 0,
      csatAverage: null,
      csatSample: 0,
    })
  })

  it("ignores impossible negative durations and invalid ratings", () => {
    const metrics = calculateAgentDesktopMetrics([{
      createdAt: date("2026-09-04T10:00:00Z"),
      firstResponseAt: date("2026-09-04T09:00:00Z"),
      resolvedAt: date("2026-09-04T09:30:00Z"),
      slaFirstResponseDueAt: null,
      slaDueAt: null,
      satisfactionRating: 9,
    }], date("2026-09-04T12:00:00Z"))

    expect(metrics.averageFirstResponseSeconds).toBeNull()
    expect(metrics.averageResolutionSeconds).toBeNull()
    expect(metrics.resolutionRatePct).toBe(0)
    expect(metrics.csatAverage).toBeNull()
  })

  it("sorts the next work item by actionable SLA, then priority and age", () => {
    const noDueHigh = {
      priority: "high",
      createdAt: date("2026-09-01T08:00:00Z"),
      slaFirstResponseDueAt: null,
      slaDueAt: null,
      firstResponseAt: null,
    }
    const dueLaterCritical = {
      ...noDueHigh,
      priority: "critical",
      slaDueAt: date("2026-09-04T15:00:00Z"),
    }
    const dueSoonLow = {
      ...noDueHigh,
      priority: "low",
      slaFirstResponseDueAt: date("2026-09-04T13:00:00Z"),
    }

    expect([noDueHigh, dueLaterCritical, dueSoonLow].sort(compareAgentQueueRows)).toEqual([
      dueSoonLow,
      dueLaterCritical,
      noDueHigh,
    ])
  })

  it("keeps urgent work between critical and high when no SLA date exists", () => {
    const row = (priority: string) => ({
      priority,
      createdAt: date("2026-09-01T08:00:00Z"),
      slaFirstResponseDueAt: null,
      slaDueAt: null,
      firstResponseAt: null,
    })

    expect([row("low"), row("high"), row("urgent"), row("critical")]
      .sort(compareAgentQueueRows)
      .map((item) => item.priority))
      .toEqual(["critical", "urgent", "high", "low"])
  })

  it("creates an exact rolling 30-day period", () => {
    const now = date("2026-09-04T12:00:00Z")
    expect(agentDesktopPeriod(now)).toEqual({
      from: date("2026-08-05T12:00:00Z"),
      to: now,
    })
  })
})
