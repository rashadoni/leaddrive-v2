import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260830030000_workforce_sites/migration.sql",
), "utf8")

describe("Workforce site migration", () => {
  it("creates an independent, tenant-scoped site lifecycle", () => {
    const siteSchema = schema.slice(schema.indexOf("model WorkforceSite {"))
    expect(siteSchema).toMatch(/code\s+String\s+@db\.VarChar\(64\)/)
    expect(siteSchema).toMatch(/responsibleTeamId\s+String\?/)
    expect(siteSchema).toMatch(/@@unique\(\[organizationId, code\]\)/)
    expect(migration).toContain('CREATE TABLE "workforce_sites"')
    expect(migration).toContain('REFERENCES "mtm_teams"("organizationId", "id")')
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('CREATE POLICY tenant_isolation ON "workforce_sites"')
  })

  it("does not couple Workforce sites to Route or customer data", () => {
    expect(migration).not.toMatch(/mtm_customers|mtm_routes|route_points|geofenceRadius/i)
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE)\s+"mtm_/i)
  })
})
