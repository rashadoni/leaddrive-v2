import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { WORKFORCE_CALENDAR_EDITOR_KINDS } from "@/components/workforce/workforce-calendar-configuration"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

function messages(locale: string): Record<string, unknown> {
  return JSON.parse(source(`messages/${locale}.json`)).workforceCalendarConfiguration as Record<string, unknown>
}

describe("Workforce calendar configuration UI contract", () => {
  const component = source("src/components/workforce/workforce-calendar-configuration.tsx")
  const page = source("src/app/(dashboard)/workforce/configuration/page.tsx")

  it("mounts a separate Scheduler-visible surface on the configuration page", () => {
    expect(page).toContain("<WorkforceCalendarConfiguration />")
    expect(component).toContain('request("GET")')
    expect(component).toContain('request("POST", { date, kind, name })')
    expect(component).toContain('"/api/v1/workforce/configuration/calendar"')
    expect(component).not.toContain("/api/v1/mtm/work-calendar")
    expect(component).not.toContain("isAdministrator")
    expect(component).not.toContain('role === "admin"')
  })

  it("offers only the three released additive organization override kinds", () => {
    expect(WORKFORCE_CALENDAR_EDITOR_KINDS).toEqual([
      "PUBLIC_HOLIDAY",
      "COMPANY_HOLIDAY",
      "EXCEPTION_WORKDAY",
    ])
    expect(component).not.toContain('value="MOVED_WORKDAY"')
    expect(component).not.toContain('value="MOVED_DAY_OFF"')
    expect(component).not.toContain('value="WORKING_DAY"')
  })

  it("uses named inputs, inline feedback, touch targets and responsive divider rhythm", () => {
    expect(component).toContain('id="workforce-calendar-date"')
    expect(component).toContain('id="workforce-calendar-kind"')
    expect(component).toContain('id="workforce-calendar-name"')
    expect(component).toContain('className="min-h-11"')
    expect(component).toContain("md:grid-cols-3")
    expect(component).toContain('role="alert"')
    expect(component).toContain('role="status" aria-live="polite"')
    expect(component).toContain("divide-y divide-zinc-200")
    expect(component).toContain("motion-reduce:animate-none")
  })

  it("keeps storage and Route-planning fields out of the browser contract", () => {
    expect(component).not.toMatch(/\bteamId\b/)
    expect(component).not.toMatch(/\bagentId\b/)
    expect(component).not.toMatch(/\bmovedToDate\b/)
    expect(component).not.toMatch(/\broutePlanningAllowed\b/)
    expect(component).not.toMatch(/\bcreatedBy\b/)
    expect(component).not.toContain('source: "ADMIN"')
  })

  it("has complete non-empty EN, RU and AZ copy including every readable kind", () => {
    const keys = [
      "title",
      "subtitle",
      "refresh",
      "loading",
      "date",
      "kind",
      "name",
      "namePlaceholder",
      "createHint",
      "create",
      "created",
      "alreadyRecorded",
      "upcomingTitle",
      "upcomingHint",
      "empty",
      "unnamed",
      "dateNotFuture",
      "dateRangeInvalid",
      "overrideExists",
      "accessRequired",
      "requestFailed",
    ]
    for (const locale of ["en", "ru", "az"]) {
      const localized = messages(locale)
      for (const key of keys) {
        expect(localized[key], `${locale}.${key} is missing`).toEqual(expect.any(String))
        expect((localized[key] as string).trim(), `${locale}.${key} is empty`).not.toBe("")
      }
      const kinds = localized.kinds as Record<string, unknown>
      for (const kind of [
        "WORKING_DAY",
        "WEEKEND",
        "PUBLIC_HOLIDAY",
        "COMPANY_HOLIDAY",
        "EXCEPTION_WORKDAY",
        "MOVED_WORKDAY",
        "MOVED_DAY_OFF",
      ]) {
        expect(kinds[kind], `${locale}.kinds.${kind} is missing`).toEqual(expect.any(String))
      }
    }
  })
})
