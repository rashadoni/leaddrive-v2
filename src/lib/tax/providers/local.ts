/**
 * Local tax provider — hardcoded country-level VAT rates for CIS + EU basics.
 *
 * Scope (slice 1):
 *   - Single national VAT rate per country (no state/city/special-rate variants)
 *   - Intra-EU B2B reverse-charge (both parties have VAT IDs, both in EU)
 *   - Default 0% fallback for unknown jurisdictions (caller decides what to do)
 *
 * Out of scope, deferred to slice 2/3:
 *   - US sales tax (state + county + city stacking — needs Avalara)
 *   - Reduced rates by category (books, food)
 *   - Per-org overrides (e.g. company is VAT-exempt education non-profit)
 *   - Historical rates (the table here represents 2026 rates)
 *
 * Part of P3 Tax Engine.
 */
import type { TaxContext, TaxProvider, TaxResult } from "../types"

/**
 * National standard VAT rates as of 2026. Source: each country's tax
 * authority + VAT-EU service. Hardcoded — slice 2 will pull from
 * `Organization.settings.taxRates` overrides + per-country DB table.
 */
export const LOCAL_VAT_RATES: Record<string, number> = {
  // CIS / Caucasus — LeadDrive primary market
  AZ: 0.18, // Azerbaijan
  RU: 0.20, // Russia
  KZ: 0.12, // Kazakhstan
  UZ: 0.12, // Uzbekistan
  KG: 0.12, // Kyrgyzstan
  TJ: 0.18, // Tajikistan
  TM: 0.15, // Turkmenistan
  AM: 0.20, // Armenia
  GE: 0.18, // Georgia
  BY: 0.20, // Belarus
  UA: 0.20, // Ukraine
  MD: 0.20, // Moldova

  // EU — standard rates
  AT: 0.20, // Austria
  BE: 0.21, // Belgium
  BG: 0.20, // Bulgaria
  HR: 0.25, // Croatia
  CY: 0.19, // Cyprus
  CZ: 0.21, // Czech Republic
  DK: 0.25, // Denmark
  EE: 0.22, // Estonia
  FI: 0.255, // Finland
  FR: 0.20, // France
  DE: 0.19, // Germany
  GR: 0.24, // Greece
  HU: 0.27, // Hungary
  IE: 0.23, // Ireland
  IT: 0.22, // Italy
  LV: 0.21, // Latvia
  LT: 0.21, // Lithuania
  LU: 0.17, // Luxembourg
  MT: 0.18, // Malta
  NL: 0.21, // Netherlands
  PL: 0.23, // Poland
  PT: 0.23, // Portugal
  RO: 0.19, // Romania
  SK: 0.23, // Slovakia
  SI: 0.22, // Slovenia
  ES: 0.21, // Spain
  SE: 0.25, // Sweden

  // Other Europe
  GB: 0.20, // United Kingdom
  CH: 0.081, // Switzerland (2024+ rate)
  NO: 0.25, // Norway
  IS: 0.24, // Iceland
  TR: 0.20, // Turkey

  // Asia (selected)
  AE: 0.05, // UAE
  SA: 0.15, // Saudi Arabia
  IN: 0.18, // India (general GST band)
  CN: 0.13, // China (standard)
  JP: 0.10, // Japan
  KR: 0.10, // South Korea
  SG: 0.09, // Singapore (as of 2024)

  // US — provider sets rate to 0 by default; caller must use Avalara/Vertex
  // for stacked state/county/city sales tax. Slice 2.
  US: 0,
}

/** Set of EU country codes for reverse-charge detection. */
const EU_COUNTRIES = new Set([
  "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE",
  "IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE",
])

/** Stable category labels for reduced-rate handling (slice 2 wiring). */
export const TAX_CATEGORY_LABELS = {
  STANDARD: "standard",
  REDUCED: "reduced",
  EXEMPT: "exempt",
} as const

export class LocalTaxProvider implements TaxProvider {
  readonly name = "local"

  supports(_context: TaxContext): boolean {
    // Local provider supports ALL contexts as the last-resort fallback. When
    // Avalara/Vertex provider lands in slice 2, those will be registered first
    // in the resolver chain and only take over their supported jurisdictions.
    return true
  }

  async resolve(context: TaxContext): Promise<TaxResult> {
    const { sellerCountry, sellerTaxId, buyerCountry, buyerTaxId, amount } = context

    // Intra-EU B2B reverse-charge: both parties in EU, both have tax IDs,
    // different countries. Buyer self-accounts VAT; we charge 0.
    if (
      EU_COUNTRIES.has(sellerCountry) &&
      EU_COUNTRIES.has(buyerCountry) &&
      sellerCountry !== buyerCountry &&
      isNonEmpty(sellerTaxId) &&
      isNonEmpty(buyerTaxId)
    ) {
      return {
        rate: 0,
        amount: 0,
        jurisdiction: `EU B2B reverse-charge (${sellerCountry} → ${buyerCountry})`,
        isExempt: true,
        exemptionReason: "Intra-EU B2B reverse-charge (Art. 196 VAT Directive)",
        breakdown: [],
        providerName: this.name,
      }
    }

    // TODO slice 2: implement EU One-Stop-Shop (OSS) — B2C distance sales above
    //   €10k threshold use BUYER country rate, not seller's. Also: non-EU seller
    //   shipping to EU consumer triggers import VAT (buyer-country IOSS rate).
    //   Current logic uses sellerCountry universally — correct for B2B intra-CIS
    //   and most domestic cases, but wrong for cross-border B2C.

    // US sentinel: local provider declines, caller must use Avalara/Vertex for
    // state+county+city stacking. Distinguish from "actually exempt" via the
    // `requiresExternalProvider` flag — never silently bill $0.
    if (sellerCountry === "US") {
      return {
        rate: 0,
        amount: 0,
        jurisdiction: "US (Avalara/Vertex required)",
        isExempt: true,
        exemptionReason: "US sales tax requires an external provider for state+county+city stacking — slice 2 wires Avalara/Vertex",
        requiresExternalProvider: true,
        breakdown: [],
        providerName: this.name,
      }
    }

    // Domestic / non-EU cross-border: apply seller's national rate.
    const rate = LOCAL_VAT_RATES[sellerCountry] ?? 0
    const taxAmount = round2(amount * rate)

    // Surface unknown jurisdictions so they don't silently disappear into 0%.
    if (rate === 0 && !(sellerCountry in LOCAL_VAT_RATES)) {
      console.warn(`[tax/local] unknown jurisdiction ${sellerCountry} — falling through to 0% (add to LOCAL_VAT_RATES if intentional)`)
    }

    return {
      rate,
      amount: taxAmount,
      jurisdiction: rate > 0
        ? `${sellerCountry} VAT ${formatRatePercent(rate)}%`
        : `${sellerCountry} (no VAT)`,
      isExempt: rate === 0,
      breakdown: rate > 0
        ? [{ label: `${sellerCountry} VAT`, rate, amount: taxAmount }]
        : [],
      providerName: this.name,
    }
  }
}

/**
 * Format a decimal rate as a percentage string. Uses 0 decimals when the
 * rate is a clean integer percent (e.g. 0.20 → "20"), otherwise 1 decimal
 * to preserve fractional rates like Finland's 25.5% or Switzerland's 8.1%.
 */
function formatRatePercent(rate: number): string {
  const pct = rate * 100
  // Treat near-integer values (within 1e-6) as integers to avoid "20.0%".
  if (Math.abs(pct - Math.round(pct)) < 1e-6) {
    return Math.round(pct).toString()
  }
  return pct.toFixed(1)
}

function isNonEmpty(v: string | null | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
