import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
const migration = readFileSync(join(
  root,
  "prisma/migrations/20260830090000_workforce_qr_site_binding/migration.sql",
), "utf8")

describe("Workforce QR station site-binding migration", () => {
  it("keeps legacy rows auditable but makes new station binding tenant-scoped and immutable", () => {
    const stationSchema = schema.slice(schema.indexOf("model WorkforceAttendanceQrStation"))
    expect(stationSchema).toContain("siteId")
    expect(stationSchema).toContain("geofenceRevisionId")
    expect(stationSchema).toContain("effectiveFrom")
    expect(stationSchema).toContain("effectiveTo")
    expect(stationSchema).toContain("WorkforceAttendanceQrStationSite")
    expect(stationSchema).toContain("WorkforceAttendanceQrStationGeofenceRevision")
    expect(migration).toContain('ADD COLUMN "siteId" TEXT')
    expect(migration).toContain('ADD COLUMN "geofenceRevisionId" TEXT')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "siteId") REFERENCES "workforce_sites"')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "geofenceRevisionId") REFERENCES "workforce_site_geofence_revisions"')
    expect(migration).toContain('workforce_validate_attendance_qr_station_binding')
    expect(migration).toContain('workforce_guard_attendance_qr_station')
  })

  it("never introduces a Route/customer relation or a raw QR token column", () => {
    expect(migration).not.toMatch(/mtm_customers|mtm_routes|route/i)
    expect(migration).not.toMatch(/ADD COLUMN "(?:token|nonce)"/i)
  })
})
