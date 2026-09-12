import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260901060000_workforce_bulk_shift_assignment_operations/migration.sql",
), "utf8")

describe("Workforce bulk shift-assignment operation migration", () => {
  it("stores only a tenant-scoped, hash-bound aggregate receipt", () => {
    const operationSchema = schema.slice(schema.indexOf("model WorkforceShiftAssignmentBulkOperation {"))
    expect(operationSchema).toMatch(/requestHash\s+String\s+@db\.VarChar\(64\)/)
    expect(operationSchema).toMatch(/templateId\s+String/)
    expect(operationSchema).toMatch(/requestedCount\s+Int/)
    expect(operationSchema).toMatch(/@@unique\(\[organizationId, operationId\]\)/)
    expect(migration).toContain('CREATE TABLE "workforce_shift_assignment_bulk_operations"')
    expect(migration).toContain('"createdCount" + "unchangedCount" = "requestedCount"')
    expect(migration).not.toMatch(/agentIds|employeeIds|latitude|longitude|mtm_routes|mtm_route_assignments|mtm_customers/i)
  })

  it("makes receipts append-only and tenant-isolated", () => {
    expect(migration).toContain("workforce_guard_bulk_shift_assignment_operation_mutation")
    expect(migration).toContain('CREATE TRIGGER workforce_shift_assignment_bulk_operations_append_only')
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('CREATE POLICY tenant_isolation ON "workforce_shift_assignment_bulk_operations"')
  })
})
