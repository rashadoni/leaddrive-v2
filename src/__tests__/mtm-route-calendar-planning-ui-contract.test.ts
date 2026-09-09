import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

describe("MTM calendar-first planning UI contract", () => {
  const page = source("src/app/(dashboard)/mtm/routes/page.tsx")
  const builder = source("src/components/mtm/route-builder.tsx")
  const calendar = source("src/components/mtm/route-calendar.tsx")
  const week = source("src/components/mtm/route-week-plan.tsx")
  const matrix = source("src/components/mtm/route-planning-matrix.tsx")
  const rangeClient = source("src/lib/mtm/route-range-client.ts")

  it("opens on a role-named calendar, keeps team week primary, and groups secondary tools", () => {
    expect(page).toContain('useState<RouteViewMode>("calendar")')
    expect(page).toContain('data-testid="mtm-routes-view-calendar"')
    expect(page).toContain('data-testid="mtm-routes-view-list"')
    expect(page).toContain('data-testid="mtm-routes-view-week"')
    expect(page).toContain('capabilities.canReview ? <Button data-testid="mtm-routes-view-week"')
    expect(page).toContain('capabilities.canReview ? "grid-cols-2" : "grid-cols-1"')
    expect(page.indexOf('data-testid="mtm-routes-more-views-toggle"')).toBeLessThan(
      page.indexOf('data-testid="mtm-routes-view-list"'),
    )
    expect(page).toContain('capabilities.canReview ? "viewTeamCalendar" : "viewMyCalendar"')
    expect(page).toContain('capabilities.canReview ? "controlAndReports" : "routePlanningTools"')
    expect(page).toContain('t(capabilities.canReview ? "viewList" : "viewMyRoutes")')
    expect(page).toContain('t("excelExchange")')
    expect(page).not.toContain('t("moreViewsShort")')
    expect(page).not.toContain('t("excelShort")')
  })

  it("keeps calendar and team views above the fold and uses one status filter model in the list", () => {
    expect(page).toContain('data-testid="mtm-route-header"')
    expect(page).toContain('data-testid="mtm-route-status-filters"')
    expect(page).toContain('role="group" aria-label={t("routeSummary")}')
    expect(page).toContain('aria-pressed={activeFilter === "all"}')
    expect(page).not.toContain('aria-busy={calendarLoading}')
  })

  it("prefills date from the month and date plus employee from the week", () => {
    expect(page).toContain('onCreateRoute={(date) => openNewRoute({ date, returnView: "calendar" })}')
    expect(page).toContain('onCreateRoute={({ date, agentId }) => openNewRoute({ date, agentId, returnView: "week" })}')
    expect(page).toContain("initialDate={editData ? undefined : builderPreset?.date}")
    expect(page).toContain("initialAgentId={editData ? undefined : builderPreset?.agentId}")
    expect(builder).toContain("initialDate?: string")
    expect(builder).toContain("initialAgentId?: string")
    expect(builder).toContain("?? initialAgentId")
    expect(builder).toContain(": initialDate ?? initialPlannerContext?.date ?? dateInputValueInTimezone")
    expect(builder).toContain("const dateWasChosenFromCalendar = Boolean(initialDate && !initialData)")
    expect(builder).toContain('data-testid="mtm-route-calendar-date-confirmation"')
  })

  it("opens planning and details in contextual dialogs instead of moving users elsewhere", () => {
    expect(page).toContain('data-testid="mtm-route-builder-dialog"')
    expect(page).toContain('data-testid="mtm-route-detail-dialog"')
    expect(page).toContain('open={builderOpen}')
    expect(page).toContain('open={selectedRoute !== null}')
    expect(page).toContain("function openRouteDetails(route: MtmRouteRecord)")
    expect(page).toContain("onSelectRoute={openRouteDetails}")
    expect(page).not.toContain("routeBuilderRef.current?.scrollIntoView")
    expect(page).not.toContain("routeDetailsRef.current?.scrollIntoView")
  })

  it("offers an explicit accessible action on empty month and week cells", () => {
    expect(calendar).toContain('data-testid="mtm-route-calendar"')
    expect(calendar).toContain("day.routes.length === 0")
    expect(calendar).toContain("onCreateRoute(key)")
    expect(week).toContain('data-testid="mtm-week-empty-cell-action"')
    expect(week).toContain("onCreateRoute({ date: dateKey(day), agentId: agent.id })")
    expect(week).toContain('className="sticky left-0')
    expect(week).not.toContain("border-l-2")
  })

  it("loads bounded complete ranges instead of silently truncating the visible plan", () => {
    expect(page).toContain("fetchMtmRoutesInRange")
    expect(week).toContain("fetchMtmRoutesInRange")
    expect(rangeClient).toContain("while (routes.length < total)")
    expect(rangeClient).toContain("maximumPages")
    expect(calendar).toContain('role="alert"')
  })

  it("returns to the view that launched the builder", () => {
    expect(page).toContain("const returnView = builderPreset?.returnView ?? viewMode")
    expect(page).toContain("setViewMode(returnView)")
    expect(page).toContain("setBuilderPreset(null)")
  })

  it("remembers a normal view without overriding route or planning deep links", () => {
    expect(page).toContain('leaddrive:mtm:routes:view:')
    expect(page).toContain('window.localStorage.getItem(viewPreferenceKey)')
    expect(page).toContain('window.localStorage.setItem(viewPreferenceKey, viewMode)')
    expect(page).toContain('const requestedViewMode = routeViewMode(searchParams.get("view"))')
    expect(page).toContain('if (requestedRouteId)')
    expect(page).toContain('if (requestedRouteId || requestedViewMode || requestedCustomerId || requestedContactId || requestedPlanningAgentId) return')
    expect(page).toContain('canUseRouteView(requestedViewMode, capabilities.canReview)')
  })

  it("does not leave a grey empty grid cell when filters return an odd candidate count", () => {
    expect(builder).toContain("visibleCandidates.map((candidate, candidateIndex)")
    expect(builder).toContain("candidateIndex === visibleCandidates.length - 1 && visibleCandidates.length % 2 === 1")
    expect(builder).toContain('"sm:col-span-2"')
  })

  it("makes every pre-publish route choice explicitly editable from review", () => {
    expect(builder).toContain('data-testid="mtm-route-edit-setup"')
    expect(builder).toContain('onClick={() => focusStep(1)}')
    expect(builder).toContain('data-testid="mtm-route-edit-customers"')
    expect(builder).toContain('onClick={() => focusStep(2)}')
    expect(builder).toContain('t("reviewEditableHint")')
    expect(builder).toContain('activeStep === 3 ? t("editCustomersAction") : t("backAction")')
  })

  it("keeps route filters simple and makes administrative districts depend on the region", () => {
    expect(builder).toContain("values={candidateRegionOptions}")
    expect(builder).toContain("values={candidateDistrictOptions}")
    expect(builder).toContain("values={candidateOrganizationOptions}")
    expect(builder).toContain('region: value,')
    expect(builder).toContain('administrativeDistrict: "",')
    expect(builder).toContain('disabled={!candidateFilters.region}')
    expect(builder).toContain('allLabel={candidateFilters.region ? t("all") : t("selectRegionFirst")}')
    expect(builder).not.toContain('<CandidateFacetSelect label={t("filterLocality")}')
    expect(builder).not.toContain('<CandidateFacetSelect label={t("filterCityDistrict")}')
    expect(builder).not.toContain('<CandidateFacetSelect label={t("filterOrganizationKind")}')
    expect(builder).not.toContain('label={t("filterOrganizationType")}')
  })

  it("uses one date for a daily route and a separate seven-row weekly planner", () => {
    expect(builder).toContain('<Label htmlFor="route-builder-date">{t("singleRouteDate")} *</Label>')
    expect(builder).not.toContain('data-testid="mtm-route-open-multi-day-planning"')
    expect(builder).not.toContain("onOpenMultiDayPlanning")
    expect(builder).not.toContain('onClick={() => setPeriod(value)}')
    expect(builder).not.toContain('data-testid="mtm-route-planning-day"')
    expect(page).not.toContain("setMatrixPreset")
    expect(page).toContain('setViewMode("matrix")')
    expect(matrix).toContain('data-testid="mtm-week-day-list"')
    expect(matrix).toContain("data.planningDays.map((day, index)")
    expect(matrix).toContain('period: "7_DAYS"')
  })

  it("uses tenant-configurable customer types in both daily and weekly planners", () => {
    expect(builder).toContain("coerceMtmRouteTargetTypes")
    expect(builder).toContain("enabledRouteTargetTypes.map")
    expect(builder).toContain("routeTargetLabel(target, locale)")
    expect(builder).toContain('params.set("organizationKind"')
    expect(matrix).toContain("coerceMtmRouteTargetTypes")
    expect(matrix).toContain("enabledTargetTypes.map")
  })
})
