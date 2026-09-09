/**
 * Tax engine type contracts. Providers (local rates / Avalara / Vertex)
 * implement `TaxProvider`; the resolver in `src/lib/tax/index.ts` picks the
 * first provider that supports a given context.
 *
 * Part of P3 Tax Engine (Phase 1 roadmap).
 */

/** ISO 3166-1 alpha-2 country code (e.g. "AZ", "RU", "DE"). */
export type CountryCode = string

export interface TaxContext {
  /** Country where the seller is registered. */
  sellerCountry: CountryCode
  /** Optional VAT/tax ID of the seller; used for intra-EU reverse-charge logic. */
  sellerTaxId?: string | null
  /** Country where the buyer / billing address is located. */
  buyerCountry: CountryCode
  /** Optional VAT/tax ID of the buyer; presence enables reverse-charge in EU. */
  buyerTaxId?: string | null
  /** Item or service category for jurisdictions with reduced rates. */
  itemCategory?: string | null
  /** Amount to tax in the invoice currency (after discounts, before tax). */
  amount: number
  /** Issue date — rates change over time, providers respect the snapshot. */
  date?: Date
}

export interface TaxBreakdownLine {
  /** Component name (e.g. "VAT", "State sales tax", "City tax"). */
  label: string
  /** Decimal rate, 0-1. 0.18 = 18%. */
  rate: number
  /** Currency amount in invoice currency. */
  amount: number
}

export interface TaxResult {
  /** Combined effective rate (sum of all breakdown lines). */
  rate: number
  /** Total tax amount in invoice currency. */
  amount: number
  /** Human-readable jurisdiction label for invoice display (e.g. "AZ VAT 18%"). */
  jurisdiction: string
  /** True when no tax is charged due to reverse-charge / exemption. */
  isExempt: boolean
  /** Optional explanation when isExempt = true (e.g. "Intra-EU B2B reverse charge"). */
  exemptionReason?: string
  /**
   * True when this provider declined to compute the rate because it requires
   * an external service (e.g. US sales tax needs Avalara/Vertex for state
   * stacking). Callers should NOT silently bill $0 in this case — instead
   * detect this flag and either route to a different provider or block the
   * invoice with a clear error.
   */
  requiresExternalProvider?: boolean
  /** Multi-tier breakdown (for invoice display). */
  breakdown: TaxBreakdownLine[]
  /** Provider that resolved this context (for audit). */
  providerName: string
}

export interface TaxProvider {
  /** Stable identifier — e.g. "local", "avalara", "vertex". */
  readonly name: string
  /** Return true if this provider can compute tax for the given context. */
  supports(context: TaxContext): boolean
  /** Compute tax. Must throw on `!supports(context)` per resolver contract. */
  resolve(context: TaxContext): Promise<TaxResult>
}
