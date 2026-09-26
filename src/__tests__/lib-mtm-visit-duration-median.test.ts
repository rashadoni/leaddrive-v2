import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { medianVisitDurationMinutes } from "@/lib/mtm/visit-duration-median"

/**
 * Audit 2026-09-21: the visits card said «Ср. длительность 169 мин» for five
 * visits, one of them a 787-minute check-out forgotten 9.9 km away.
 */
describe("median visit duration", () => {
  it("is not moved by one forgotten check-out", () => {
    const prod = [12, 18, 9, 787, 20].map((duration) => ({ duration }))
    expect(medianVisitDurationMinutes(prod)).toBe(18)
  })

  it("averages the two middle visits of an even list and rounds to a minute", () => {
    expect(medianVisitDurationMinutes([{ duration: 10 }, { duration: 15 }, { duration: 20 }, { duration: 600 }])).toBe(18)
  })

  it("ignores visits without a duration and says nothing when none has one", () => {
    expect(medianVisitDurationMinutes([{ duration: null }, { duration: 7 }, {}])).toBe(7)
    expect(medianVisitDurationMinutes([{ duration: null }, {}])).toBeNull()
    expect(medianVisitDurationMinutes([])).toBeNull()
  })

  it("is what the visits page shows, with a dash instead of a zero nobody measured", () => {
    const page = readFileSync("src/app/(dashboard)/mtm/visits/page.tsx", "utf8")
    expect(page).toContain("const medianDuration = medianVisitDurationMinutes(visits)")
    expect(page).toContain('t("statMedianDuration")')
    expect(page).toContain('medianDuration == null ? "—"')
    expect(page).not.toContain("averageDuration")
    for (const locale of ["az", "ru", "en"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      expect(messages.mtmVisitsPage.statMedianDuration).toMatch(/[Mm]edian|Медиан/)
    }
  })
})
