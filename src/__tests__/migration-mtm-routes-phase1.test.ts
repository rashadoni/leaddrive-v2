import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const MIGRATION = "20260713160000_mtm_routes_phase1_foundation"
const sql = readFileSync(resolve("prisma/migrations", MIGRATION, "migration.sql"), "utf8")

const tenantTables = [
  "mtm_route_assignments",
  "mtm_visit_participants",
  "mtm_visit_policies",
  "mtm_visit_policy_actions",
  "mtm_visit_requirement_snapshots",
  "mtm_visit_requirements",
  "mtm_visit_action_results",
  "mtm_route_change_requests",
  "mtm_customer_create_requests",
  "mtm_import_jobs",
  "mtm_import_row_errors",
  "mtm_external_sales_documents",
  "mtm_external_sales_lines",
] as const

describe("MTM Routes Phase 1 foundation migration", () => {
  it("creates every tenant table represented by the Phase 1 schema", () => {
    for (const table of tenantTables) {
      expect(sql).toContain(`CREATE TABLE "${table}"`)
      expect(sql).toContain(`"organizationId" TEXT NOT NULL`)
      expect(sql).toContain(`ALTER TABLE "${table}" ADD CONSTRAINT "${table}_organizationId_fkey"`)
    }
  })

  it("enforces route identity and one active primary assignment", () => {
    expect(sql).toContain('CREATE UNIQUE INDEX "mtm_routes_active_dedupe_key"')
    expect(sql).toContain('WHERE "dedupeKey" IS NOT NULL AND "deletedAt" IS NULL')
    expect(sql).toContain('CREATE UNIQUE INDEX "mtm_route_assignments_one_primary_idx"')
    expect(sql).toContain('WHERE "role" = \'PRIMARY\' AND "removedAt" IS NULL')
  })

  it("backfills legacy route and visit ownership idempotently", () => {
    expect(sql).toContain('INSERT INTO "mtm_route_assignments"')
    expect(sql).toContain('FROM "mtm_routes" r')
    expect(sql).toContain('ON CONFLICT ("routeId", "agentId") DO UPDATE SET')
    expect(sql).toContain('INSERT INTO "mtm_visit_participants"')
    expect(sql).toContain('FROM "mtm_visits" v')
    expect(sql).toContain('ON CONFLICT ("visitId", "agentId") DO UPDATE SET')
  })

  it("forces tenant RLS with an explicit migration bypass", () => {
    for (const table of tenantTables) expect(sql).toContain(`'${table}'`)
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY")
    expect(sql).toContain("FORCE ROW LEVEL SECURITY")
    expect(sql).toContain("current_setting(''app.org_id'', true)")
    expect(sql).toContain("current_setting(''app.rls_bypass'', true) = ''on''")
  })

  it("bounds import payloads and validates request coordinates", () => {
    expect(sql).toContain('"fileSize" >= 0 AND "fileSize" <= 20971520')
    expect(sql).toContain('"latitude" BETWEEN -90 AND 90')
    expect(sql).toContain('"longitude" BETWEEN -180 AND 180')
  })
})
