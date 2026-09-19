import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const migration = readFileSync("prisma/migrations/20260919170000_mtm_contact_create_requests/migration.sql", "utf8")
const schema = readFileSync("prisma/schema.prisma", "utf8")

describe("MTM contact create request migration", () => {
  it("creates a durable tenant-isolated approval request", () => {
    expect(migration).toContain('CREATE TABLE "mtm_contact_create_requests"')
    expect(migration).toContain('ALTER TABLE "mtm_contact_create_requests" ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE "mtm_contact_create_requests" FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('CREATE POLICY "tenant_isolation"')
    expect(migration).toContain('UNIQUE ("organizationId", "idempotencyKey")')
    expect(schema).toContain("model MtmContactCreateRequest")
  })

  it("keeps agent, approved contact and clinic foreign keys tenant-safe", () => {
    expect(migration).toContain('FOREIGN KEY ("organizationId", "requestedByAgentId") REFERENCES "mtm_agents"("organizationId", "id")')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "approvedContactId") REFERENCES "mtm_contacts"("organizationId", "id")')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "approvedCustomerId") REFERENCES "mtm_customers"("organizationId", "id")')
  })
})
