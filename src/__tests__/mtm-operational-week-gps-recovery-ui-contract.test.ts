import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

function operationalWeekMessages(locale: string): Record<string, unknown> {
  return JSON.parse(source(`messages/${locale}.json`)).mtmDashboardPage.operationalWeek as Record<string, unknown>
}

describe("SWM-17 operational week GPS recovery contract", () => {
  const week = source("src/components/mtm/operational-week-home.tsx")

  it("shows recovery only for today's explicit permission or missing-location evidence", () => {
    expect(week).toContain('selectedDay?.isToday')
    expect(week).toContain('["PERMISSION_NOT_GRANTED", "NO_LOCATION_REPORTED"]')
    expect(week).toContain('data-testid="mtm-operational-week-gps-recovery"')
  })

  it("offers evidence drill-down and a bounded refresh without pretending to open device settings", () => {
    expect(week).toContain("selectedGpsHistoryHref")
    expect(week).toContain('t("gpsRecovery.refresh")')
    expect(week).toContain("!inFlightRef.current")
    expect(week).not.toContain("openDeviceSettings")
  })

  it("localizes actionable recovery guidance", () => {
    for (const locale of ["ru", "az", "en"]) {
      const messages = operationalWeekMessages(locale)
      const recovery = messages.gpsRecovery as Record<string, unknown>
      for (const key of ["permissionTitle", "permissionHint", "noLocationTitle", "noLocationHint", "refresh"]) {
        expect(recovery[key], `${locale}.gpsRecovery.${key} is missing`).toEqual(expect.any(String))
        expect((recovery[key] as string).trim(), `${locale}.gpsRecovery.${key} is empty`).not.toBe("")
      }
    }
  })
})
