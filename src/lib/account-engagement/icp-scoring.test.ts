import { describe, it, expect } from "vitest"
import { scoreIcpTier } from "./icp-scoring"

const T = ["pharma", "fintech"]

describe("scoreIcpTier", () => {
  it("tier_1 for big, in-target, high-revenue accounts", () => {
    expect(
      scoreIcpTier({ employeeBand: "strategic", industrySlug: "pharma", annualRevenueUsd: 200_000_000, targetIndustries: T }).tier,
    ).toBe("tier_1") // 4 + 2 + 2 = 8
    expect(
      scoreIcpTier({ employeeBand: "enterprise", industrySlug: "pharma", annualRevenueUsd: 20_000_000, targetIndustries: T }).tier,
    ).toBe("tier_1") // 3 + 2 + 1 = 6
  })

  it("tier_2 for mid-market in-target, or enterprise with no target preference", () => {
    expect(
      scoreIcpTier({ employeeBand: "mid_market", industrySlug: "pharma", annualRevenueUsd: 5_000_000, targetIndustries: T }).tier,
    ).toBe("tier_2") // 2 + 2 + 0 = 4
    expect(
      scoreIcpTier({ employeeBand: "enterprise", industrySlug: "anything", annualRevenueUsd: null, targetIndustries: [] }).tier,
    ).toBe("tier_2") // 3 + 0(no list) + 0 = 3
  })

  it("tier_3 for enterprise off-target / small in-target", () => {
    expect(
      scoreIcpTier({ employeeBand: "enterprise", industrySlug: "retail", annualRevenueUsd: null, targetIndustries: T }).tier,
    ).toBe("tier_3") // 3 - 1 + 0 = 2
  })

  it("tier_4 for small/micro off-target", () => {
    expect(
      scoreIcpTier({ employeeBand: "small", industrySlug: "retail", annualRevenueUsd: null, targetIndustries: T }).tier,
    ).toBe("tier_4") // 1 - 1 + 0 = 0
    expect(
      scoreIcpTier({ employeeBand: "micro", industrySlug: "retail", annualRevenueUsd: null, targetIndustries: T }).tier,
    ).toBe("tier_4") // 0 - 1 + 0 = -1
  })

  it("unscored when there are no firmographics at all", () => {
    expect(
      scoreIcpTier({ employeeBand: null, industrySlug: null, annualRevenueUsd: null, targetIndustries: T }).tier,
    ).toBe("unscored")
  })
})
