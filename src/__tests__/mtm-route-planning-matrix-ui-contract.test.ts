import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

function localeKeys(locale: string): Record<string, unknown> {
  return JSON.parse(source(`messages/${locale}.json`)).mtmRoutesPage as Record<string, unknown>
}

describe("R3 day-by-day weekly overview contract", () => {
  const planner = source("src/components/mtm/route-planning-matrix.tsx")

  it("renders one responsive list of seven day rows instead of a customer-by-date matrix", () => {
    expect(planner).toContain('period: "7_DAYS"')
    expect(planner).toContain("data.planningDays.map((day, index)")
    expect(planner).toContain('data-testid="mtm-week-day-list"')
    expect(planner).toContain('data-testid={`mtm-week-planner-day-${day.date}`}')
    expect(planner).not.toContain('data-testid="mtm-matrix-desktop-grid"')
    expect(planner).not.toContain('data-testid="mtm-matrix-compact-list"')
  })

  it("shows the weekly route state read-only and sends every edit into the canonical day planner", () => {
    expect(planner).toContain("function openPlannerForDay")
    expect(planner).toContain("onOpenDayPlanner({")
    expect(planner).toContain("routeId: snapshot.routeId")
    expect(planner).toContain('data-testid="mtm-week-planner-open-day"')
    expect(planner).toContain('data-testid="mtm-matrix-candidate"')
    expect(planner).toContain('aria-label={`${t("openDayPlanner")}: ${dayLabel(day.date, locale)}`}')
    expect(planner).toContain('role="status"')
    expect(planner).not.toContain("async function saveWeek")
    expect(planner).not.toContain('method: "PUT"')
    expect(planner).not.toContain('method: "POST"')
    expect(planner).not.toContain("expectedVersion: draft.routeVersion")
    expect(planner).not.toContain("function updateDay")
    expect(planner).not.toContain("nextMtmRouteTimeSlot")
    expect(planner).not.toContain("localDateTimeToUtc")
    expect(planner).not.toContain("MTM_ROUTE_TIME_SLOTS")
    expect(planner).not.toContain('aria-label={t("moveUp")}')
    expect(planner).not.toContain('aria-label={t("moveDown")}')
  })

  it("uses tenant-configured target buttons and server-side search to carry planning context", () => {
    expect(planner).toContain("coerceMtmRouteTargetTypes")
    expect(planner).toContain("settingsResult.data?.routeTargetTypes")
    expect(planner).toContain("enabledTargetTypes.map")
    expect(planner).toContain("routeTargetLabel(target, locale)")
    expect(planner).toContain('query.set("organizationKind"')
    expect(planner).toContain('query.set("search"')
    expect(planner).toContain("data.candidates.slice(0, 60)")
  })

  it("keeps published/conflicting days locked and carries the exact route into the daily editor", () => {
    expect(planner).toContain("day.hasRouteConflict")
    expect(planner).toContain("snapshot.multipleDrafts")
    expect(planner).toContain("snapshot.locked || snapshot.multipleDrafts")
    expect(planner).toContain("function buildDaySnapshot")
    expect(planner).toContain("routeId: route?.id ?? null")
    expect(planner).toContain("if (!canCreateRoutes || !onOpenDayPlanner || snapshot.locked || snapshot.multipleDrafts) return")
  })

  it("retains stable automation hooks and compact coverage evidence", () => {
    expect(planner).toContain('data-testid="mtm-route-planning-matrix"')
    expect(planner).toContain('data-testid="mtm-matrix-agent-select"')
    expect(planner).toContain('data-testid="mtm-matrix-candidate"')
    expect(planner).toContain('data-testid="mtm-matrix-coverage-preview"')
    expect(planner).toContain('data-loaded-agent-id={data?.agent.id ?? ""}')
  })

  it("localizes the complete weekly workflow", () => {
    const keys = [
      "weekPlannerTitle",
      "weekPlannerSubtitle",
      "weekPlannerWeekStarts",
      "weekPlannerDaySummary",
      "weekPlannerDayEmpty",
      "weekPlannerStopsTitle",
      "weekPlannerAddTitle",
      "weekPlannerSearchPlaceholder",
      "weekPlannerReadOnlyHint",
      "weekPlannerOpenDayHint",
    ]
    for (const locale of ["ru", "az", "en"]) {
      const messages = localeKeys(locale)
      for (const key of keys) {
        expect(messages[key], `${locale}.${key} is missing`).toEqual(expect.any(String))
        expect((messages[key] as string).trim(), `${locale}.${key} is empty`).not.toBe("")
      }
    }
  })
})
