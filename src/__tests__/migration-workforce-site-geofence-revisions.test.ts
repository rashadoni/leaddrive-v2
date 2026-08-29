import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260830040000_workforce_site_geofence_revisions/migration.sql",
), "utf8")

describe("Workforce site geofence revision migration", () => {
  it("stores only a validated v1 circle with an effective-dated tenant key", () => {
    const revisionSchema = schema.slice(schema.indexOf("model WorkforceSiteGeofenceRevision {"))
    expect(revisionSchema).toMatch(/kind\s+WorkforceSiteGeofenceKind\s+@default\(CIRCLE\)/)
    expect(revisionSchema).toMatch(/@@unique\(\[organizationId, siteId, revision\]\)/)
    expect(migration).toContain('"radiusMeters" BETWEEN 25 AND 5000')
    expect(migration).toContain('REFERENCES "workforce_sites"("organizationId", "id")')
    expect(migration).toContain('CREATE TRIGGER workforce_site_geofence_revisions_validate_window')
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
  })

  it("prevents geometry rewrites/deletes and does not use Route geometry", () => {
    expect(migration).toContain('CREATE TRIGGER workforce_site_geofence_revisions_append_only')
    expect(migration).toContain('geometry is immutable')
    expect(migration).not.toMatch(/mtm_customers|mtm_routes|route_points|geofenceRadius/i)
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE)\s+"mtm_/i)
  })
})
