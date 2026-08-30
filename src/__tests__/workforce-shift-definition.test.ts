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

  it.each([
    {
      label: "Baku standard shift without DST",
      workDate: "2026-08-31",
      definition: DEFINITION,
      start: "2026-08-31T05:00:00.000Z",
      end: "2026-08-31T14:00:00.000Z",
    },
    {
      label: "Berlin after the spring-forward gap",
      workDate: "2026-03-29",
      definition: { startTime: "09:00", endTime: "18:00", timezone: "Europe/Berlin", daysOfWeek: [7] },
      start: "2026-03-29T07:00:00.000Z",
      end: "2026-03-29T16:00:00.000Z",
    },
    {
      label: "Berlin after the autumn fold",
      workDate: "2026-10-25",
      definition: { startTime: "09:00", endTime: "18:00", timezone: "Europe/Berlin", daysOfWeek: [7] },
      start: "2026-10-25T08:00:00.000Z",
      end: "2026-10-25T17:00:00.000Z",
    },
    {
      label: "leap-day assignment",
      workDate: "2028-02-29",
      definition: { ...DEFINITION, daysOfWeek: [2] },
      start: "2028-02-29T05:00:00.000Z",
      end: "2028-02-29T14:00:00.000Z",
    },
    {
      label: "Auckland organization date spanning the previous UTC day",
      workDate: "2026-01-05",
      definition: { startTime: "09:00", endTime: "18:00", timezone: "Pacific/Auckland", daysOfWeek: [1] },
      start: "2026-01-04T20:00:00.000Z",
      end: "2026-01-05T05:00:00.000Z",
    },
    {
      label: "Los Angeles organization date ending on the next UTC day",
      workDate: "2026-01-05",
      definition: { startTime: "09:00", endTime: "18:00", timezone: "America/Los_Angeles", daysOfWeek: [1] },
      start: "2026-01-05T17:00:00.000Z",
      end: "2026-01-06T02:00:00.000Z",
    },
  ])("resolves $label against the organization work date", ({ workDate, definition, start, end }) => {
    expect(resolveWorkforceShiftDay({ workDate, definition })).toMatchObject({
      workDate,
      timezone: definition.timezone,
      plannedStartAt: start,
      plannedEndAt: end,
    })
  })

  it("refuses DST-gap and DST-fold shift endpoints until an explicit policy exists", () => {
    expect(() => resolveWorkforceShiftDay({
      workDate: "2026-03-29",
      definition: { startTime: "02:30", endTime: "04:00", timezone: "Europe/Berlin", daysOfWeek: [7] },
    })).toThrow("shift non-existent local date-time")
    expect(() => resolveWorkforceShiftDay({
      workDate: "2026-10-25",
      definition: { startTime: "02:30", endTime: "04:00", timezone: "Europe/Berlin", daysOfWeek: [7] },
    })).toThrow("shift ambiguous local date-time")
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
