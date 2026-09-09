import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/** Field UX audit 2026-09-05, task C6 (RUX-404). */
describe("MTM calendar cells UI contract", () => {
  const calendar = readFileSync("src/components/mtm/route-calendar.tsx", "utf8")

  it("marks a past day so the grid can dim it", () => {
    expect(calendar).toContain("isPastMtmCalendarDay(day.date)")
    expect(calendar).toContain('data-past-day={isPastDay ? "true" : "false"}')
  })

  it("keeps the plus quiet on a pointer device and visible where there is no hover", () => {
    // Touch has no hover state: hiding the control behind one would leave the
    // phone and tablet without a way to plan a day at all.
    expect(calendar).toContain("group-hover:opacity-100")
    expect(calendar).toContain("focus-visible:opacity-100")
    expect(calendar).toContain("group-focus-within:opacity-100")
    expect(calendar).toContain("[@media(hover:none)]:opacity-100")
  })
})
