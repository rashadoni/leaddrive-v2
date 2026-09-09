import { CURRENCY_SYMBOLS, DEFAULT_CURRENCY } from "@/lib/constants"

export const MAX_PRODUCT_PRICE = 999_999_999

export interface ProductPrice {
  price: number
  currency: string
}

export interface ProductCatalogValue {
  total: number | null
  currency: string | null
  hasInvalidPrices: boolean
  hasMixedCurrencies: boolean
}

export function isValidProductPrice(price: number): boolean {
  return Number.isFinite(price) && price >= 0 && price <= MAX_PRODUCT_PRICE
}

export function isSupportedProductCurrency(currency: unknown): currency is string {
  if (typeof currency !== "string") return false
  return Object.hasOwn(CURRENCY_SYMBOLS, currency.trim().toUpperCase())
}

/**
 * Keeps legacy/invalid product currencies from leaving a native <select>
 * visually on the first option while React still holds the invalid value.
 */
export function normalizeProductCurrency(currency: unknown): string {
  const normalized = typeof currency === "string" ? currency.trim().toUpperCase() : ""
  if (isSupportedProductCurrency(normalized)) return normalized

  const fallback = DEFAULT_CURRENCY.trim().toUpperCase()
  return isSupportedProductCurrency(fallback) ? fallback : "AZN"
}

/**
 * Produces a currency-safe catalog total. Invalid legacy values are excluded
 * so one damaged row cannot break the dashboard. Different currencies are not
 * added together because doing so requires an exchange rate.
 */
export function getProductCatalogValue(products: ProductPrice[]): ProductCatalogValue {
  const totals = new Map<string, number>()
  let hasInvalidPrices = false

  for (const product of products) {
    if (!isValidProductPrice(product.price)) {
      hasInvalidPrices = true
      continue
    }

    const currency = product.currency.trim().toUpperCase()
    if (!currency) {
      hasInvalidPrices = true
      continue
    }

    totals.set(currency, (totals.get(currency) ?? 0) + product.price)
  }

  if (totals.size === 0) {
    return { total: 0, currency: null, hasInvalidPrices, hasMixedCurrencies: false }
  }

  if (totals.size > 1) {
    return { total: null, currency: null, hasInvalidPrices, hasMixedCurrencies: true }
  }

  const [[currency, total]] = totals
  return { total, currency, hasInvalidPrices, hasMixedCurrencies: false }
}
