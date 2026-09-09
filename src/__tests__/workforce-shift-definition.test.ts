import { describe, expect, it } from "vitest"
import {
  parseWorkforceShiftDefinition,
  resolveWorkforceShiftDay,
  workforceShiftDefinitionHash,
  WorkforceShiftDefinitionError,
} from "@/lib/workforce/shift-definition"

const DEFINITION = {
  startTime: "09:00",
  endTime: "18:00",
  timezone: "Asia/Baku",
  daysOfWeek: [1, 2, 3, 4, 5],
}

describe("Workforce shift definition", () => {
  it("resolves a matching ISO weekday into canonical UTC instants", () => {
    expect(resolveWorkforceShiftDay({
      workDate: "2026-08-31",
      definition: DEFINITION,
      templateTimezone: "Asia/Baku",
    })).toEqual({
      workDate: "2026-08-31",
      timezone: "Asia/Baku",
      plannedStartAt: "2026-08-31T05:00:00.000Z",
      plannedEndAt: "2026-08-31T14:00:00.000Z",
    })
  })

  it("returns no shift on a non-selected weekday", () => {
    expect(resolveWorkforceShiftDay({
      workDate: "2026-08-30",
      definition: DEFINITION,
    })).toBeNull()
  })

  it("canonicalizes the signed definition independently of object key order", () => {
    expect(workforceShiftDefinitionHash(DEFINITION)).toBe(
      workforceShiftDefinitionHash({
        daysOfWeek: [1, 2, 3, 4, 5],
        timezone: "Asia/Baku",
        endTime: "18:00",
        startTime: "09:00",
      }),
    )
  })

  it("preserves the pre-break immutable hash for historical shift definitions", () => {
    expect(workforceShiftDefinitionHash(DEFINITION)).toBe(
      "9523b46f8c4dfce7fc191ba1ed007c5b33436bd49b2df088fa20db1b517f5e1c",
    )
  })

  it("keeps planned breaks as signed schedule metadata without changing the work window", () => {
    const definition = {
      ...DEFINITION,
      plannedBreaks: [{ startTime: "13:00", endTime: "14:00" }],
    }

    expect(parseWorkforceShiftDefinition(definition).plannedBreaks).toEqual([
      { startTime: "13:00", endTime: "14:00" },
    ])
    expect(resolveWorkforceShiftDay({
      workDate: "2026-08-31",
      definition,
    })).toEqual({
      workDate: "2026-08-31",
      timezone: "Asia/Baku",
      plannedStartAt: "2026-08-31T05:00:00.000Z",
      plannedEndAt: "2026-08-31T14:00:00.000Z",
    })
  })

  it("rejects overnight, duplicate-day, malformed and timezone-mismatched definitions", () => {
    expect(() => parseWorkforceShiftDefinition({
      ...DEFINITION,
      startTime: "22:00",
      endTime: "06:00",
    })).toThrow(WorkforceShiftDefinitionError)
    expect(() => parseWorkforceShiftDefinition({
      ...DEFINITION,
      daysOfWeek: [1, 1],
    })).toThrow(WorkforceShiftDefinitionError)
    expect(() => parseWorkforceShiftDefinition({
      ...DEFINITION,
      startTime: "9:00",
    })).toThrow(WorkforceShiftDefinitionError)
    expect(() => parseWorkforceShiftDefinition({
      ...DEFINITION,
      timezone: "not/a-timezone",
    })).toThrow(WorkforceShiftDefinitionError)
    expect(() => resolveWorkforceShiftDay({
      workDate: "2026-08-31",
      definition: DEFINITION,
      templateTimezone: "UTC",
    })).toThrow("template timezone must match")
    expect(() => parseWorkforceShiftDefinition({
      ...DEFINITION,
      plannedBreaks: [{ startTime: "13:00", endTime: "13:00" }],
    })).toThrow("planned break endTime")
    expect(() => parseWorkforceShiftDefinition({
      ...DEFINITION,
      plannedBreaks: [{ startTime: "08:30", endTime: "09:30" }],
    })).toThrow("strictly inside")
    expect(() => parseWorkforceShiftDefinition({
      ...DEFINITION,
      plannedBreaks: [
        { startTime: "13:00", endTime: "14:00" },
        { startTime: "13:30", endTime: "14:30" },
      ],
    })).toThrow("chronological and non-overlapping")
  })
})
