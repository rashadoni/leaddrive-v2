import { describe, expect, it } from "vitest"
import {
  WORKFORCE_DEFAULT_PROFILE_VERSION,
  workforceDefaultPolicyDefinition,
  workforceDefaultShiftDefinition,
} from "@/lib/workforce/default-profile"

describe("Workforce default profile", () => {
  it("records the approved Baku Monday-to-Friday workday", () => {
    expect(WORKFORCE_DEFAULT_PROFILE_VERSION).toBe("baku-standard-v1")
    expect(workforceDefaultPolicyDefinition()).toEqual({
      expectedWorkSeconds: 28_800,
      lateGraceSeconds: 900,
      undertimeToleranceSeconds: 0,
      overtimeThresholdSeconds: 0,
      longPauseThresholdSeconds: 3_600,
    })
    expect(workforceDefaultShiftDefinition()).toEqual({
      startTime: "09:00",
      endTime: "18:00",
      timezone: "Asia/Baku",
      daysOfWeek: [1, 2, 3, 4, 5],
      plannedBreaks: [{ startTime: "13:00", endTime: "14:00" }],
    })
  })

  it("returns independent mutable copies for a tenant-admin draft", () => {
    const first = workforceDefaultShiftDefinition()
    first.daysOfWeek.push(6)
    first.plannedBreaks[0].startTime = "12:00"

    expect(workforceDefaultShiftDefinition()).toEqual(expect.objectContaining({
      daysOfWeek: [1, 2, 3, 4, 5],
      plannedBreaks: [{ startTime: "13:00", endTime: "14:00" }],
    }))
  })
})
