import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Field UX audit 2026-09-05, task C4 (P0, with A3): a route the day closed by
 * itself must be findable and explained on the web, not just on the phone.
 *
 * The tail this file closes: the only thing pinned so far was that the filter
 * row exists (`mtm-route-calendar-planning-ui-contract`). Nothing said
 * INCOMPLETE had to be in that row, and nothing said the card had to explain
 * itself — both could be deleted and every test would stay green, which is how
 * a P0 quietly stops being delivered.
 */
describe("MTM incomplete route on the web", () => {
  const page = readFileSync("src/app/(dashboard)/mtm/routes/page.tsx", "utf8")
  const locales = ["en", "ru", "az"] as const

  it("offers INCOMPLETE as a filter, next to the statuses it competes with", () => {
    const row = page.slice(page.indexOf('data-testid="mtm-route-status-filters"'))
    const statuses = row.slice(0, row.indexOf("] as const)"))
    for (const status of ["DRAFT", "PLANNED", "IN_PROGRESS", "COMPLETED", "INCOMPLETE", "CANCELLED"]) {
      expect(statuses, `filter row lost ${status}`).toContain(`"${status}"`)
    }
  })

  it("labels the filter from the dictionary, not from a literal", () => {
    // A hard-coded "Incomplete" is the exact defect A5 removed elsewhere; the
    // filter row must not reintroduce it.
    expect(page).toContain('mtmStatusLabel(statusT, "route", s)')
    expect(page).not.toContain('>Incomplete<')
  })

  it("explains the card instead of leaving the chip to speak alone", () => {
    expect(page).toContain('route.status === "INCOMPLETE"')
    expect(page).toContain('t("incompleteReason")')
  })

  it("says the one thing the chip does not, in every language", () => {
    for (const locale of locales) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      const reason = messages.mtmRoutesPage?.incompleteReason as string | undefined
      const chip = messages.mtmStatus?.route?.INCOMPLETE as string | undefined
      expect(reason, `${locale} has no incompleteReason`).toEqual(expect.any(String))
      expect(chip, `${locale} has no route.INCOMPLETE label`).toEqual(expect.any(String))
      // The reason exists because "Не завершён" answers "what" and leaves
      // "why" to guesswork — an agent reads it as an accusation. A reason that
      // only repeats the chip would put the guesswork straight back.
      expect(reason!.trim()).not.toBe(chip!.trim())
      expect(reason!.trim().length).toBeGreaterThan(chip!.trim().length)
    }
  })
})
