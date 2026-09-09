import { vi } from "vitest"

function withDefaultTenantCapabilities(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const auth = value as Record<string, unknown>
  // The production resolver always returns this mandatory field.  Most older
  // fixtures predate entitlement splitting, so give only those incomplete
  // fixtures the ordinary dual-module tenant; explicit capability tests keep
  // their supplied true/false values unchanged.
  return "tenantCapabilities" in auth
    ? value
    : { ...auth, tenantCapabilities: { routeField: true, workforceHrm: true } }
}

function capabilityAwareMobileAuthMock() {
  const mock = vi.fn()
  const methods = ["mockReturnValue", "mockResolvedValue", "mockReturnValueOnce", "mockResolvedValueOnce"] as const
  for (const method of methods) {
    const original = mock[method].bind(mock)
    ;(mock as any)[method] = (value: unknown) => original(withDefaultTenantCapabilities(value))
  }
  return mock
}

/**
 * Shared mock factory for `@/lib/mobile-auth` — replaces the per-file inline
 * mocks that had drifted into 4+ verbatim copies of the same shim (flagged in
 * the PR #296 review).
 *
 * Surface mirrors the real module's value exports (src/lib/mobile-auth.ts):
 * `getMobileAuth`, `resolveMobileAuth`, `requireMobileAuth`, plus the JWT
 * helpers so any import graph that touches the module keeps working.
 *
 * Each export gets its OWN vi.fn() — the real functions have different
 * contracts (requireMobileAuth resolves to MobileAuthResult | NextResponse,
 * resolveMobileAuth to MobileAuthResult | null), so a shared fn would let a
 * test drive one while believing it verified the other. Tests for
 * withMobileRls-wrapped routes mock `resolveMobileAuth`; web-gate tests mock
 * `getMobileAuth`.
 *
 * Usage — ALWAYS via async vi.mock factory (hoist barrier, same pattern as
 * mocks/mtm-prisma.ts):
 *
 *   vi.mock("@/lib/mobile-auth", async () => {
 *     const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
 *     return makeMobileAuthMock()
 *   })
 */
export function makeMobileAuthMock() {
  return {
    getMobileAuth: vi.fn(),
    resolveMobileAuth: capabilityAwareMobileAuthMock(),
    requireMobileAuth: vi.fn(),
    requireJwtSecret: vi.fn(() => "test-secret"),
    JWT_SECRET: "test-secret",
  }
}
