import { describe, expect, it } from "vitest"
import {
  parseMobileHrmRequestCancel,
  parseMobileHrmRequestCreate,
} from "@/lib/mtm/mobile-hrm"

describe("mobile HRM request contract", () => {
  const now = new Date("2026-07-16T10:00:00.000Z")

  it("parses leave dates as date-only tenant calendar values", () => {
    const parsed = parseMobileHrmRequestCreate({
      id: "request-1",
      clientRequestId: "request-client-1",
      type: "LEAVE",
      startDate: "2026-07-20",
      endDate: "2026-07-24",
      reason: "Annual leave",
      submittedAt: now.toISOString(),
    }, now)
    expect(parsed.error).toBeNull()
    expect(parsed.input).toMatchObject({
      type: "LEAVE",
      startDateKey: "2026-07-20",
      endDateKey: "2026-07-24",
    })
  })

  it("requires a real workday and at least one corrected time", () => {
    const base = {
      id: "request-1",
      clientRequestId: "request-client-1",
      type: "TIME_CORRECTION",
      startDate: "2026-07-15",
      endDate: "2026-07-15",
      reason: "Forgot to finish shift",
      submittedAt: now.toISOString(),
    }
    expect(parseMobileHrmRequestCreate(base, now).error).toMatch(/correctionWorkdayId/)
    expect(parseMobileHrmRequestCreate({ ...base, correctionWorkdayId: "workday-1" }, now).error).toMatch(/start or end/)
    expect(parseMobileHrmRequestCreate({
      ...base,
      correctionWorkdayId: "workday-1",
      exceptionCaseId: "case-1",
      requestedEndAt: "2026-07-15T15:00:00.000Z",
    }, now).input).toMatchObject({ exceptionCaseId: "case-1" })
  })

  it("rejects an exception link outside one exact time correction", () => {
    const base = {
      id: "request-1",
      clientRequestId: "request-client-1",
      type: "LEAVE",
      startDate: "2026-07-20",
      endDate: "2026-07-20",
      reason: "Annual leave",
      submittedAt: now.toISOString(),
    }
    expect(parseMobileHrmRequestCreate({ ...base, exceptionCaseId: "case-1" }, now).error).toMatch(/only for time correction/)
    expect(parseMobileHrmRequestCreate({
      ...base,
      type: "TIME_CORRECTION",
      correctionWorkdayId: "workday-1",
      requestedEndAt: "2026-07-20T15:00:00.000Z",
      exceptionCaseId: "*",
    }, now).error).toMatch(/exceptionCaseId/)
  })

  it("rejects invalid ranges and accepts an offline cancellation", () => {
    const tooLong = parseMobileHrmRequestCreate({
      id: "request-1",
      clientRequestId: "request-client-1",
      type: "ABSENCE",
      startDate: "2026-01-01",
      endDate: "2027-01-03",
      reason: "Medical absence",
      submittedAt: now.toISOString(),
    }, now)
    expect(tooLong.error).toMatch(/366/)
    expect(parseMobileHrmRequestCancel({ id: "request-1", cancelledAt: now.toISOString() }, now).error).toBeNull()
  })
})
