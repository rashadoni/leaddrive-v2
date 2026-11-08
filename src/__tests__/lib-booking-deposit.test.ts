import { describe, it, expect } from "vitest"
import { asksDeposit, depositAfterCancel, depositDue, depositOutstanding, depositPolicy } from "@/lib/booking/deposit"

/**
 * The deposit decides who keeps money, so every answer here is about a real
 * disagreement between a salon and a customer: what was owed, and what happens
 * when the visit is cancelled. Nothing in this module moves money — it says
 * what is owed, and a person pays it back.
 */
describe("what the service asks for", () => {
  it("asks nothing where nothing is set", () => {
    const policy = depositPolicy({})
    expect(asksDeposit(policy)).toBe(false)
    expect(depositDue(policy, "40")).toBeNull()
    expect(policy.freeHours).toBe(24)
  })

  it("takes a fixed sum as it was typed", () => {
    expect(depositDue(depositPolicy({ depositAmount: "10" }), "40")).toBe("10")
    expect(depositDue(depositPolicy({ depositAmount: 10.5 }), null)).toBe("10.5")
  })

  it("takes a share of what the visit actually costs", () => {
    expect(depositDue(depositPolicy({ depositPercent: 25 }), "40")).toBe("10")
    expect(depositDue(depositPolicy({ depositPercent: 30 }), "55")).toBe("16.5")
  })

  it("asks for no share of a service that has no price", () => {
    // A salon that has not priced the service cannot take a percentage of it.
    expect(depositDue(depositPolicy({ depositPercent: 25 }), null)).toBeNull()
    expect(depositDue(depositPolicy({ depositPercent: 25 }), "0")).toBeNull()
  })

  it("answers one question once when a row holds both", () => {
    const policy = depositPolicy({ depositAmount: "10", depositPercent: 50 })
    expect(policy.percent).toBeNull()
    expect(depositDue(policy, "40")).toBe("10")
  })

  it("refuses values nobody could have meant", () => {
    expect(depositPolicy({ depositAmount: "-5" }).amount).toBeNull()
    expect(depositPolicy({ depositAmount: "0" }).amount).toBeNull()
    expect(depositPolicy({ depositPercent: 0 }).percent).toBeNull()
    expect(depositPolicy({ depositPercent: 140 }).percent).toBeNull()
    expect(depositPolicy({ depositFreeHours: -3 }).freeHours).toBe(24)
  })
})

describe("a cancelled visit", () => {
  const now = new Date("2026-11-09T09:00:00.000Z")
  const inTime = { depositStatus: "paid", startsAt: new Date("2026-11-11T09:00:00.000Z") }
  const late = { depositStatus: "paid", startsAt: new Date("2026-11-09T15:00:00.000Z") }

  it("owes the money back when the customer cancelled in time", () => {
    expect(depositAfterCancel(inTime, 24, now)).toBe("refund_due")
  })

  it("keeps it when they cancelled late", () => {
    expect(depositAfterCancel(late, 24, now)).toBe("kept")
  })

  it("counts the window to the hour, not to the day", () => {
    const exactly = { depositStatus: "paid", startsAt: new Date("2026-11-10T09:00:00.000Z") }
    expect(depositAfterCancel(exactly, 24, now)).toBe("refund_due")
    expect(depositAfterCancel(exactly, 25, now)).toBe("kept")
  })

  it("owes nothing back where nothing was paid", () => {
    // The salon must not be left chasing a refund for money it never saw.
    expect(depositAfterCancel({ depositStatus: "awaiting", startsAt: inTime.startsAt }, 24, now)).toBe("kept")
    expect(depositAfterCancel({ depositStatus: null, startsAt: inTime.startsAt }, 24, now)).toBeNull()
  })

  it("names the visits the salon is still waiting for", () => {
    expect(depositOutstanding({ depositStatus: "awaiting" })).toBe(true)
    expect(depositOutstanding({ depositStatus: "paid" })).toBe(false)
    expect(depositOutstanding({})).toBe(false)
  })
})
