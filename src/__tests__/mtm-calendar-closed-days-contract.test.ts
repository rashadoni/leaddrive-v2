import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { resolveWorkCalendarDay } from "@/lib/mtm/work-calendar"

/**
 * Field UX audit 2026-09-05, C6 tail (RUX-404): weekends and holidays are
 * shaded, and the reason is on the cell — not only in a tooltip nobody on a
 * tablet can open.
 *
 * The rule that took the thinking: shading follows
 * `enforceWorkCalendarForRoutes`. While the tenant has that off, a weekend
 * blocks no planning at all, so a grey Saturday would be a rule the product
 * does not have.
 */
describe("closed days on the route calendar", () => {
  const calendar = readFileSync("src/components/mtm/route-calendar.tsx", "utf8")
  const page = readFileSync("src/app/(dashboard)/mtm/routes/page.tsx", "utf8")

  it("shades nothing while the tenant does not enforce the calendar", () => {
    expect(calendar).toContain("const calendarDay = workCalendarEnforced")
    // The page must not even ask for overrides in that case.
    expect(page).toContain("if (!orgId || !workCalendarEnforced || !calendarMonth)")
  })

  it("names the reason instead of leaving the cell merely grey", () => {
    expect(calendar).toContain('data-testid="mtm-calendar-closed-reason"')
  })

  it("takes the wording from the shared status dictionary, not its own strings", () => {
    // A5 exists so one enum has one label. Two private keys here would have
    // collapsed PUBLIC_HOLIDAY, COMPANY_HOLIDAY and MOVED_DAY_OFF into a
    // single "non-working day" — vaguer than what the dictionary already says.
    expect(calendar).toContain('mtmStatusLabel(statusT, "dayKind", calendarDay.kind)')
    const dropped: string[] = []
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      for (const key of ["calendarWeekend", "calendarClosedDay"]) {
        if (messages.mtmRoutesPage?.[key] !== undefined) dropped.push(`${locale}.${key}`)
      }
      for (const kind of ["WEEKEND", "PUBLIC_HOLIDAY", "MOVED_DAY_OFF"]) {
        if (typeof messages.mtmStatus?.dayKind?.[kind] !== "string") dropped.push(`${locale}.dayKind.${kind}`)
      }
    }
    expect(dropped).toEqual([])
  })

  it("prefers the override's own name over the generic label", () => {
    // A named holiday is the useful answer; "non-working day" is the fallback
    // for an override somebody saved without a name.
    const named = resolveWorkCalendarDay({
      date: "2026-11-09",
      overrides: [{ id: "o1", date: "2026-11-09", kind: "HOLIDAY", name: "День Победы", teamId: null, agentId: null, routePlanningAllowed: false, movedToDate: null } as never],
    })
    expect(named.routePlanningAllowed).toBe(false)
    expect(named.name).toBe("День Победы")

    const weekend = resolveWorkCalendarDay({ date: "2026-09-12", overrides: [] })
    expect(weekend.source).toBe("WEEKEND_DEFAULT")
    expect(weekend.routePlanningAllowed).toBe(false)

    const workday = resolveWorkCalendarDay({ date: "2026-09-09", overrides: [] })
    expect(workday.routePlanningAllowed).toBe(true)
  })

  it("keeps a failed override request from blanking the calendar", () => {
    // The endpoint sits behind the Workforce HRM module; a tenant without it
    // gets 403, and that must cost the shading, not the calendar.
    expect(page).toContain("response.ok ? response.json() : null")
    expect(page).toContain("setWorkCalendarOverrides(result?.success && Array.isArray(result.data?.days) ? result.data.days : [])")
  })


})
