import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const sql = readFileSync(join(process.cwd(), "prisma/migrations/20260713190000_mtm_excel_exchange/migration.sql"), "utf8")

describe("MTM Excel exchange migration", () => {
  it("adds tenant-unique external keys and validation snapshots", () => {
    expect(sql).toContain("mtm_agents_organizationId_externalCode_key")
    expect(sql).toContain("mtm_routes_organizationId_externalId_key")
    expect(sql).toContain('"validatedSnapshot" JSONB')
  })

  it("adds constrained plan facts with fail-closed RLS", () => {
    expect(sql).toContain('CREATE TABLE "mtm_sales_plan_lines"')
    expect(sql).toContain("mtm_sales_plan_values_check")
    expect(sql).toContain('ALTER TABLE "mtm_sales_plan_lines" FORCE ROW LEVEL SECURITY')
    expect(sql).toContain('CREATE POLICY "mtm_sales_plan_lines_tenant_isolation"')
  })
})
