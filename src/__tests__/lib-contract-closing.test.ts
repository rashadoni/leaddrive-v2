import { describe, expect, it } from "vitest"
import {
  canWithdrawTermination,
  parseCalendarDay,
  planCancellation,
  planTermination,
} from "@/lib/clm/contract-closing"

/** The rules of ending a contract (src/lib/clm/contract-closing.ts). */
const now = new Date("2026-11-26T10:00:00Z")
const day = (iso: string) => new Date(`${iso}T00:00:00Z`)
const active = { status: "active", endDate: day("2027-12-31"), terminationDate: null }

describe("termination", () => {
  it("today or an earlier day ends the contract at once", () => {
    for (const date of ["2026-11-26", "2026-11-01"]) {
      expect(planTermination(active, { terminationDate: date, reason: "mutual_agreement", note: " " }, now)).toEqual({
        ok: true, date: day(date), day: date, reason: "mutual_agreement", note: null, immediate: true,
      })
    }
  })
  it("a later day keeps the contract in force until then", () => {
    expect(planTermination(active, { terminationDate: "2026-12-01", reason: "breach", note: " Ödəniş yoxdur " }, now))
      .toMatchObject({ ok: true, immediate: false, note: "Ödəniş yoxdur" })
  })
  it("only a contract in force, and only once", () => {
    for (const status of ["draft", "pending_approval", "approved", "expired", "terminated", "rejected", "cancelled"]) {
      expect(planTermination({ ...active, status }, { terminationDate: "2026-11-26", reason: "other", note: null }, now))
        .toEqual({ ok: false, code: "NOT_TERMINABLE" })
    }
    expect(planTermination({ ...active, status: "renewing" }, { terminationDate: "2026-11-26", reason: "other", note: null }, now).ok).toBe(true)
    expect(planTermination({ ...active, terminationDate: day("2026-12-01") }, { terminationDate: "2026-11-26", reason: "other", note: null }, now))
      .toEqual({ ok: false, code: "ALREADY_SCHEDULED" })
  })
  it("the day after the last valid day is the latest that makes sense", () => {
    expect(planTermination(active, { terminationDate: "2028-01-01", reason: "other", note: null }, now).ok).toBe(true)
    expect(planTermination(active, { terminationDate: "2028-01-02", reason: "other", note: null }, now)).toEqual({ ok: false, code: "AFTER_END_DATE" })
    expect(planTermination({ ...active, endDate: null }, { terminationDate: "2030-01-01", reason: "other", note: null }, now).ok).toBe(true)
  })
  it("a real day and a known reason are required; the comment is at most 1000 characters", () => {
    expect(planTermination(active, { terminationDate: "2026-02-30", reason: "other", note: null }, now)).toEqual({ ok: false, code: "TERMINATION_DATE_INVALID" })
    expect(planTermination(active, { terminationDate: "2026-11-26", reason: "because", note: null }, now)).toEqual({ ok: false, code: "REASON_REQUIRED" })
    expect(planTermination(active, { terminationDate: "2026-11-26", reason: "other", note: "x".repeat(1001) }, now)).toEqual({ ok: false, code: "NOTE_TOO_LONG" })
  })
  it("a termination still to come can be withdrawn until its day", () => {
    expect(canWithdrawTermination({ status: "active", terminationDate: day("2026-11-27") }, now)).toBe(true)
    expect(canWithdrawTermination({ status: "active", terminationDate: day("2026-11-26") }, now)).toBe(false)
    expect(canWithdrawTermination({ status: "terminated", terminationDate: day("2026-12-01") }, now)).toBe(false)
    expect(canWithdrawTermination({ status: "active", terminationDate: null }, now)).toBe(false)
  })
})

describe("cancellation", () => {
  it("a contract that never took effect, with a reason", () => {
    for (const status of ["draft", "pending_approval", "approved"]) {
      expect(planCancellation(status, "  Müştəri imtina etdi ")).toEqual({ ok: true, note: "Müştəri imtina etdi" })
    }
    for (const status of ["active", "renewing", "expired", "terminated", "rejected", "cancelled"]) {
      expect(planCancellation(status, "x")).toEqual({ ok: false, code: "NOT_CANCELLABLE" })
    }
    expect(planCancellation("draft", "  ")).toEqual({ ok: false, code: "REASON_REQUIRED" })
    expect(planCancellation("draft", undefined)).toEqual({ ok: false, code: "REASON_REQUIRED" })
  })
})

it("a calendar day is a real one", () => {
  expect(parseCalendarDay("2026-12-01")).toEqual({ ok: true, date: day("2026-12-01"), day: "2026-12-01" })
  for (const raw of ["", "01.12.2026", "2026-13-01", "1899-01-01", null]) expect(parseCalendarDay(raw)).toEqual({ ok: false })
})
