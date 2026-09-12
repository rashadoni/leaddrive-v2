import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260901070000_workforce_default_shift_operations/migration.sql",
), "utf8")

describe("Workforce default shift publication operation migration", () => {
  it("persists only a tenant-scoped default-timeline receipt with an opaque replay key", () => {
    expect(schema).toContain("model WorkforceShiftDefaultOperation {")
    expect(schema).toMatch(/operationId\s+String/)
    expect(schema).toMatch(/defaultAssignmentId\s+String/)
    expect(schema).toContain("@@unique([organizationId, operationId])")
    expect(migration).toContain('CREATE TABLE "workforce_shift_default_operations"')
    expect(migration).toContain('"defaultAssignmentId" TEXT NOT NULL')
    expect(migration).toContain('workforce_shift_default_operations_assignment_fkey')
    expect(migration).toContain('workforce_shift_default_operations_organizationId_operationId_key')
  })

  it("is append-only, tenant-isolated, and does not collect roster or attendance evidence", () => {
    expect(migration).toContain("append-only")
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY")
    expect(migration).toContain("FORCE ROW LEVEL SECURITY")
    expect(migration).toContain("current_setting('app.org_id', true)")
    expect(migration).not.toMatch(/"(agentId|employeeId|latitude|longitude|gps|qr|deviceId|attendanceId)"/i)
  })
})
