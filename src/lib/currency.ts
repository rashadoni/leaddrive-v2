// Currency-only client boundary. Keep this module free of authorization,
// tenant and internal role constants: public auth pages import `cn` through
// `utils.ts`, and bundlers may retain any static dependency of that module.
export const DEFAULT_CURRENCY = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "USD"

export const CURRENCY_SYMBOLS: Record<string, string> = {
  AZN: "₼", USD: "$", EUR: "€", GBP: "£", RUB: "₽", PLN: "zł",
  TRY: "₺", JPY: "¥", CNY: "¥", CHF: "Fr", SEK: "kr", NOK: "kr",
  CAD: "CA$", AUD: "A$", INR: "₹", BRL: "R$", KRW: "₩",
}

export function getCurrencySymbol(code?: string): string {
  return CURRENCY_SYMBOLS[code || DEFAULT_CURRENCY] || code || DEFAULT_CURRENCY
}

export const INITIAL_CURRENCIES = [
  { code: "USD", name: "US Dollar", symbol: "$", exchangeRate: 1, isBase: true },
  { code: "EUR", name: "Euro", symbol: "€", exchangeRate: 0.92 },
  { code: "GBP", name: "British Pound", symbol: "£", exchangeRate: 0.79 },
] as const
