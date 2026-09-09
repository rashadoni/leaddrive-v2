/**
 * Payment provider registry — D5 Phase 6 Block A slice 1.
 *
 * Resolves a `PaymentProvider` instance by its type key. Module-scope
 * registry populated at import time; concrete providers self-register
 * via `registerProvider(provider)` from their respective modules.
 *
 * Slice 2 webhook handler + route layer call `getProvider(type)` to
 * pick the right adapter for a given PaymentProvider DB row. Slice 1
 * ships the registry + 4 stubbed providers (stripe / paypal / yookassa
 * / robokassa).
 *
 * Test isolation: the registry is a mutable Map. Tests that want to
 * exercise registration logic without polluting other suites should
 * `unregisterProvider(type)` in afterEach, OR test the registry behavior
 * in a separate suite that doesn't share the global registry state.
 * Production code MUST NOT call `unregisterProvider` — it's test-only.
 */
import type { PaymentProvider, PaymentProviderType } from "./types"

const REGISTRY = new Map<PaymentProviderType, PaymentProvider>()

/**
 * Register a concrete provider implementation. Idempotent — re-
 * registering the same type overwrites (last-in wins). Slice-1
 * provider modules call this at import time.
 */
export function registerProvider(provider: PaymentProvider): void {
  REGISTRY.set(provider.type, provider)
}

/**
 * Look up a registered provider. Returns null if the type was never
 * registered (caller must check + 500 / 503 the route accordingly).
 */
export function getProvider(type: PaymentProviderType): PaymentProvider | null {
  return REGISTRY.get(type) ?? null
}

/**
 * @internal
 * Test-only — clears a registration. Production code MUST NOT call
 * this. Exists so vitest can verify registry-resolution behavior
 * without leaking state between suites. The `@internal` JSDoc keeps
 * it out of generated API docs / typedoc output.
 */
export function unregisterProvider(type: PaymentProviderType): void {
  REGISTRY.delete(type)
}

/**
 * Diagnostic — list every currently-registered provider type. Used
 * by the slice-2 admin "supported providers" endpoint.
 */
export function listRegisteredProviderTypes(): readonly PaymentProviderType[] {
  return Array.from(REGISTRY.keys())
}
