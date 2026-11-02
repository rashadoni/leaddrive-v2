import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"

const tenant = (modules: Record<string, boolean>, features: string[] = []) => ({ plan: "enterprise", addons: [], modules, features })

// Owner, 2026-10-14: «Персонал» is its own module, sellable without routes.
describe("Personnel tenant capability", () => {
  it("is granted on its own key, without Route & Field", () => {
    expect(isTenantCapabilityEnabled("personnel", tenant({ personnel: true }))).toBe(true)
    expect(isTenantCapabilityEnabled("route-field", tenant({ personnel: true }))).toBe(false)
  })

  it("keeps attendance for tenants on the historical MTM bundle", () => {
    expect(isTenantCapabilityEnabled("personnel", tenant({ mtm: true }))).toBe(true)
  })

  it("honours an explicit off over the bundle, and is not implied by routes alone", () => {
    expect(isTenantCapabilityEnabled("personnel", tenant({ mtm: true, personnel: false }))).toBe(false)
    // Explicit route-field tenants receive the key from the 20261015 backfill.
    expect(isTenantCapabilityEnabled("personnel", tenant({ "route-field": true }))).toBe(false)
  })

  it("backfills every explicit route-field tenant, keeps explicit choices and both feature shapes", () => {
    const sql = readFileSync("prisma/migrations/20261015090000_personnel_capability_backfill/migration.sql", "utf8")
    expect(sql).toMatch(/feats @> '\["route-field"\]'::jsonb AND NOT \(feats @> '\["personnel"\]'::jsonb\)/)
    expect(sql).toMatch(/NOT \(org\."modules" \? 'personnel'\)/)
    expect(sql).toMatch(/'route-field' = 'false'/)
    expect(sql).toMatch(/to_jsonb\(feats::text\)/)
  })
})
