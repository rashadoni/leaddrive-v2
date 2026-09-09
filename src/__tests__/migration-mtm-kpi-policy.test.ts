import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

const migration = readFileSync(new URL("../../prisma/migrations/20260809170000_mtm_kpi_policy/migration.sql", import.meta.url), "utf8")

describe("SWM-13 signed KPI policy migration", () => {
  it("keeps one tenant active version, coherent signatures and enforced tenant RLS", () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "mtm_kpi_policy_one_active_org_key"')
    expect(migration).toContain('WHERE "status" = \'ACTIVE\'')
    expect(migration).toContain('ADD CONSTRAINT "mtm_kpi_policy_signature_check"')
    expect(migration).toContain('ALTER TABLE "mtm_kpi_policies" FORCE ROW LEVEL SECURITY')
    expect(migration).toContain("current_setting('app.org_id', true)")
  })
})
