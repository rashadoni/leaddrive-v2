import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260830050000_workforce_site_assignments/migration.sql",
), "utf8")

describe("Workforce site assignment migration", () => {
  it("adds tenant-scoped primary, secondary and temporary effective history", () => {
    const assignmentSchema = schema.slice(schema.indexOf("model WorkforceSiteAssignment {"))
    expect(assignmentSchema).toMatch(/kind\s+WorkforceSiteAssignmentKind/)
    expect(assignmentSchema).toMatch(/@@index\(\[organizationId, agentId, kind, effectiveFrom, effectiveTo\]\)/)
    expect(migration).toContain("'PRIMARY'")
    expect(migration).toContain("'SECONDARY'")
    expect(migration).toContain("'TEMPORARY'")
    expect(migration).toContain('REFERENCES "mtm_agents"("organizationId", "id")')
    expect(migration).toContain('REFERENCES "workforce_sites"("organizationId", "id")')
  })

  it("guards timeline rewrites/deletes and remains independent of Route", () => {
    expect(migration).toContain('CREATE TRIGGER workforce_site_assignments_append_only')
    expect(migration).toContain('CREATE TRIGGER workforce_site_assignments_validate_window')
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).not.toMatch(/mtm_routes|mtm_route_assignments|mtm_customers/i)
  })
})
