import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  "prisma/migrations/20260919150000_mtm_product_presentations/migration.sql",
  "utf8",
)
const schema = readFileSync("prisma/schema.prisma", "utf8")

describe("MTM product presentation migration", () => {
  it("creates the hierarchy, memberships, products and durable visit evidence", () => {
    for (const table of [
      "mtm_product_groups",
      "mtm_product_group_members",
      "mtm_products",
      "mtm_presentation_sessions",
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`)
      expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`)
      expect(migration).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`)
      expect(migration).toContain(`CREATE POLICY tenant_isolation ON "${table}"`)
    }
    expect(schema).toContain("model MtmProductGroup")
    expect(schema).toContain("model MtmProductGroupMember")
    expect(schema).toContain("model MtmProduct")
    expect(schema).toContain("model MtmPresentationSession")
  })

  it("uses tenant-safe composite foreign keys for every field entity link", () => {
    expect(migration).toContain('FOREIGN KEY ("organizationId", "visitId") REFERENCES "mtm_visits"("organizationId", "id")')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "agentId") REFERENCES "mtm_agents"("organizationId", "id")')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "customerId") REFERENCES "mtm_customers"("organizationId", "id")')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "documentId") REFERENCES "mtm_documents"("organizationId", "id")')
  })

  it("pins idempotency and valid coordinate pairs", () => {
    expect(migration).toContain('"mtm_presentation_sessions_organizationId_agentId_clientSessionId_key"')
    expect(migration).toContain('"mtm_presentation_sessions_open_coordinates_check"')
    expect(migration).toContain('"mtm_presentation_sessions_close_coordinates_check"')
  })
})
