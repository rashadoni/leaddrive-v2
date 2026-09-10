import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

function routeMessages(locale: string): Record<string, unknown> {
  return JSON.parse(source(`messages/${locale}.json`)).mtmRoutesPage as Record<string, unknown>
}

describe("MTM guided route builder UI contract", () => {
  const builder = source("src/components/mtm/route-builder.tsx")
  // C8 moved the draft key out of the component: one plan is one key, and the
  // rule that decides that had to be testable on its own. The contract below
  // follows it there rather than dropping it.
  const draftStorage = source("src/lib/mtm/route-draft-storage.ts")
  const inlineAssignment = source("src/components/mtm/route-builder-inline-assignment-panel.tsx")
  const assignableCatalog = source("src/app/api/v1/mtm/routes/assignable-catalog/route.ts")
  const routesPage = source("src/app/(dashboard)/mtm/routes/page.tsx")
  const routeCalendar = source("src/components/mtm/route-calendar.tsx")
  const browserEvidence = source("scripts/swissmed-mtm-browser-evidence.mjs")
  const guideOverride = source("video/scenarios/overrides.mjs")
  const guideWorkflow = source(".github/workflows/record-mtm-routes-guide.yml")
  const evidenceSeed = source("scripts/seeds/zeytunpharm-swissmed-evidence.mjs")

  it("exposes a semantic, interactive three-step path and one contextual primary action", () => {
    expect(builder).toContain('aria-label={t("builderProgressLabel")}')
    expect(builder).toContain('aria-current={current ? "step" : undefined}')
    expect(builder).toContain("useState<1 | 2 | 3>(1)")
    expect(builder).toContain("const activeStep = wizardStep")
    expect(builder).toContain("const primaryAction =")
    expect(builder).toContain("function runPrimaryAction()")
    expect(builder).toContain('primaryAction === "continue"')
    expect(builder).toContain('primaryAction === "review"')
    expect(builder).toContain('activeStep === 1 ? (')
    expect(builder).toContain('activeStep === 2 ? (')
    expect(builder).toContain('activeStep === 3 ? (')
    expect(builder).toContain('data-testid="mtm-route-wizard-step-1"')
    expect(builder).toContain('data-testid="mtm-route-wizard-step-2"')
    expect(builder).toContain('data-testid="mtm-route-wizard-step-3"')
    expect(builder).not.toContain("xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.6fr)]")
    expect(builder).toContain("setCustomerPickerOpen(false)")
    expect(builder).toContain("focusStep(setupComplete ? 2 : 1)")
    expect(builder).toContain('aria-describedby="route-builder-next-action"')
    expect(builder).toContain('id="route-builder-next-action"')
    expect(builder).toContain("canPublishFromBuilder && activeStep === 3")
  })

  it("keeps feedback visible and moves failed saves into the accessibility focus order", () => {
    expect(builder).toContain('role="alert"')
    expect(builder).toContain("errorRef.current?.focus()")
    expect(builder).toContain("toast.success")
    expect(builder).toContain('t(routeIdToEdit ? "saveChangesSuccess" : "draftSaveSuccess")')
    expect(builder).toContain('t("publishSuccess")')
  })

  it("autosaves unfinished routes per tenant and user, then offers explicit recovery and undo", () => {
    expect(routesPage).toContain("viewerKey={viewerKey || undefined}")
    expect(builder).toContain("viewerKey?: string")
    expect(builder).toContain("routeDraftStorageKey(draftScope)")
    expect(draftStorage).toContain('"leaddrive:mtm:route-draft"')
    expect(draftStorage).toContain("encodeURIComponent(scope.orgId)")
    expect(draftStorage).toContain("encodeURIComponent(scope.viewerKey)")
    // Older builds wrote a longer key that also carried customer and contact,
    // which is how a newer draft hid behind an older one. Those keys are still
    // on real devices, so the reader must keep finding them.
    expect(draftStorage).toContain("key.startsWith(legacyHead)")
    expect(builder).toContain("schemaVersion: 1")
    expect(builder).toContain("window.localStorage.getItem(draftStorageKey)")
    expect(builder).toContain("window.localStorage.setItem(draftStorageKey")
    expect(builder).toContain("window.localStorage.removeItem(draftStorageKey)")
    expect(builder).toContain('data-testid="mtm-route-draft-recovery"')
    expect(builder).toContain('data-testid="mtm-route-draft-recovered"')
    expect(builder).toContain('data-testid="mtm-route-draft-storage-error"')
    expect(builder).toContain("routeBuilderDraftSignature(storedDraft.form) !== routeBuilderDraftSignature(baselineDraft)")
    expect(builder).toContain("recoverableDraft.routeVersion !== initialData.version")
    expect(builder).toContain("discardLocalDraft({ resetCurrent: true })")
    expect(builder.indexOf("discardLocalDraft()\n      await onSaved(routeId)")).toBeGreaterThan(-1)

    for (const locale of ["ru", "az", "en"]) {
      const messages = routeMessages(locale)
      for (const key of [
        "routeDraftFoundTitle",
        "routeDraftFoundHint",
        "routeDraftStaleTitle",
        "routeDraftStaleHint",
        "restoreRouteDraft",
        "discardRouteDraft",
        "routeDraftRecoveredTitle",
        "routeDraftRecoveredHint",
        "discardRecoveredRouteDraft",
        "routeDraftStorageFailed",
      ]) {
        expect(messages[key], `${locale}.${key} is missing`).toEqual(expect.any(String))
        expect((messages[key] as string).trim(), `${locale}.${key} is empty`).not.toBe("")
      }
    }
  })

  it("shows a time-specific scheduling assistant without leaving the route editor", () => {
    expect(builder).toContain('fetch("/api/v1/mtm/routes/meeting-availability"')
    expect(builder).toContain("agentIds: [primaryAgentId, ...participantIds].filter(Boolean)")
    expect(builder).toContain('data-testid="mtm-route-meeting-assistant"')
    expect(builder).toContain('"mtm-route-meeting-conflict"')
    expect(builder).toContain('"mtm-route-meeting-coordination"')
    expect(builder).toContain('MTM_ROUTE_TIME_SLOTS.map')
    expect(builder).toContain('t("meetingAssistantBusy"')
    expect(builder).toContain('"meetingAssistantTogether"')
    expect(builder).toContain('data-testid="mtm-route-find-next-free-time"')
    expect(builder).toContain("async function findNextAvailableTime(index: number)")

    for (const locale of ["ru", "az", "en"]) {
      const messages = routeMessages(locale)
      for (const key of [
        "meetingAssistantLoading",
        "meetingAssistantBusy",
        "meetingAssistantBusyHint",
        "meetingAssistantTogether",
        "meetingAssistantTogetherContact",
        "meetingAssistantJointHint",
        "findNextFreeTime",
        "findingNextFreeTime",
        "nextFreeTimeApplied",
        "noFreeTimeToday",
        "nextFreeTimeFailed",
      ]) {
        expect(messages[key], `${locale}.${key} is missing`).toEqual(expect.any(String))
        expect((messages[key] as string).trim(), `${locale}.${key} is empty`).not.toBe("")
      }
    }
  })

  it("offers deterministic time filling only while meetings still have empty times", () => {
    expect(builder).toContain("const unscheduledStopCount = stops.filter((stop) => !stop.plannedTime).length")
    expect(builder).toContain("unscheduledStopCount > 0 ? (")
    expect(builder).toContain('data-testid="mtm-route-auto-schedule"')
    expect(builder).toContain('aria-describedby="mtm-route-auto-schedule-hint"')
    expect(builder).toContain('id="mtm-route-auto-schedule-hint"')
    expect(builder).toContain('title={t("autoScheduleStopsHint")}')
    expect(builder).toContain("if (stop.plannedTime) return stop")
    expect(builder).toContain('MTM_ROUTE_TIME_SLOTS.filter((time) => time >= "09:00" && !occupiedTimes.has(time))')
    expect(builder).toContain("availableTimes[availableTimeIndex] ?? null")

    for (const locale of ["ru", "az", "en"]) {
      const messages = routeMessages(locale)
      for (const key of ["autoScheduleStops", "autoScheduleStopsHint"]) {
        expect(messages[key], `${locale}.${key} is missing`).toEqual(expect.any(String))
        expect((messages[key] as string).trim(), `${locale}.${key} is empty`).not.toBe("")
      }
    }
  })

  it("uses touch-safe responsive controls and a mobile-safe persistent action area", () => {
    const actionAreaClasses = builder.match(/data-testid="mtm-route-builder-actions" className="([^"]+)"/)?.[1] ?? ""
    expect(builder).toContain("sm:grid-cols-[auto_minmax(0,1fr)_auto]")
    expect(builder).toContain('className="min-h-11 min-w-11"')
    expect(builder).toContain("env(safe-area-inset-bottom)")
    expect(builder).toContain('data-testid="mtm-route-builder-actions"')
    expect(actionAreaClasses).toContain("sticky")
    expect(actionAreaClasses).toContain("bottom-0")
    expect(actionAreaClasses).not.toContain("backdrop-blur")
    expect(actionAreaClasses).toContain("bg-card")
    expect(builder).toContain('className="hidden min-h-11 sm:inline-flex" data-testid="mtm-route-builder-cancel"')
    expect(builder).toContain('className="min-h-12 min-w-0 flex-1 px-4 text-sm sm:min-w-48 sm:flex-none"')
    expect(builder).toContain('<ChevronLeft className="h-4 w-4 sm:hidden" />')
    expect(builder).toContain('aria-label={t("moveStopUp"')
    expect(builder).toContain('aria-label={locked ? t("stopLocked") : t("removeStopNamed"')
  })

  it("keeps the compact customer workflow in one visible workspace", () => {
    // The width at which the planner stops being a sheet moved from `md`
    // (768) to 900 for task C15 — at the 834 px the audit measured it was
    // opening as a floating card. The number itself, and the fact that all
    // three places agree on it, is pinned by `mtm-planner-fullscreen-tablet`.
    expect(routesPage).toContain('maxHeightClassName="max-h-dvh min-[900px]:max-h-[min(52rem,calc(100dvh-2rem))]"')
    expect(routesPage).toContain("mobileFullscreen")
    expect(routesPage).toContain('mobileFullscreenBreakpoint="tablet"')
    expect(routesPage).toContain('className="min-h-0 overflow-hidden"')
    expect(builder).toContain('className="flex min-h-0 max-h-dvh flex-col overflow-hidden')
    expect(builder).toContain("min-[900px]:max-h-[min(52rem,calc(100dvh-2rem))]")
    expect(routesPage).not.toContain('maxHeightClassName="h-[calc(100dvh-1rem)]')
    expect(builder).toContain("inlineAssignmentOpen && canManageAssignments ?")
    expect(builder).toContain("canManageAssignments && candidateTotal > 0")
    expect(builder).toContain('data-testid="mtm-route-inline-assignment-open-partial"')
    expect(builder).toContain('data-testid="mtm-route-candidate-scope-summary"')
    expect(builder).toContain(
      'candidateScopeMode === "ACTIVE_CATALOG" ? "candidateScopeCatalogSummary" : "candidateScopeAssignedSummary"',
    )
    expect(builder).toContain('data-testid="mtm-route-candidate-scope-explanation"')
    expect(builder).toContain(
      'candidateScopeMode === "ACTIVE_CATALOG" ? "candidateScopeCatalogHint" : "candidateScopeAssignedHint"',
    )
    expect(builder).toContain('candidateScopeMode === "ACTIVE_CATALOG"')
    expect(builder).toContain('t("candidateCatalogEmptyHint"')
    expect(builder).toContain('t("candidateAssignmentEmptyHint"')
    expect(builder).toContain('t("candidateScopeDenied")')
    expect(builder).toContain('data-testid="mtm-route-candidate-availability"')
    expect(builder).toContain('candidate.availability.source === "DIRECT_CONTACT_ASSIGNMENT"')
    expect(builder).toContain('candidate.availability.source === "WORKPLACE_ASSIGNMENT"')
    expect(builder).toContain('candidate.availability.source === "ORGANIZATION_ASSIGNMENT"')
    expect(builder).toContain(': t("candidateAvailabilityCatalog")')
    expect(builder).toContain('t("addCandidateShort")')
    expect(inlineAssignment).toContain('limit: "8"')
    expect(inlineAssignment).not.toContain("max-h-[min(34dvh,18rem)]")
  })

  it("exposes route cards and calendar entries as visible keyboard actions", () => {
    expect(routesPage).toContain('t("viewRoute")')
    expect(routesPage).toContain('aria-label={t("openRouteDetails"')
    expect(routesPage).toContain('aria-label={t("closeRouteDetails")}')
    expect(routeCalendar).toContain('aria-label={t("previousMonth")}')
    expect(routeCalendar).toContain('aria-label={t("nextMonth")}')
    expect(routeCalendar).toContain('onClick={() => onSelectRoute(route)}')
    expect(routesPage).toContain('data-testid="mtm-route-toolbar"')
    expect(routesPage).toContain('data-testid="mtm-route-view-switcher"')
    expect(routesPage).toContain("grid-cols-2")
    expect(routesPage).toContain('capabilities.canReview ? "grid-cols-2" : "grid-cols-1"')
    expect(routesPage).toContain("md:flex-row")
    expect(routesPage).toContain("whitespace-nowrap")
    expect(routesPage).toContain('capabilities.canReview ? "controlAndReports" : "routePlanningTools"')
    expect(routesPage).toContain('t(capabilities.canReview ? "viewList" : "viewMyRoutes")')
    expect(routesPage.indexOf('data-testid="mtm-routes-more-views-toggle"')).toBeLessThan(
      routesPage.indexOf('data-testid="mtm-routes-view-list"'),
    )
    expect(routesPage).toContain('t("excelExchange")')
    expect(routesPage).not.toContain("xl:flex-nowrap")
    expect(routesPage).not.toContain("overflow-x-auto border border-zinc-200")
    expect(routeCalendar).toContain('data-testid="mtm-mobile-calendar-agenda"')
    expect(routesPage).not.toContain('className="hidden sm:inline"')
    expect(routesPage).not.toContain('min-w-[42rem]')
    expect(routesPage).not.toContain('cursor-pointer hover:border-primary/40 transition-colors" onClick={() => setSelectedRoute(route)}')
  })

  it("localizes every guided-flow action in RU, AZ, and EN", () => {
    const keys = [
      "builderProgressLabel",
      "progressWhoWhen",
      "progressCustomers",
      "progressSave",
      "prefillLoading",
      "prefillSuccessTitle",
      "prefillSuccessHint",
      "customersSelected",
      "addAnotherCustomer",
      "finishAddingCustomers",
      "continueToCustomers",
      "reviewRouteAction",
      "backAction",
      "customerPickerBlockedTitle",
      "candidateAssignmentAgentHint",
      "candidateScopeSummary",
      "candidateScopeAssignedSummary",
      "candidateScopeCatalogSummary",
      "candidateScopeWhyTitle",
      "candidateScopeWhyHint",
      "candidateScopeAssignedHint",
      "candidateScopeCatalogHint",
      "candidateScopeDenied",
      "candidateScopeWhyCatalogNote",
      "candidateSearchEmptyHint",
      "candidateFiltersEmptyHint",
      "candidateAssignmentEmptyHint",
      "candidateCatalogEmptyHint",
      "candidateAvailabilityDirectContact",
      "candidateAvailabilityWorkplace",
      "candidateAvailabilityOrganization",
      "candidateAvailabilityCatalog",
      "candidateAvailabilityPeriod",
      "candidateAvailabilityOpenEnded",
      "candidateAvailabilityCatalogHint",
      "addCandidateShort",
      "addCandidateAction",
      "planningTools",
      "viewMyCalendar",
      "viewTeamCalendar",
      "routePlanningTools",
      "controlAndReports",
      "chooseEmployeeAction",
      "chooseDateAction",
      "routeSetupRequiredHint",
      "addRouteStopAction",
      "inlineAssignmentRecoveryHint",
      "inlineAssignmentOpenAction",
      "inlineAssignmentTitle",
      "inlineAssignmentDescription",
      "inlineAssignmentSearchLabel",
      "inlineAssignmentSearchPlaceholder",
      "inlineAssignmentNoResults",
      "inlineAssignmentTransferHint",
      "inlineAssignmentConfirmTransfer",
      "nextActionTitle",
      "readyToSaveTitle",
      "nextFinishCustomersHint",
      "draftSaveSuccess",
      "saveChangesSuccess",
      "moveStopUp",
      "moveStopDown",
      "removeStopNamed",
      "viewRoute",
      "openRouteDetails",
      "closeRouteDetails",
      "previousMonth",
      "nextMonth",
      "pointStatusPending",
      "pointStatusVisited",
      "pointStatusSkipped",
      "pointStatusUnknown",
      "calendarTitle",
      "calendarHint",
      "todayAction",
      "planRoute",
      "planRouteOnDate",
      "planRouteForAgentOnDate",
      "weekPlanTitle",
      "weekPlanHint",
      "calendarLoadFailed",
      "routeAssignmentNextHint",
      "routeAssignmentNextAction",
      "selfPlanningDisabled",
      "moreViewsShort",
      "viewList",
      "viewMyRoutes",
      "excelShort",
      "selectedCalendarDate",
      "selectedCalendarDateHint",
      "autoScheduleStops",
      "autoScheduleStopsHint",
      "findNextFreeTime",
      "findingNextFreeTime",
      "nextFreeTimeApplied",
      "noFreeTimeToday",
      "nextFreeTimeFailed",
      "routeDraftFoundTitle",
      "routeDraftFoundHint",
      "routeDraftStaleTitle",
      "routeDraftStaleHint",
      "restoreRouteDraft",
      "discardRouteDraft",
      "routeDraftRecoveredTitle",
      "routeDraftRecoveredHint",
      "discardRecoveredRouteDraft",
      "routeDraftStorageFailed",
    ]

    for (const locale of ["ru", "az", "en"]) {
      const messages = routeMessages(locale)
      for (const key of keys) {
        expect(messages[key], `${locale}.${key} is missing`).toEqual(expect.any(String))
        expect((messages[key] as string).trim(), `${locale}.${key} is empty`).not.toBe("")
      }
    }
  })

  it("keeps the daily meeting flow focused and leaves weekly planning in its own view", () => {
    expect(builder).toContain('data-testid="mtm-route-calendar-date-confirmation"')
    expect(builder).toContain("data-route-target-direction={target.direction}")
    expect(builder).not.toContain("mtm-route-open-multi-day-planning")
    expect(builder).not.toContain("planSeveralDays")
    expect(routesPage).toContain('data-testid="mtm-routes-view-matrix"')
  })

  it("keeps the recovery path inside the route builder when no customer is available", () => {
    expect(builder).toContain(': primaryAgentId ? (')
    expect(builder).toContain('canManageAssignments && candidateScopeMode === "AGENT_ASSIGNMENTS"')
    expect(builder).toContain('data-testid="mtm-route-inline-assignment-open"')
    expect(builder).toContain("RouteBuilderInlineAssignmentPanel")
    expect(builder).toContain("onAssigned={addInlineAssignedCandidate}")
    expect(builder).not.toContain("mtmRouteAssignmentCatalogHref")
    expect(builder).not.toContain("routeAssignmentHref")
    expect(builder).not.toContain("next/link")
    expect(builder).toContain('focusStep(setupComplete ? 2 : 1)')
    expect(inlineAssignment).toContain('fetch("/api/v1/mtm/field-assignments"')
    expect(inlineAssignment).toContain("onAssigned(candidate)")
    expect(inlineAssignment).toContain('data-testid="mtm-route-inline-assignment-item"')
    expect(inlineAssignment).toContain('data-testid="mtm-route-inline-assignment-add"')
  })

  it("proves and records inline assignment before the detailed Azerbaijani guide", () => {
    for (const contract of [browserEvidence, guideOverride, evidenceSeed]) {
      expect(contract).toContain("QA-SWM-UNASSIGNED-CLINIC")
    }
    expect(browserEvidence).toContain("assignRouteGuideInlineCustomer(page)")
    expect(browserEvidence).toContain("candidateVisible || assignmentRecoveryVisible")
    expect(browserEvidence).toContain("await existingCandidate.click()")
    expect(browserEvidence).toContain("plannedTimes.length !== 3")
    expect(browserEvidence).toContain("uniquePlannedTimes.size !== plannedTimes.length")
    expect(browserEvidence).toContain("(?:00|30)")
    expect(guideOverride).toContain("assignRouteGuideInlineCustomer(p, h)")
    expect(guideOverride).toContain("candidateVisible || assignmentRecoveryVisible")
    expect(guideWorkflow).toContain("Reset dedicated QA fixtures after preflight for a clean recording")
  })

  it("keeps inline assignment tenant-scoped, manager-only, and route-scope checked", () => {
    expect(assignableCatalog).toContain('withRouteFieldRlsAuth("read"')
    expect(assignableCatalog).toContain("canManageFieldMasterData(actor)")
    expect(assignableCatalog).toContain("isAgentInRouteScope(actor, agentId)")
    expect(assignableCatalog).toContain("contactScopeForActor(actor, authorizationDate)")
    expect(assignableCatalog).toContain("customerScopeForActor(actor, authorizationDate)")
    expect(assignableCatalog).toContain("organizationId: auth.orgId")
  })
})
