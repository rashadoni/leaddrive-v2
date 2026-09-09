// src/__tests__/rls-policy-generator.test.ts
import { describe, it, expect } from "vitest"
// vitest resolves .mjs fine; the generator exports pure functions for testing
import { emitEnableSql, emitDisableSql, planBatches, AUTH_CRITICAL_TABLES, BATCH1_CANDIDATES } from "../../scripts/rls/generate-rls-policies.mjs"

describe("rls policy generator", () => {
  it("emitEnableSql emits ENABLE + FORCE + policy with USING and WITH CHECK", () => {
    const sql = emitEnableSql(["deals"])
    expect(sql).toContain(`ALTER TABLE "deals" ENABLE ROW LEVEL SECURITY;`)
    expect(sql).toContain(`ALTER TABLE "deals" FORCE ROW LEVEL SECURITY;`)
    expect(sql).toContain(`DROP POLICY IF EXISTS tenant_isolation ON "deals";`)
    expect(sql).toMatch(/USING \(\s*"organizationId" = current_setting\('app\.org_id', true\)\s*OR current_setting\('app\.rls_bypass', true\) = 'on'\s*\)/)
    expect(sql).toMatch(/WITH CHECK \(\s*"organizationId" = current_setting\('app\.org_id', true\)\s*OR current_setting\('app\.rls_bypass', true\) = 'on'\s*\)/)
  })

  it("emitDisableSql emits instant rollback (DISABLE + DROP POLICY)", () => {
    const sql = emitDisableSql(["deals"])
    expect(sql).toContain(`ALTER TABLE "deals" NO FORCE ROW LEVEL SECURITY;`)
    expect(sql).toContain(`ALTER TABLE "deals" DISABLE ROW LEVEL SECURITY;`)
    expect(sql).toContain(`DROP POLICY IF EXISTS tenant_isolation ON "deals";`)
  })

  it("planBatches: batch 1 = pinned low-risk intersection; auth-critical tables land ONLY in the final batch", () => {
    const tables = ["currencies", "task_types", "event_types", "sla_policies", "deals", "leads", "users", "api_keys", "otp_codes", "contacts"]
    const batches = planBatches(tables, 3)
    expect(batches[0]).toEqual(["currencies", "event_types", "sla_policies", "task_types"]) // sorted intersection with BATCH1_CANDIDATES
    const last = batches[batches.length - 1]
    for (const t of AUTH_CRITICAL_TABLES) expect(last).toContain(t)
    for (const b of batches.slice(0, -1)) {
      for (const t of AUTH_CRITICAL_TABLES) expect(b).not.toContain(t)
    }
    expect(batches.flat().sort()).toEqual([...tables].sort()) // total, no drops
  })

  it("planBatches throws when fewer than 3 batch-1 candidates exist (name drift guard)", () => {
    expect(() => planBatches(["deals", "users"], 2)).toThrow(/batch-1/)
  })

  it("BATCH1_CANDIDATES contains only low-risk lookup tables", () => {
    expect(BATCH1_CANDIDATES).toHaveLength(5)
    expect(BATCH1_CANDIDATES).not.toContain("users")
    expect(BATCH1_CANDIDATES).not.toContain("deals")
  })
})
