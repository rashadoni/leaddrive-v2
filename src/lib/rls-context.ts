// src/lib/rls-context.ts
/**
 * AsyncLocalStorage tenant context for Postgres RLS.
 *
 * The Prisma extension in src/lib/prisma.ts reads this store and injects
 * `set_config('app.org_id' | 'app.rls_bypass', ..., true)` on the same
 * connection as every query. No context → the DB fails closed (policies
 * compare against NULL → zero rows).
 *
 * ENTRY RULES (architect invariant):
 * - `enterTenantContext` / `enterRlsBypass` (enterWith-based) are for the
 *   per-request HTTP path ONLY — called inside requireAuth/getOrgId/
 *   requireSuperAdmin/requireCronAuth, they bind the remainder of the
 *   request's async continuation.
 * - Loops, setInterval ticks, scripts and any non-request code MUST use the
 *   .run()-based `runWithTenant` / `runWithRlsBypass` — enterWith inside a
 *   tick leaks into every subsequent tick (pinned by unit test).
 * - NEVER return a bare PrismaPromise out of a `.run` scope (e.g. raw
 *   `rlsStorage.run(ctx, () => prisma.x.find(...))` in tests/spikes): the
 *   promise executes at await-time OUTSIDE the scope → hook sees no context →
 *   false fail-closed. The helpers below force-await internally for this
 *   reason; direct rlsStorage.run users must `async () => await ...`.
 */
import { AsyncLocalStorage } from "node:async_hooks"
import { tenantDataKeyPreloadDue } from "./crypto/tenant-data-key-cache"
import { isTenantPiiMasterKeyConfigured } from "./crypto/tenant-pii-encryption"

export interface RlsContext {
  orgId?: string
  bypass?: boolean
  /** set by the $transaction override so the per-op wrap passes through inside a tx */
  inTx?: boolean
  /** set while `tenant-data-keys.ts` loads a key ring, so its own queries do not preload again */
  tenantDataKeyLoad?: boolean
}

// PROD INCIDENT 2026-06-11: Next standalone duplicates this module into ~85
// route chunks. A plain module-level instance gives every chunk its OWN
// AsyncLocalStorage — guards write tenant context into one copy, the Prisma
// extension reads another → ctx is always undefined → RLS fails closed and
// every list renders empty. globalThis makes all copies share ONE storage
// (same pattern as the prisma client singleton). Do NOT "simplify" this back.
const globalForRls = globalThis as unknown as {
  __rlsStorage?: AsyncLocalStorage<RlsContext>
}
export const rlsStorage: AsyncLocalStorage<RlsContext> =
  globalForRls.__rlsStorage ?? (globalForRls.__rlsStorage = new AsyncLocalStorage<RlsContext>())

export function getRlsContext(): RlsContext | undefined {
  return rlsStorage.getStore()
}

/**
 * Whether `runWithTenant` must load the organization's data key ring
 * (`src/lib/crypto/tenant-data-keys.ts`) before its callback, so the
 * synchronous PII column API can write v2 and read what was written under it.
 * Synchronous: when false — ring fresh, no master key, a load just failed, or
 * we are inside a load — the callback starts at once, as it always did.
 */
function tenantDataKeyPreloadNeeded(orgId: string): boolean {
  try {
    return !rlsStorage.getStore()?.tenantDataKeyLoad && tenantDataKeyPreloadDue(orgId) && isTenantPiiMasterKeyConfigured()
  } catch {
    return false
  }
}

/**
 * The module is imported lazily because it imports the Prisma client, which
 * imports this file. Never throws: a failed load leaves writes on v1.
 */
async function preloadTenantDataKeysFor(orgId: string): Promise<void> {
  try {
    const { preloadTenantDataKeys } = await import("./crypto/tenant-data-keys")
    await preloadTenantDataKeys(orgId)
  } catch {
    // preloadTenantDataKeys logs its own failures; an import failure leaves v1.
  }
}

/**
 * Scoped tenant context. Use for webhooks, public pages, per-tenant script sections.
 *
 * FORCE-AWAITS the callback INSIDE the ALS scope (Task 2 spike finding):
 * PrismaPromise is lazy — the query pipeline (and the RLS extension hook)
 * executes at await-time, not at call-time. A bare pass-through
 * (`rlsStorage.run(ctx, fn)`) would let one-liner callers like
 * `runWithTenant(org, () => prisma.x.findFirst(...))` create the promise
 * inside the scope but await it outside → hook sees no context → silent
 * fail-closed empty reads. Because this helper awaits internally, one-liner
 * callbacks like `() => prisma.x.find(...)` are SAFE.
 *
 * Empty orgId throws SYNCHRONOUSLY (before entering the scope) — '' would
 * otherwise match empty-string organizationId rows in the policy.
 */
export function runWithTenant<T>(orgId: string, fn: () => T | Promise<T>): Promise<Awaited<T>>
// Implementation row is permissive (unknown) because TS can't relate the
// inferred Promise<T> of `async () => await fn()` to Promise<Awaited<T>>
// for an unresolved T; the overload above is the only signature callers see.
export function runWithTenant(orgId: string, fn: () => unknown): Promise<unknown> {
  if (!orgId || typeof orgId !== "string") {
    throw new Error("runWithTenant: orgId must be a non-empty string")
  }
  if (!tenantDataKeyPreloadNeeded(orgId)) return rlsStorage.run({ orgId }, async () => await fn())
  return rlsStorage.run({ orgId }, async () => {
    await preloadTenantDataKeysFor(orgId)
    return await fn()
  })
}

/**
 * Scoped cross-tenant bypass. Use for auth bootstrap lookups, timer ticks,
 * org-resolution in webhooks.
 *
 * FORCE-AWAITS the callback INSIDE the ALS scope — same lazy-PrismaPromise
 * rationale as runWithTenant (Task 2 spike finding): one-liner callbacks
 * like `() => prisma.x.find(...)` are SAFE because the await happens here,
 * within the bypass scope.
 */
export function runWithRlsBypass<T>(fn: () => T | Promise<T>): Promise<Awaited<T>>
// Permissive implementation row — same TS inference limitation as runWithTenant.
export function runWithRlsBypass(fn: () => unknown): Promise<unknown> {
  return rlsStorage.run({ bypass: true }, async () => await fn())
}

/**
 * Bind tenant context to the remainder of the current request (HTTP guards only).
 * Returns false (and enters NOTHING) on empty orgId — '' would otherwise match
 * empty-string organizationId rows in the policy (Codex finding).
 */
export function enterTenantContext(orgId: string): boolean {
  if (!orgId || typeof orgId !== "string") {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[rls] enterTenantContext: empty orgId — context NOT entered (fail-closed)")
    }
    return false
  }
  rlsStorage.enterWith({ orgId })
  return true
}

/** Bind cross-tenant bypass to the remainder of the current request (HTTP guards only). */
export function enterRlsBypass(): void {
  rlsStorage.enterWith({ bypass: true })
}
