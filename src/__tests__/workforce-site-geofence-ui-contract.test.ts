import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

function messages(locale: string): Record<string, unknown> {
  return JSON.parse(source(`messages/${locale}.json`)).workforceConfigurationPage as Record<string, unknown>
}

describe("Workforce site and geofence configuration UI contract", () => {
  const workbench = source("src/components/workforce/workforce-configuration-workbench.tsx")

  it("keeps named site creation and calibrated geofence revisions in Workforce configuration", () => {
    expect(workbench).toContain('id="workforce-site-code"')
    expect(workbench).toContain('id="workforce-site-name"')
    expect(workbench).toContain('id="workforce-site-type"')
    expect(workbench).toContain('request("/api/v1/workforce/configuration/sites", "POST"')
    expect(workbench).toContain('id="workforce-geofence-site"')
    expect(workbench).toContain('"/api/v1/workforce/configuration/sites/" + encodeURIComponent(selectedGeofenceSite.id) + "/geofences"')
    expect(workbench).toContain('id="workforce-geofence-calibration"')
    expect(workbench).toContain('radiusMeters < 25 || radiusMeters > 5_000')
    expect(workbench).not.toContain('/api/v1/mtm/')
  })

  it("offers a deliberate map-pin preview without collecting browser location", () => {
    expect(workbench).toContain("mapPinHref")
    expect(workbench).toContain("www.openstreetmap.org")
    expect(workbench).toContain('target="_blank" rel="noreferrer"')
    expect(workbench).not.toContain("navigator.geolocation")
  })

  it("shows a dated assignment-only impact preview and retained revision history", () => {
    expect(workbench).toContain("geofenceImpactAssignments")
    expect(workbench).toContain("geofenceImpactPreview")
    expect(workbench).toContain("geofenceImpactHint")
    expect(workbench).toContain("geofenceRevisionHistory")
    expect(workbench).toContain("loadGeofenceRevisions")
  })

  it("has complete, non-empty translation copy for visible site and geofence controls", () => {
    const keys = [
      "sitesGeofencesTitle",
      "newSite",
      "siteFutureOnlyHint",
      "siteCode",
      "newGeofenceRevision",
      "geofenceFutureOnlyHint",
      "geofenceCalibrationReference",
      "geofenceImpactPreview",
      "geofenceImpactHint",
      "geofenceRevisionHistory",
    ]
    for (const locale of ["en", "az", "ru"]) {
      const localized = messages(locale)
      for (const key of keys) {
        expect(localized[key], `${locale}.${key} is missing`).toEqual(expect.any(String))
        expect((localized[key] as string).trim(), `${locale}.${key} is empty`).not.toBe("")
      }
    }
  })
})
