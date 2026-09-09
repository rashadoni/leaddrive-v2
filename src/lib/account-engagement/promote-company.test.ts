import { describe, it, expect } from "vitest"
import {
  mapEmployeeCountToBand,
  slugifyIndustry,
  buildAccountFromCompany,
} from "./promote-company"

describe("mapEmployeeCountToBand", () => {
  it("maps headcount onto the right band at the boundaries", () => {
    expect(mapEmployeeCountToBand(5000)).toBe("strategic")
    expect(mapEmployeeCountToBand(1000)).toBe("strategic")
    expect(mapEmployeeCountToBand(999)).toBe("enterprise")
    expect(mapEmployeeCountToBand(250)).toBe("enterprise")
    expect(mapEmployeeCountToBand(249)).toBe("mid_market")
    expect(mapEmployeeCountToBand(50)).toBe("mid_market")
    expect(mapEmployeeCountToBand(49)).toBe("small")
    expect(mapEmployeeCountToBand(10)).toBe("small")
    expect(mapEmployeeCountToBand(9)).toBe("micro")
    expect(mapEmployeeCountToBand(1)).toBe("micro")
  })

  it("returns null for unknown / invalid counts", () => {
    expect(mapEmployeeCountToBand(0)).toBeNull()
    expect(mapEmployeeCountToBand(null)).toBeNull()
    expect(mapEmployeeCountToBand(undefined)).toBeNull()
    expect(mapEmployeeCountToBand(-5)).toBeNull()
    expect(mapEmployeeCountToBand(NaN)).toBeNull()
  })
})

describe("slugifyIndustry", () => {
  it("lowercases and collapses non-alphanumerics to single dashes", () => {
    expect(slugifyIndustry("Pharma")).toBe("pharma")
    expect(slugifyIndustry("Food & Beverage")).toBe("food-beverage")
    expect(slugifyIndustry("  Oil/Gas  ")).toBe("oil-gas")
    expect(slugifyIndustry("A.I. & ML")).toBe("a-i-ml")
  })

  it("returns null for empty / non-string", () => {
    expect(slugifyIndustry("")).toBeNull()
    expect(slugifyIndustry("   ")).toBeNull()
    expect(slugifyIndustry(null)).toBeNull()
    expect(slugifyIndustry(undefined)).toBeNull()
  })
})

describe("buildAccountFromCompany", () => {
  const TARGET = { targetIndustries: ["pharma"], disqualifiedIndustries: [] as string[] }

  it("auto-scores the ICP tier from firmographics (Phase 6) and grades on it", () => {
    const f = buildAccountFromCompany(
      { name: "Pharma Co", industry: "Pharma", employeeCount: 500, annualRevenue: 20_000_000 },
      TARGET,
    )
    // Phase 6: tier auto-derived → enterprise(band 3) + in-target(+2) + 20M(+1) = 6 → tier_1.
    // grade then: icp(tier_1=30) + band(20) + industry(25) + revenue(20) = 95 → A.
    expect(f.icpTier).toBe("tier_1")
    expect(f.grade).toBe("A")
    expect(f.industrySlug).toBe("pharma")
    expect(f.employeeBand).toBe("enterprise")
    expect(f.annualRevenueUsd).toBe(BigInt(20_000_000))
  })

  it("honours an explicit icpTier override (tier_1 → A)", () => {
    const f = buildAccountFromCompany(
      { name: "Strat Co", industry: "Pharma", employeeCount: 5000, annualRevenue: 100_000_000 },
      TARGET,
      { icpTier: "tier_1" },
    )
    // icp(30) + band(strategic=25) + industry(25) + revenue(20) = 100 → A
    expect(f.grade).toBe("A")
    expect(f.icpTier).toBe("tier_1")
    expect(f.employeeBand).toBe("strategic")
  })

  it("treats opts.icpTier 'unscored' as not-specified → still auto-derives (the promote-route calling pattern; regression for the prod bug)", () => {
    const f = buildAccountFromCompany(
      { name: "Pharma Co", industry: "Pharma", employeeCount: 500, annualRevenue: 20_000_000 },
      TARGET,
      { icpTier: "unscored" }, // exactly what the promote routes pass by default
    )
    expect(f.icpTier).toBe("tier_1") // auto-derived, NOT left "unscored"
    expect(f.grade).toBe("A")
  })

  it("disqualifies an account whose industry is on the disqualified list → F", () => {
    const f = buildAccountFromCompany(
      { name: "Tobacco Inc", industry: "Tobacco", employeeCount: 5000, annualRevenue: 999_000_000 },
      { targetIndustries: [], disqualifiedIndustries: ["tobacco"] },
    )
    expect(f.grade).toBe("F")
  })

  it("leaves an account with no known attributes unassigned", () => {
    const f = buildAccountFromCompany(
      { name: "Mystery LLC", industry: null, employeeCount: null, annualRevenue: null },
      { targetIndustries: [], disqualifiedIndustries: [] },
    )
    expect(f.grade).toBe("unassigned")
    expect(f.employeeBand).toBeNull()
    expect(f.industrySlug).toBeNull()
    expect(f.annualRevenueUsd).toBeNull()
  })

  it("ignores negative / non-finite revenue", () => {
    const f = buildAccountFromCompany(
      { name: "Neg Co", industry: "Pharma", employeeCount: 100, annualRevenue: -5 },
      TARGET,
    )
    expect(f.annualRevenueUsd).toBeNull()
  })
})
