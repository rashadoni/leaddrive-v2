import { describe, expect, it } from "vitest"
import {
  getProductCatalogValue,
  isValidProductPrice,
  isSupportedProductCurrency,
  MAX_PRODUCT_PRICE,
  normalizeProductCurrency,
} from "@/lib/products/pricing"

describe("product catalog pricing", () => {
  it("totals valid prices in one currency", () => {
    expect(getProductCatalogValue([
      { price: 1_500, currency: "AZN" },
      { price: 8_000, currency: "azn" },
    ])).toEqual({
      total: 9_500,
      currency: "AZN",
      hasInvalidPrices: false,
      hasMixedCurrencies: false,
    })
  })

  it("excludes damaged legacy prices from the total", () => {
    expect(getProductCatalogValue([
      { price: 3_500, currency: "AZN" },
      { price: -1e100, currency: "AZN" },
      { price: Number.POSITIVE_INFINITY, currency: "AZN" },
    ])).toEqual({
      total: 3_500,
      currency: "AZN",
      hasInvalidPrices: true,
      hasMixedCurrencies: false,
    })
  })

  it("does not add different currencies without an exchange rate", () => {
    expect(getProductCatalogValue([
      { price: 100, currency: "USD" },
      { price: 100, currency: "AZN" },
    ])).toMatchObject({
      total: null,
      currency: null,
      hasMixedCurrencies: true,
    })
  })

  it("accepts only finite non-negative prices within the catalog limit", () => {
    expect(isValidProductPrice(0)).toBe(true)
    expect(isValidProductPrice(MAX_PRODUCT_PRICE)).toBe(true)
    expect(isValidProductPrice(-1)).toBe(false)
    expect(isValidProductPrice(MAX_PRODUCT_PRICE + 1)).toBe(false)
    expect(isValidProductPrice(Number.NaN)).toBe(false)
  })

  it("normalizes supported currencies and replaces an invalid legacy currency", () => {
    expect(isSupportedProductCurrency("azn")).toBe(true)
    expect(isSupportedProductCurrency("BTC")).toBe(false)
    expect(normalizeProductCurrency(" azn ")).toBe("AZN")
    expect(normalizeProductCurrency("BTC")).toBe("USD")
  })
})
