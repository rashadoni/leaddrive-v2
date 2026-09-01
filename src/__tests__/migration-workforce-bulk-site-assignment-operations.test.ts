import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260901050000_workforce_bulk_site_assignment_operations/migration.sql",
), "utf8")

describe("Workforce bulk site-assignment operation migration", () => {
  it("stores only a tenant-scoped, hash-bound aggregate receipt", () => {
    const operationSchema = schema.slice(schema.indexOf("model WorkforceSiteAssignmentBulkOperation {"))
    expect(operationSchema).toMatch(/requestHash\s+String\s+@db\.VarChar\(64\)/)
    expect(operationSchema).toMatch(/requestedCount\s+Int/)
    expect(operationSchema).toMatch(/@@unique\(\[organizationId, operationId\]\)/)
    expect(migration).toContain('CREATE TABLE "workforce_site_assignment_bulk_operations"')
    expect(migration).toContain('"createdCount" + "unchangedCount" = "requestedCount"')
    expect(migration).not.toMatch(/agentIds|employeeIds|latitude|longitude|mtm_routes|mtm_route_assignments|mtm_customers/i)
  })

  it("makes receipts append-only and tenant-isolated", () => {
    expect(migration).toContain("workforce_guard_bulk_site_assignment_operation_mutation")
    expect(migration).toContain('CREATE TRIGGER workforce_site_assignment_bulk_operations_append_only')
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('CREATE POLICY tenant_isolation ON "workforce_site_assignment_bulk_operations"')
  })
})
