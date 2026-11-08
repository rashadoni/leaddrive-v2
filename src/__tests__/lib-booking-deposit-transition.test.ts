import { describe, it, expect } from "vitest"
import { depositRefundOwed, depositTransition } from "@/lib/booking/deposit"

/**
 * The button a manager presses is a statement about money that has already
 * moved — or not moved — outside the CRM. So the only thing worth testing
 * here is what it REFUSES: every press that would rewrite the record of a
 * payment rather than record one.
 */
describe("marking a deposit by hand", () => {
  it("records money the salon was waiting for", () => {
    expect(depositTransition("awaiting", "paid")).toBe("paid")
  })

  it("records a refund the salon owed", () => {
    expect(depositTransition("refund_due", "refunded")).toBe("refunded")
  })

  it("refuses a second press of the same button", () => {
    // The manager clicks twice on a slow connection; the second press must
    // not re-stamp a payment date or append a second «paid» to the history.
    expect(depositTransition("paid", "paid")).toBeNull()
    expect(depositTransition("refunded", "refunded")).toBeNull()
  })

  it("refuses to mark money received on a visit that asked for none", () => {
    expect(depositTransition(null, "paid")).toBeNull()
    expect(depositTransition(undefined, "paid")).toBeNull()
    expect(depositTransition("", "paid")).toBeNull()
  })

  it("refuses to return a deposit the late cancellation left with the salon", () => {
    // «Kept» is the whole reason the deposit existed. Turning it into a refund
    // from the card would hand the money back on a mis-click.
    expect(depositTransition("kept", "refunded")).toBeNull()
  })

  it("refuses to return money that was never paid", () => {
    expect(depositTransition("awaiting", "refunded")).toBeNull()
  })

  it("refuses to collect a deposit that is already on its way back", () => {
    expect(depositTransition("refund_due", "paid")).toBeNull()
  })

  it("names the visits the salon still owes money on", () => {
    expect(depositRefundOwed({ depositStatus: "refund_due" })).toBe(true)
    expect(depositRefundOwed({ depositStatus: "refunded" })).toBe(false)
    expect(depositRefundOwed({ depositStatus: "kept" })).toBe(false)
    expect(depositRefundOwed({})).toBe(false)
  })
})
