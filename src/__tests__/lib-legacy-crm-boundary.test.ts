/**
 * The legacy CRM eligibility check that runs on every signed-in request (twice: proxy and route).
 * Since 2026-11-12 it is ONE statement instead of an eight-statement REPEATABLE READ transaction
 * (~63 ms each on prod for ~1 ms of database work). The decisions must stay exactly as they were,
 * including failing closed when the statement does not run under this tenant.
 */
import { describe, expect, it, vi } from "vitest"
import { readLegacyCrmCredentialBoundary } from "@/lib/identity/legacy-crm-boundary"

const ORG = "org-1"
const USER = "user-1"
const ok = {
  contextOrg: ORG, bypass: "off",
  companyId: ORG, companyActive: true,
  personId: USER, personOrg: ORG, role: "manager", personActive: true, anonymizedAt: null,
  hasAccount: false, cutoverAt: null,
}
const clientReturning = (row: Record<string, unknown> | undefined) => {
  const $queryRaw = vi.fn(async () => (row ? [row] : []))
  return { client: { $queryRaw } as never, $queryRaw }
}

describe("readLegacyCrmCredentialBoundary", () => {
  it("an active person of an active company is LEGACY — in one statement, no transaction", async () => {
    const { client, $queryRaw } = clientReturning(ok)
    expect(await readLegacyCrmCredentialBoundary(client, ORG, USER)).toBe("LEGACY")
    expect($queryRaw).toHaveBeenCalledTimes(1)
    const sql = ($queryRaw.mock.calls[0] as unknown as [TemplateStringsArray])[0].join("?")
    expect(sql).toMatch(/current_setting\('app\.org_id', true\)/)
    expect(sql).toMatch(/identity_accounts/)
  })

  it("a converted account is MIGRATED", async () => {
    expect(await readLegacyCrmCredentialBoundary(clientReturning({ ...ok, hasAccount: true, cutoverAt: new Date() }).client, ORG, USER)).toBe("MIGRATED")
    expect(await readLegacyCrmCredentialBoundary(clientReturning({ ...ok, hasAccount: true }).client, ORG, USER)).toBe("LEGACY")
  })

  it.each([
    ["no tenant context", { contextOrg: null }],
    ["another tenant's context", { contextOrg: "org-2" }],
    ["RLS bypass on", { bypass: "on" }],
    ["person not found under this tenant", { personId: null, personOrg: null }],
    ["deactivated person", { personActive: false }],
    ["anonymized person", { anonymizedAt: new Date() }],
    ["company not found", { companyId: null }],
    ["suspended company", { companyActive: false }],
  ])("fails closed: %s", async (_case, change) => {
    expect(await readLegacyCrmCredentialBoundary(clientReturning({ ...ok, ...change }).client, ORG, USER)).toBe("UNAVAILABLE")
  })

  it("keeps the platform exception: a superadmin of a suspended company stays LEGACY", async () => {
    expect(await readLegacyCrmCredentialBoundary(clientReturning({ ...ok, companyActive: false, role: "superadmin" }).client, ORG, USER)).toBe("LEGACY")
  })

  it("no row or a failing query is UNAVAILABLE, never LEGACY", async () => {
    expect(await readLegacyCrmCredentialBoundary(clientReturning(undefined).client, ORG, USER)).toBe("UNAVAILABLE")
    const failing = { $queryRaw: vi.fn(async () => { throw new Error("db down") }) } as never
    expect(await readLegacyCrmCredentialBoundary(failing, ORG, USER)).toBe("UNAVAILABLE")
  })
})
