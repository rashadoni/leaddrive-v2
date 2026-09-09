import { describe, expect, it } from "vitest"
import { canReserveMediaBudget } from "@/lib/social/media-pipeline"

describe("media budget gate", () => {
  it("always permits free platform stages", () => {
    expect(canReserveMediaBudget({ amount: 0, dailyUsed: 99, monthlyUsed: 999, observationUsed: 9, dailyLimit: 0, monthlyLimit: 0, observationLimit: 0 })).toBe(true)
  })

  it("fails closed when any paid cap is zero", () => {
    expect(canReserveMediaBudget({ amount: 0.01, dailyUsed: 0, monthlyUsed: 0, observationUsed: 0, dailyLimit: 0, monthlyLimit: 10, observationLimit: 1 })).toBe(false)
  })

  it("checks daily, monthly and per-observation caps together", () => {
    const base = { amount: 0.01, dailyUsed: 0.02, monthlyUsed: 1, observationUsed: 0.02, dailyLimit: 1, monthlyLimit: 10, observationLimit: 0.1 }
    expect(canReserveMediaBudget(base)).toBe(true)
    expect(canReserveMediaBudget({ ...base, observationUsed: 0.095 })).toBe(false)
    expect(canReserveMediaBudget({ ...base, monthlyUsed: 9.995 })).toBe(false)
  })
})
