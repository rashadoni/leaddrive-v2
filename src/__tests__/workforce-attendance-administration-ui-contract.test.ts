import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const administration = readFileSync("src/components/workforce/workforce-attendance-administration.tsx", "utf8")
const configurationPage = readFileSync("src/app/(dashboard)/workforce/configuration/page.tsx", "utf8")

function messages(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).workforceAttendanceAdmin as Record<string, unknown>
}

describe("Workforce attendance administration UI boundary", () => {
  it("mounts the security surface in Workforce configuration", () => {
    expect(configurationPage).toContain("WorkforceAttendanceAdministration")
  })

  it("uses short-lived QR image data without rendering sensitive device proof material", () => {
    expect(administration).toContain("qrDataUrl")
    expect(administration).toContain("<Image")
    expect(administration).not.toContain("publicKeySpki")
    expect(administration).not.toContain("publicKeyFingerprint")
    expect(administration).not.toContain("deviceAttestation")
  })

  it("limits device lifecycle actions to verified pending approval and active revocation", () => {
    expect(administration).toContain('device.status === "PENDING" && device.keyVerifiedAt')
    expect(administration).toContain('device.status === "ACTIVE"')
    expect(administration).toContain('operation: "approve" | "revoke"')
    expect(administration).toContain('/${operation}')
  })

  it("creates QR stations through named active-site and effective-circle choices", () => {
    expect(administration).toContain('id="workforce-qr-station-site"')
    expect(administration).toContain('id="workforce-qr-station-geofence"')
    expect(administration).toContain('request("/api/v1/workforce/configuration/sites", "GET")')
    expect(administration).toContain("encodeURIComponent(stationForm.siteId)")
    expect(administration).toContain('request("/api/v1/workforce/attendance/stations", "POST"')
    expect(administration).toContain('stationGeofenceRequired')
    expect(administration).not.toContain('stationSiteLabel(station.siteId || "—")')
  })

  it("makes emergency QR replacement deliberate and preserves the existing site context server-side", () => {
    expect(administration).toContain('request(`/api/v1/workforce/attendance/stations/${encodeURIComponent(station.id)}/replace`, "POST"')
    expect(administration).toContain('t("stationReplacementWarning")')
    expect(administration).toContain('id={`workforce-qr-station-replacement-code-${station.id}`}')
    expect(administration).not.toContain("geofenceRevisionId: replacementForm")
  })

  it("has complete translation copy for station creation without exposing a raw site id", () => {
    const keys = [
      "newStation",
      "newStationHint",
      "stationSite",
      "stationGeofenceRevision",
      "stationGeofenceRequired",
      "stationValidationFailed",
      "createStation",
      "stationSiteUnavailable",
      "replaceStation",
      "stationReplacementTitle",
      "stationReplacementHint",
      "stationReplacementWarning",
      "stationReplacementValidationFailed",
      "cancelStationReplacement",
      "stationReplaced",
      "stationReplaceFailed",
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
