import { describe, expect, it } from "vitest"

import {
  hasActivePriorityConflict,
  splitSlaDuration,
  summarizeSlaPolicyCoverage,
  validateSlaTargets,
} from "@/lib/ticketing/sla-policy"

describe("SLA policy rules", () => {
  it("requires one-minute targets and resolution no earlier than response", () => {
    expect(validateSlaTargets(0, 1)).toBe("minimum")
    expect(validateSlaTargets(Number.NaN, 1)).toBe("minimum")
    expect(validateSlaTargets(2, 1)).toBe("resolution_before_response")
    expect(validateSlaTargets(1 / 60, 1 / 60)).toBeNull()
  })

  it("rounds decimal hours into stable display units", () => {
    expect(splitSlaDuration(1.5)).toEqual({ hours: 1, minutes: 30 })
    expect(splitSlaDuration(1 / 60)).toEqual({ hours: 0, minutes: 1 })
    expect(splitSlaDuration(-2)).toEqual({ hours: 0, minutes: 0 })
  })

  it("reports exact active coverage, gaps and legacy conflicts", () => {
    const summary = summarizeSlaPolicyCoverage([
      { id: "critical", priority: "critical", isActive: true },
      { id: "high-a", priority: "high", isActive: true },
      { id: "high-b", priority: "high", isActive: true },
      { id: "medium", priority: "medium", isActive: false },
    ])

    expect(summary.active).toBe(3)
    expect(summary.covered).toEqual(["critical"])
    expect(summary.missing).toEqual(["medium", "low"])
    expect(summary.conflicts).toEqual(["high"])
  })

  it("detects active duplicate priority while excluding the edited record", () => {
    const policies = [
      { id: "one", priority: "high", isActive: true },
      { id: "two", priority: "low", isActive: false },
    ]
    expect(hasActivePriorityConflict(policies, "high")).toBe(true)
    expect(hasActivePriorityConflict(policies, "high", "one")).toBe(false)
    expect(hasActivePriorityConflict(policies, "low")).toBe(false)
  })
})
