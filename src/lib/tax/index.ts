/**
 * Tax engine entry point — resolves the right provider for a context.
 *
 * Provider chain (slice 1): only `LocalTaxProvider`. Slice 2 prepends
 * Avalara/Vertex providers that override US/CA jurisdictions before
 * falling through to local.
 *
 * Part of P3 Tax Engine (Phase 1 roadmap).
 */
import type { TaxContext, TaxProvider, TaxResult } from "./types"
import { LocalTaxProvider } from "./providers/local"

const LOCAL = new LocalTaxProvider()

const PROVIDER_CHAIN: TaxProvider[] = [
  // Slice 2: avalara, vertex go here BEFORE LOCAL.
  LOCAL,
]

/**
 * Resolve tax for a context. Throws when no provider supports the context —
 * with the current chain (LOCAL claims `supports()=true` always), this never
 * happens; the guard is for future tightening when Avalara/Vertex restrict
 * their `supports()` to their licensed jurisdictions.
 */
export async function resolveTax(context: TaxContext): Promise<TaxResult> {
  for (const provider of PROVIDER_CHAIN) {
    if (provider.supports(context)) {
      return provider.resolve(context)
    }
  }
  throw new Error(`No tax provider supports context: ${context.sellerCountry} → ${context.buyerCountry}`)
}

/**
 * Test-only — replace provider chain. Tests use this to inject mock providers.
 */
export function _setProviderChainForTests(chain: TaxProvider[]): void {
  PROVIDER_CHAIN.length = 0
  PROVIDER_CHAIN.push(...chain)
}

/** Test-only — restore default chain. */
export function _resetProviderChainForTests(): void {
  PROVIDER_CHAIN.length = 0
  PROVIDER_CHAIN.push(LOCAL)
}

export type { TaxContext, TaxResult, TaxProvider } from "./types"
export { LocalTaxProvider, LOCAL_VAT_RATES } from "./providers/local"
