/**
 * Tests for P3 Tax Engine slice 1 — local provider + resolver.
 * Pure functional, no Prisma, no network.
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import {
  resolveTax,
  LocalTaxProvider,
  LOCAL_VAT_RATES,
  _setProviderChainForTests,
  _resetProviderChainForTests,
  type TaxContext,
  type TaxProvider,
} from "@/lib/tax"

function ctx(overrides: Partial<TaxContext> = {}): TaxContext {
  return {
    sellerCountry: "AZ",
    buyerCountry: "AZ",
    amount: 1000,
    ...overrides,
  }
}

afterEach(() => {
  _resetProviderChainForTests()
})

describe("P3 tax — LocalTaxProvider domestic rates", () => {
  it("AZ → AZ at 18% (CIS primary market)", async () => {
    const r = await new LocalTaxProvider().resolve(ctx({ sellerCountry: "AZ", buyerCountry: "AZ" }))
    expect(r.rate).toBe(0.18)
    expect(r.amount).toBe(180)
    expect(r.jurisdiction).toBe("AZ VAT 18%")
    expect(r.isExempt).toBe(false)
    expect(r.breakdown).toHaveLength(1)
  })

  it("RU → RU at 20%", async () => {
    const r = await new LocalTaxProvider().resolve(ctx({ sellerCountry: "RU", buyerCountry: "RU" }))
    expect(r.rate).toBe(0.20)
    expect(r.amount).toBe(200)
  })

  it("KZ → KZ at 12%", async () => {
    const r = await new LocalTaxProvider().resolve(ctx({ sellerCountry: "KZ", buyerCountry: "KZ" }))
    expect(r.rate).toBe(0.12)
    expect(r.amount).toBe(120)
  })

  it("DE → DE at 19%", async () => {
    const r = await new LocalTaxProvider().resolve(ctx({ sellerCountry: "DE", buyerCountry: "DE" }))
    expect(r.rate).toBe(0.19)
    expect(r.amount).toBe(190)
  })

  it("PL → PL at 23%", async () => {
    const r = await new LocalTaxProvider().resolve(ctx({ sellerCountry: "PL", buyerCountry: "PL" }))
    expect(r.rate).toBe(0.23)
  })

  it("HU → HU at 27% (highest EU)", async () => {
    const r = await new LocalTaxProvider().resolve(ctx({ sellerCountry: "HU", buyerCountry: "HU" }))
    expect(r.rate).toBe(0.27)
    expect(r.amount).toBe(270)
  })

  it("Switzerland fractional rate 8.1% renders with 1 decimal", async () => {
    const r = await new LocalTaxProvider().resolve(ctx({ sellerCountry: "CH", buyerCountry: "CH" }))
    expect(r.rate).toBe(0.081)
    expect(r.jurisdiction).toBe("CH VAT 8.1%")
  })

  it("US declines with requiresExternalProvider sentinel (Avalara/Vertex needed)", async () => {
    const r = await new LocalTaxProvider().resolve(ctx({ sellerCountry: "US", buyerCountry: "US" }))
    expect(r.rate).toBe(0)
    expect(r.isExempt).toBe(true)
    expect(r.requiresExternalProvider).toBe(true)
    expect(r.jurisdiction).toContain("Avalara")
    expect(r.exemptionReason).toContain("external provider")
    expect(r.breakdown).toEqual([])
  })

  it("Unknown country returns 0 (logs warning, but does not throw)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const r = await new LocalTaxProvider().resolve(ctx({ sellerCountry: "ZZ", buyerCountry: "ZZ" }))
    expect(r.rate).toBe(0)
    expect(r.isExempt).toBe(true)
    expect(r.requiresExternalProvider).toBeUndefined() // unknown != US sentinel
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unknown jurisdiction ZZ"))
    warnSpy.mockRestore()
  })

  it("Finland 25.5% renders as fractional in label", async () => {
    const r = await new LocalTaxProvider().resolve(ctx({ sellerCountry: "FI", buyerCountry: "FI" }))
    expect(r.rate).toBe(0.255)
    expect(r.jurisdiction).toBe("FI VAT 25.5%")
  })

  it("Integer rates render without trailing .0", async () => {
    const r = await new LocalTaxProvider().resolve(ctx({ sellerCountry: "DE", buyerCountry: "DE" }))
    expect(r.jurisdiction).toBe("DE VAT 19%")
    expect(r.jurisdiction).not.toContain("19.0")
  })
})

describe("P3 tax — Intra-EU B2B reverse-charge", () => {
  it("DE seller + FR buyer, both with VAT IDs → 0%, reverse-charge exempt", async () => {
    const r = await new LocalTaxProvider().resolve(ctx({
      sellerCountry: "DE",
      buyerCountry: "FR",
      sellerTaxId: "DE123456789",
      buyerTaxId: "FR987654321",
    }))
    expect(r.rate).toBe(0)
    expect(r.amount).toBe(0)
    expect(r.isExempt).toBe(true)
    expect(r.jurisdiction).toContain("reverse-charge")
    expect(r.exemptionReason).toContain("Intra-EU")
    expect(r.breakdown).toEqual([])
    // Lock semantic distinction: reverse-charge is NOT the US sentinel
    expect(r.requiresExternalProvider).toBeUndefined()
  })

  it("Same-country EU does NOT trigger reverse-charge (domestic VAT applies)", async () => {
    const r = await new LocalTaxProvider().resolve(ctx({
      sellerCountry: "DE",
      buyerCountry: "DE",
      sellerTaxId: "DE123456789",
      buyerTaxId: "DE987654321",
    }))
    expect(r.rate).toBe(0.19)
    expect(r.isExempt).toBe(false)
  })

  it("EU seller + buyer without VAT ID → domestic seller rate (B2C)", async () => {
    const r = await new LocalTaxProvider().resolve(ctx({
      sellerCountry: "DE",
      buyerCountry: "FR",
      sellerTaxId: "DE123456789",
      // buyerTaxId absent — consumer, not business
    }))
    expect(r.rate).toBe(0.19) // seller's domestic rate
  })

  it("EU seller without VAT ID → domestic rate (no reverse-charge)", async () => {
    const r = await new LocalTaxProvider().resolve(ctx({
      sellerCountry: "DE",
      buyerCountry: "FR",
      buyerTaxId: "FR987654321",
    }))
    expect(r.rate).toBe(0.19)
  })

  it("Non-EU seller + EU buyer → no reverse-charge (intra-EU rule only)", async () => {
    const r = await new LocalTaxProvider().resolve(ctx({
      sellerCountry: "GB",
      buyerCountry: "DE",
      sellerTaxId: "GB123456789",
      buyerTaxId: "DE987654321",
    }))
    expect(r.rate).toBe(0.20) // GB rate
    expect(r.isExempt).toBe(false)
  })

  it("Empty-string tax IDs do NOT count as present", async () => {
    const r = await new LocalTaxProvider().resolve(ctx({
      sellerCountry: "DE",
      buyerCountry: "FR",
      sellerTaxId: "",
      buyerTaxId: "   ",
    }))
    expect(r.rate).toBe(0.19) // domestic, not reverse-charge
  })
})

describe("P3 tax — rounding", () => {
  it("rounds to 2 decimals", async () => {
    const r = await new LocalTaxProvider().resolve(ctx({ sellerCountry: "AZ", amount: 333.33 }))
    // 333.33 * 0.18 = 59.9994 → 60.00
    expect(r.amount).toBe(60)
  })

  it("handles half-up rounding correctly", async () => {
    const r = await new LocalTaxProvider().resolve(ctx({ sellerCountry: "AZ", amount: 50.05 }))
    // 50.05 * 0.18 = 9.009 → 9.01
    expect(r.amount).toBe(9.01)
  })
})

describe("P3 tax — resolveTax (resolver chain)", () => {
  it("uses local provider by default", async () => {
    const r = await resolveTax(ctx({ sellerCountry: "AZ" }))
    expect(r.providerName).toBe("local")
    expect(r.rate).toBe(0.18)
  })

  it("picks first supporting provider in chain", async () => {
    const mockProvider: TaxProvider = {
      name: "mock-eu",
      supports: (c) => c.sellerCountry === "DE",
      resolve: async (c) => ({
        rate: 0.05,
        amount: c.amount * 0.05,
        jurisdiction: "MOCK",
        isExempt: false,
        breakdown: [{ label: "MOCK", rate: 0.05, amount: c.amount * 0.05 }],
        providerName: "mock-eu",
      }),
    }
    _setProviderChainForTests([mockProvider, new LocalTaxProvider()])
    const r = await resolveTax(ctx({ sellerCountry: "DE", amount: 1000 }))
    expect(r.providerName).toBe("mock-eu")
    expect(r.rate).toBe(0.05)
  })

  it("falls through to local when first provider does not support", async () => {
    const mockUS: TaxProvider = {
      name: "mock-us",
      supports: (c) => c.sellerCountry === "US",
      resolve: async () => { throw new Error("should not be called") },
    }
    _setProviderChainForTests([mockUS, new LocalTaxProvider()])
    const r = await resolveTax(ctx({ sellerCountry: "AZ" }))
    expect(r.providerName).toBe("local")
  })

  it("throws when no provider in chain supports the context", async () => {
    const noSupport: TaxProvider = {
      name: "no-support",
      supports: () => false,
      resolve: async () => { throw new Error("not supported") },
    }
    _setProviderChainForTests([noSupport])
    await expect(resolveTax(ctx())).rejects.toThrow("No tax provider supports")
  })
})

describe("P3 tax — LOCAL_VAT_RATES integrity", () => {
  it("all rates are 0-0.30 range", () => {
    for (const [country, rate] of Object.entries(LOCAL_VAT_RATES)) {
      expect(rate).toBeGreaterThanOrEqual(0)
      expect(rate).toBeLessThanOrEqual(0.30)
      expect(country).toMatch(/^[A-Z]{2}$/)
    }
  })

  it("CIS primary market countries all present", () => {
    const cis = ["AZ", "RU", "KZ", "UZ", "KG", "TJ", "TM", "AM", "GE", "BY", "UA", "MD"]
    for (const c of cis) {
      expect(LOCAL_VAT_RATES[c]).toBeDefined()
    }
  })

  it("all 27 EU member states present", () => {
    const eu = ["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"]
    expect(eu).toHaveLength(27)
    for (const c of eu) {
      expect(LOCAL_VAT_RATES[c]).toBeDefined()
    }
  })
})
