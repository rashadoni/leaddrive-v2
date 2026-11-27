import { describe, expect, it } from "vitest"
import { canTransition } from "@/lib/contract-lifecycle/state-machine"
import { OPEN_RENEWAL_STATUSES, daysUntilEnd, isRenewable, renewalDefaults, renewalNumberBase } from "@/lib/clm/contract-renewal"

/** «Продление» (src/lib/clm/contract-renewal.ts), the pure part. */
describe("what is renewed", () => {
  it("a contract in force or ended, nothing that never took effect or was closed", () => {
    for (const status of ["active", "renewing", "expired"]) expect(isRenewable(status)).toBe(true)
    for (const status of ["draft", "pending_approval", "approved", "rejected", "cancelled", "terminated", "renewed"]) {
      expect(isRenewable(status)).toBe(false)
    }
  })
  it("a renewal still counts while it may take effect — a rejected one may come back; a cancelled one may not", () => {
    expect([...OPEN_RENEWAL_STATUSES].sort()).toEqual(["approved", "draft", "pending_approval", "rejected"])
  })
  it("«Продлевается» may end as «Продлён», or go back to «Активный»", () => {
    for (const [from, to] of [["active", "renewing"], ["renewing", "renewed"], ["renewing", "active"]] as const) {
      expect(canTransition({ from, to })).toEqual({ ok: true })
    }
    expect(canTransition({ from: "renewed", to: "active" }).ok).toBe(false)
  })
})

describe("the new contract's dates", () => {
  const now = new Date("2026-11-27T10:00:00Z")
  it("start the day after the old one ends and last as long — in whole months when it was whole months", () => {
    expect(renewalDefaults({ startDate: "2026-01-01T00:00:00Z", endDate: "2026-12-31T00:00:00Z" }, now))
      .toEqual({ startDate: "2027-01-01", endDate: "2027-12-31" })
    expect(renewalDefaults({ startDate: "2026-06-01T00:00:00Z", endDate: "2026-08-31T00:00:00Z" }, now))
      .toEqual({ startDate: "2026-09-01", endDate: "2026-11-30" })
    // a year across 29 February stays a year
    expect(renewalDefaults({ startDate: "2027-03-01T00:00:00Z", endDate: "2028-02-29T00:00:00Z" }, now))
      .toEqual({ startDate: "2028-03-01", endDate: "2029-02-28" })
    // a period of odd days stays as many days
    expect(renewalDefaults({ startDate: "2026-01-10T00:00:00Z", endDate: "2026-02-18T00:00:00Z" }, now))
      .toEqual({ startDate: "2026-02-19", endDate: "2026-03-30" })
  })
  it("without a start date — a year from the day after the end", () => {
    expect(renewalDefaults({ startDate: null, endDate: "2026-12-31T00:00:00Z" }, now)).toEqual({ startDate: "2027-01-01", endDate: "2027-12-31" })
  })
  it("without dates at all — a year from today", () => {
    expect(renewalDefaults({ startDate: null, endDate: null }, now)).toEqual({ startDate: "2026-11-27", endDate: "2027-11-26" })
  })
})

describe("the number and the days left", () => {
  it("the number is «<old>/<year it starts>»", () => {
    expect(renewalNumberBase("DG-7", "2027-01-01")).toBe("DG-7/2027")
  })
  it("the last day counts: a contract ending today has 0 days, tomorrow 1, none without an end", () => {
    const now = new Date("2026-11-27T22:30:00Z")
    expect(daysUntilEnd("2026-11-27T00:00:00Z", now)).toBe(0)
    expect(daysUntilEnd("2026-11-28T00:00:00Z", now)).toBe(1)
    expect(daysUntilEnd("2027-01-06T00:00:00Z", now)).toBe(40)
    expect(daysUntilEnd(null, now)).toBeNull()
  })
})
