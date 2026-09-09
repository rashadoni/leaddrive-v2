import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

function routeMessages(locale: string): Record<string, unknown> {
  return JSON.parse(source(`messages/${locale}.json`)).mtmRoutesPage as Record<string, unknown>
}

describe("MTM planner launch-context UI contract", () => {
  const page = source("src/app/(dashboard)/mtm/routes/page.tsx")
  const builder = source("src/components/mtm/route-builder.tsx")
  const calendar = source("src/components/mtm/route-calendar.tsx")
  const week = source("src/components/mtm/route-week-plan.tsx")
  const matrix = source("src/components/mtm/route-planning-matrix.tsx")

  it("keeps tenant and viewer scoped context in session storage rather than changing route contracts", () => {
    expect(page).toContain("mtmRoutePlannerContextStorageKey")
    expect(page).toContain("window.sessionStorage.getItem(plannerContextStorageKey)")
    expect(page).toContain("window.sessionStorage.setItem(plannerContextStorageKey")
    expect(page).toContain("mergeMtmRoutePlannerContext")
    expect(page).toContain("openDayPlannerFromMatrix")
    expect(page).not.toContain("/api/v1/mtm/routes/planner-context")
  })

  it("passes one frozen launch context into the daily editor without replacing existing planning views", () => {
    expect(page).toContain("initialPlannerContext={builderPreset?.plannerContext}")
    expect(page).toContain("onPlannerContextChange={updatePlannerContext}")
    expect(builder).toContain("initialPlannerContext?: MtmRoutePlannerContext")
    expect(builder).toContain("onPlannerContextChange?: (context: MtmRoutePlannerContext) => void")
    expect(builder).toContain("setCustomerSearch(initialPlannerContext?.search ?? \"\")")
    expect(builder).toContain("setCandidateFilters({ ...emptyCandidateFilters, ...initialPlannerContext?.filters })")
    expect(page).toContain('data-testid="mtm-routes-view-matrix"')
    expect(page).toContain('data-testid="mtm-routes-view-calendar"')
    expect(page).toContain('data-testid="mtm-routes-view-week"')
  })

  it("preserves the chosen date across the calendar and week and offers a canonical day-planner handoff from the weekly workspace", () => {
    expect(calendar).toContain("selectedDate?: string | null")
    expect(calendar).toContain("onSelectedDateChange?: (date: string) => void")
    expect(calendar).toContain("onSelectedDateChange?.(date)")
    expect(week).toContain("initialDate?: string | null")
    expect(week).toContain("onDateChange?: (date: string) => void")
    expect(week).toContain("onDateChange?.(dateKey(next))")
    expect(matrix).toContain("onOpenDayPlanner?: (input: DayPlannerLaunch) => void")
    expect(matrix).toContain('data-testid="mtm-week-planner-open-day"')
    expect(matrix).toContain('t("openDayPlanner")')
    expect(matrix).toContain('t("weekPlannerOpenDayHint")')
  })

  it("localizes the shared planner handoff in every supported language", () => {
    for (const locale of ["ru", "az", "en"]) {
      const messages = routeMessages(locale)
      for (const key of ["openDayPlanner", "weekPlannerOpenDayHint"]) {
        expect(messages[key], `${locale}.${key} is missing`).toEqual(expect.any(String))
        expect((messages[key] as string).trim(), `${locale}.${key} is empty`).not.toBe("")
      }
    }
  })
})
