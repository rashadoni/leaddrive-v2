import { mkdir, writeFile } from "node:fs/promises"
import { chromium } from "playwright"
import {
  consoleErrorBucket,
  findQaLiveAgentId,
  findQaPromotionReviewExecutionId,
  isProductionEvidenceTarget,
} from "./swissmed-mtm-evidence-helpers.mjs"

const baseURL = (process.env.MTM_EVIDENCE_BASE_URL || "").replace(/\/$/, "")
const baseOrigin = baseURL ? new URL(baseURL).origin : ""

function isNonBlockingTelemetryResponse({ method, url }) {
  return method === "POST" && url === "/api/v1/public/csp-report"
}

const organizationSlug = process.env.MTM_EVIDENCE_ORG_SLUG || "leaddrive"
const outputDirectory = process.env.MTM_EVIDENCE_OUTPUT_DIR || "artifacts/swissmed-mtm"
const selectedRoles = new Set(
  (process.env.MTM_EVIDENCE_ROLES || "admin,agent")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
)
const selectedViewports = new Set(
  (process.env.MTM_EVIDENCE_VIEWPORTS || "desktop,tablet,tablet-landscape,phone")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
)
const scenarioBatchName = process.env.MTM_EVIDENCE_SCENARIO_BATCH || "all"
const scenarioBatches = {
  planning: new Set([
    "SWM-18", "SWM-16", "SWM-17", "SWM-15", "SWM-14",
    "SWM-10", "SWM-11", "SWM-13", "SWM-02",
  ]),
  records: new Set([
    "SWM-07", "SWM-09", "SWM-12", "SWM-08", "SWM-06",
    "SWM-04", "SWM-05", "SWM-03", "SWM-01",
  ]),
  "routes-guide": new Set([
    "GUIDE-ROUTES",
  ]),
}
const selectedScenarioIds = scenarioBatchName === "all"
  ? null
  : scenarioBatches[scenarioBatchName]

const roles = [
  {
    key: "admin",
    email: process.env.MTM_EVIDENCE_ADMIN_EMAIL || "",
    password: process.env.MTM_EVIDENCE_ADMIN_PASSWORD || "",
  },
  {
    key: "agent",
    email: process.env.MTM_EVIDENCE_AGENT_EMAIL || "",
    password: process.env.MTM_EVIDENCE_AGENT_PASSWORD || "",
  },
].filter((role) => selectedRoles.has(role.key))

const viewports = {
  desktop: { width: 1440, height: 1000 },
  tablet: { width: 1024, height: 1366 },
  "tablet-landscape": { width: 1180, height: 820 },
  phone: { width: 390, height: 844 },
}
const tabletViewportNames = new Set(["tablet", "tablet-landscape"])

// SWM-09 is the reviewer approval surface from the reference image. Field
// agents cannot review by contract, so that scenario is intentionally admin-only.
const agentScenarios = new Set([
  "SWM-03",
  "SWM-04",
  "SWM-05",
  "SWM-06",
  "SWM-07",
  "SWM-10",
  "SWM-11",
  "SWM-14",
  "SWM-17",
])

const routeGuideProofName = "[QA-SWISSMED] Route guide browser proof"
const routeGuideInlineCode = "QA-SWM-UNASSIGNED-CLINIC"
const routeGuideInlineName = "[QA-SWISSMED] Unassigned Clinic"

function addDaysToDateKey(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function calendarMonthDistance(fromDateKey, toDateKey) {
  const from = new Date(`${fromDateKey}T00:00:00.000Z`)
  const to = new Date(`${toDateKey}T00:00:00.000Z`)
  return ((to.getUTCFullYear() - from.getUTCFullYear()) * 12) + to.getUTCMonth() - from.getUTCMonth()
}

async function openRouteGuideFromCalendar(page, todayDate, guideDate) {
  const calendar = page.getByTestId("mtm-route-calendar")
  await calendar.waitFor({ state: "visible" })

  const monthDistance = calendarMonthDistance(todayDate, guideDate)
  const monthAction = monthDistance >= 0
    ? page.getByTestId("mtm-route-calendar-next-month")
    : page.getByTestId("mtm-route-calendar-previous-month")
  for (let offset = 0; offset < Math.abs(monthDistance); offset += 1) {
    await monthAction.click()
  }

  const targetDay = calendar.locator(
    `[data-route-calendar-date="${guideDate}"][data-current-month="true"]:visible`,
  )
  await targetDay.waitFor({ state: "visible" })
  const isMobileCalendar = await targetDay.evaluate((element) => element.tagName === "BUTTON")

  if (isMobileCalendar) {
    await targetDay.click()
    await page.getByTestId("mtm-route-calendar-plan-selected").click()
  } else {
    await targetDay.getByTestId("mtm-route-calendar-plan").click()
  }

  const dateConfirmation = page.getByTestId("mtm-route-calendar-date-confirmation")
  await dateConfirmation.waitFor({ state: "visible" })
  if (await page.locator("#route-builder-date").count()) {
    throw new Error("guide_route_calendar_date_was_asked_twice")
  }
}

async function removeRouteGuideProofDrafts(page, date) {
  const result = await page.evaluate(async ({ guideDate, guideName }) => {
    const listResponse = await fetch(`/api/v1/mtm/routes?date=${encodeURIComponent(guideDate)}&limit=50`)
    const listPayload = await listResponse.json().catch(() => null)
    if (!listResponse.ok || !Array.isArray(listPayload?.data?.routes)) {
      return { ok: false, reason: `guide_route_list_failed_${listResponse.status}` }
    }

    const matches = listPayload.data.routes.filter((route) => route?.name === guideName)
    const nonDraft = matches.find((route) => route?.status !== "DRAFT")
    if (nonDraft) {
      return { ok: false, reason: `guide_route_unexpected_status_${nonDraft.status}` }
    }

    for (const route of matches) {
      const deleteResponse = await fetch(`/api/v1/mtm/routes/${encodeURIComponent(route.id)}`, { method: "DELETE" })
      if (!deleteResponse.ok) return { ok: false, reason: `guide_route_cleanup_failed_${deleteResponse.status}` }
    }
    return { ok: true, removed: matches.length }
  }, { guideDate: date, guideName: routeGuideProofName })
  if (!result?.ok) throw new Error(result?.reason || "guide_route_cleanup_failed")
}

function routeCandidateResponse(response, { agentId, direction, startDate }) {
  const url = new URL(response.url())
  return response.ok()
    && url.pathname === "/api/v1/mtm/routes/candidates"
    && url.searchParams.get("agentId") === agentId
    && url.searchParams.get("direction") === direction
    && url.searchParams.get("startDate") === startDate
}

async function assignRouteGuideInlineCustomer(page) {
  const customerSearch = page.locator("#route-builder-customer-search")
  await customerSearch.fill(routeGuideInlineCode)

  // The dedicated guide customer may already be assigned by an earlier
  // acceptance run. In that case the current UX shows it directly in the
  // candidate list, so select it instead of waiting for the recovery action
  // that is intentionally rendered only for an empty result set.
  await page.waitForFunction(({ candidateName }) => {
    const candidateVisible = [...document.querySelectorAll('[data-testid="mtm-route-candidate"]')]
      .some((element) => element.textContent?.includes(candidateName))
    const assignmentRecoveryVisible = document.querySelector('[data-testid="mtm-route-inline-assignment-open"]')
    return candidateVisible || assignmentRecoveryVisible
  }, { candidateName: routeGuideInlineName })

  const existingCandidate = page.getByTestId("mtm-route-candidate")
    .filter({ hasText: routeGuideInlineName })
    .first()
  if (await existingCandidate.isVisible()) {
    await existingCandidate.click()
    await customerSearch.fill("")
    return
  }

  const openAssignment = page.getByTestId("mtm-route-inline-assignment-open")
  await openAssignment.click()

  const panel = page.getByTestId("mtm-route-inline-assignment")
  await panel.waitFor({ state: "visible" })
  await panel.locator("#route-inline-assignment-search").fill(routeGuideInlineCode)
  const item = panel.getByTestId("mtm-route-inline-assignment-item")
    .filter({ hasText: routeGuideInlineName })
    .first()
  await item.waitFor({ state: "visible" })

  const assigned = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === "PUT" && url.pathname === "/api/v1/mtm/field-assignments"
  })
  await item.getByTestId("mtm-route-inline-assignment-add").click()
  const assignmentResponse = await assigned
  if (!assignmentResponse.ok()) {
    throw new Error(`guide_route_inline_assignment_failed_${assignmentResponse.status()}`)
  }
  await panel.waitFor({ state: "hidden" })
  await customerSearch.fill("")
}

const scenarios = [
  {
    id: "GUIDE-ROUTES",
    name: "Routes guide end-to-end draft proof",
    path: (resources) => resources.agentId ? "/mtm/routes?view=calendar" : null,
    fallbackPath: "/mtm/routes",
    missingReason: (resources) => resources.resourceProbeError || "qa_route_guide_agent_missing",
    prepare: async (page, resources) => {
      const guideDate = addDaysToDateKey(resources.todayDate, 35)
      let createdRouteId = null

      await removeRouteGuideProofDrafts(page, guideDate)
      try {
        await openRouteGuideFromCalendar(page, resources.todayDate, guideDate)
        const builder = page.getByTestId("mtm-route-builder")
        await builder.waitFor({ state: "visible" })

        await page.locator("#route-builder-primary").selectOption(resources.agentId)

        await page.getByTestId("mtm-route-optional-settings").locator("summary").click()
        await page.locator("#route-builder-name").fill(routeGuideProofName)

        // The simplified wizard deliberately does not load candidates while
        // step 1 is active. Opening step 2 mounts the customer picker and is
        // therefore the action that starts the first candidates request.
        const organizationCandidatesReady = page.waitForResponse((response) => routeCandidateResponse(response, {
          agentId: resources.agentId,
          direction: "ORGANIZATION",
          startDate: guideDate,
        }))
        await page.getByTestId("mtm-route-primary-action").click()
        await page.getByTestId("mtm-route-customer-picker").waitFor({ state: "visible" })
        await organizationCandidatesReady

        await assignRouteGuideInlineCustomer(page)

        const doctorsReady = page.waitForResponse((response) => routeCandidateResponse(response, {
          agentId: resources.agentId,
          direction: "DOCTOR",
          startDate: guideDate,
        }))
        await page.locator('[data-route-target-direction="DOCTOR"]').first().click()
        await doctorsReady
        await page.getByTestId("mtm-route-candidate").first().waitFor({ state: "visible" })
        await page.getByTestId("mtm-route-candidate").first().click()

        const pharmaciesReady = page.waitForResponse((response) => routeCandidateResponse(response, {
          agentId: resources.agentId,
          direction: "PHARMACY",
          startDate: guideDate,
        }))
        await page.locator('[data-route-target-direction="PHARMACY"]').first().click()
        await pharmaciesReady
        await page.getByTestId("mtm-route-candidate").first().waitFor({ state: "visible" })
        await page.getByTestId("mtm-route-candidate").first().click()

        await page.getByTestId("mtm-route-primary-action").click()
        await page.getByTestId("mtm-route-customer-picker").waitFor({ state: "hidden" })
        await page.getByTestId("mtm-route-auto-schedule").click()
        await page.getByTestId("mtm-route-stop-0").waitFor({ state: "visible" })
        await page.getByTestId("mtm-route-stop-1").waitFor({ state: "visible" })
        await page.getByTestId("mtm-route-stop-2").waitFor({ state: "visible" })
        const plannedTimes = await page.locator('[data-testid^="mtm-route-stop-time-"]').evaluateAll((inputs) => inputs.map((input) => input.value))
        const uniquePlannedTimes = new Set(plannedTimes)
        const hasInvalidSlot = plannedTimes.some((value) => !/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(value))
        if (plannedTimes.length !== 3 || uniquePlannedTimes.size !== plannedTimes.length || hasInvalidSlot) {
          throw new Error("guide_route_auto_schedule_not_applied")
        }

        const draftCreated = page.waitForResponse((response) => {
          const url = new URL(response.url())
          return response.request().method() === "POST" && url.pathname === "/api/v1/mtm/routes"
        })
        await page.getByTestId("mtm-route-save-draft").click()
        const createResponse = await draftCreated
        const createPayload = await createResponse.json().catch(() => null)
        if (!createResponse.ok() || typeof createPayload?.data?.id !== "string") {
          throw new Error(`guide_route_draft_create_failed_${createResponse.status()}`)
        }
        createdRouteId = createPayload.data.id
        await builder.waitFor({ state: "hidden" })
      } finally {
        await removeRouteGuideProofDrafts(page, guideDate)
      }

      if (!createdRouteId) throw new Error("guide_route_draft_id_missing")
    },
  },
  {
    id: "SWM-18",
    name: "Day-by-day weekly route planning",
    path: (resources) => resources.agentId ? "/mtm/routes" : null,
    fallbackPath: "/mtm/routes",
    prepare: async (page, resources) => {
      const matrixView = page.getByTestId("mtm-routes-view-matrix")
      if (!await matrixView.isVisible()) {
        await page.getByTestId("mtm-routes-more-views-toggle").click()
      }
      await matrixView.click()
      await page.getByTestId("mtm-route-planning-matrix").waitFor({ state: "visible" })
      await page.getByTestId("mtm-matrix-agent-select").selectOption(resources.agentId)
      await page.locator(`[data-testid="mtm-route-planning-matrix"][data-loaded-agent-id="${resources.agentId}"]`).waitFor({ state: "visible" })
      await page.locator('[data-testid="mtm-matrix-candidate"]:visible').first().waitFor({ state: "visible" })
    },
  },
  {
    id: "SWM-16",
    name: "Filter-led visit planning",
    path: (resources) => resources.agentId ? "/mtm/routes" : null,
    fallbackPath: "/mtm/routes",
    prepare: async (page, resources) => {
      await page.getByTestId("mtm-route-builder-open").click()
      await page.getByTestId("mtm-route-builder").waitFor({ state: "visible" })
      await page.locator("#route-builder-primary").selectOption(resources.agentId)
      await page.locator("#route-builder-date").fill(resources.todayDate)
      const candidatesReady = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return response.ok()
          && url.pathname === "/api/v1/mtm/routes/candidates"
          && url.searchParams.get("agentId") === resources.agentId
      })
      await page.getByTestId("mtm-route-primary-action").click()
      await candidatesReady
      await page.locator('[data-testid="mtm-route-candidate"]:visible').first().waitFor({ state: "visible" })
    },
  },
  {
    id: "SWM-17",
    name: "Weekly operational home",
    path: (resources) => resources.agentId
      ? `/mtm?weekAgentId=${encodeURIComponent(resources.agentId)}`
      : null,
    fallbackPath: "/mtm",
    waitFor: "[data-testid=mtm-operational-week]",
  },
  {
    id: "SWM-15",
    name: "Coverage, cancellation queue and active tasks",
    path: (resources) => resources.agentId
      ? `/mtm?weekAgentId=${encodeURIComponent(resources.agentId)}`
      : null,
    fallbackPath: "/mtm",
    waitFor: "[data-testid=mtm-operational-week]",
    prepare: async (page) => {
      const coverage = page.locator('[data-testid^="mtm-swm15-coverage-"]:visible')
      await coverage.waitFor({ state: "visible" })
      await coverage.scrollIntoViewIfNeeded()
    },
  },
  {
    id: "SWM-14",
    name: "Full task card and recurrence",
    path: (resources) => resources.taskId ? "/mtm/tasks/" + encodeURIComponent(resources.taskId) : null,
    fallbackPath: "/mtm/tasks",
    waitFor: "[data-testid=mtm-task-workspace] [data-testid=mtm-task-recurrence]",
  },
  {
    id: "SWM-10",
    name: "GPS history and stop detail",
    path: (resources) => resources.agentId
      ? `/mtm/map?mode=history&agentId=${encodeURIComponent(resources.agentId)}&date=${encodeURIComponent(resources.evidenceDate)}`
      : null,
    fallbackPath: "/mtm/map?mode=history",
    waitFor: "[data-testid=mtm-location-history-results]",
  },
  {
    id: "SWM-11",
    name: "Actual day replay",
    path: (resources) => resources.agentId
      ? `/mtm/map?mode=history&agentId=${encodeURIComponent(resources.agentId)}&date=${encodeURIComponent(resources.evidenceDate)}`
      : null,
    fallbackPath: "/mtm/map?mode=history",
    waitFor: "[data-testid=mtm-location-history-replay]",
    prepare: async (page) => {
      const play = page.getByTestId("mtm-location-history-play")
      if (await play.isEnabled()) {
        await play.click()
        await page.waitForTimeout(600)
      }
    },
  },
  {
    id: "SWM-13",
    name: "Plan and GPS KPI",
    path: () => "/mtm/analytics",
    waitFor: "[data-testid=mtm-explainable-kpi][data-state=ready]",
  },
  {
    id: "SWM-02",
    name: "Bulk contact transfer",
    path: (resources) => resources.agentId
      ? `/mtm/contacts?ownerAgentId=${encodeURIComponent(resources.agentId)}`
      : null,
    fallbackPath: "/mtm/contacts",
    prepare: async (page, resources) => {
      await page.locator(`[data-testid="mtm-contact-select-${resources.contactId}"]:visible`).check()
      await page.getByTestId("mtm-contact-transfer-open").click()
      await page.getByTestId("mtm-contact-transfer-dialog").waitFor({ state: "visible" })
    },
  },
  {
    id: "SWM-07",
    name: "My organizations",
    path: () => "/mtm/customers?scope=MINE",
    waitFor: "[data-testid=mtm-organization-explorer][data-effective-scope=MINE][aria-busy=false]",
  },
  {
    id: "SWM-09",
    name: "Pharmacy promotion and approval",
    path: (resources) => resources.promotionReviewExecutionId
      ? "/mtm/promotions?view=registry&q=" + encodeURIComponent("[QA-SWISSMED]")
        + "&employeeId=" + encodeURIComponent(resources.agentId)
        + "&pageSize=100"
      : null,
    fallbackPath: "/mtm/promotions",
    missingReason: (resources) => resources.resourceProbeError || resources.promotionProbeError || "qa_reviewable_pharmacy_promotion_missing",
    waitFor: "[data-testid=mtm-pharmacy-promotions][aria-busy=false]",
    prepare: async (page, resources, viewportName) => {
      if (viewportName === "tablet-landscape") {
        const masterDetail = page.getByTestId("mtm-pharmacy-tablet-master-detail")
        await masterDetail.waitFor({ state: "visible" })
        const qaRow = page.getByTestId(`mtm-pharmacy-tablet-row-${resources.promotionReviewExecutionId}`)
        await qaRow.waitFor({ state: "visible" })
        await qaRow.getByRole("button").click()
        await page.getByTestId("mtm-pharmacy-tablet-inspector").waitFor({ state: "visible" })
        const exactInspector = page.locator(`[data-testid="mtm-pharmacy-tablet-inspector"][data-execution-id="${resources.promotionReviewExecutionId}"]`)
        await exactInspector.waitFor({ state: "visible" })

        await page.getByTestId("mtm-pharmacy-column-chooser").click()
        const sourceColumn = page.getByTestId("mtm-pharmacy-column-source")
        await sourceColumn.waitFor({ state: "visible" })
        await sourceColumn.click()
        await page.waitForFunction(() => {
          const columns = new URLSearchParams(window.location.search).get("columns")?.split(",") ?? []
          return columns.length > 0 && !columns.includes("source")
        })
        await exactInspector.locator('[data-testid="mtm-pharmacy-tablet-source-facts"][data-source-visible="false"]').waitFor({ state: "visible" })

        await page.reload({ waitUntil: "domcontentloaded" })
        await page.locator("[data-testid=mtm-pharmacy-promotions][aria-busy=false]").waitFor({ state: "visible" })
        const restoredRow = page.getByTestId(`mtm-pharmacy-tablet-row-${resources.promotionReviewExecutionId}`)
        await restoredRow.waitFor({ state: "visible" })
        await restoredRow.getByRole("button").click()
        const restoredInspector = page.locator(`[data-testid="mtm-pharmacy-tablet-inspector"][data-execution-id="${resources.promotionReviewExecutionId}"]`)
        await restoredInspector.locator('[data-testid="mtm-pharmacy-tablet-source-facts"][data-source-visible="false"]').waitFor({ state: "visible" })
        await page.getByTestId("mtm-pharmacy-column-chooser").click()
        await page.getByTestId("mtm-pharmacy-column-source").click()
        await page.waitForFunction(() => new URLSearchParams(window.location.search).get("columns")?.split(",").includes("source") === true)
        await restoredInspector.locator('[data-testid="mtm-pharmacy-tablet-source-facts"][data-source-visible="true"]').waitFor({ state: "visible" })
        await page.keyboard.press("Escape")
        await page.locator(`[data-testid="mtm-pharmacy-review-${resources.promotionReviewExecutionId}"]:visible`).first().waitFor({ state: "visible" })
        return
      }
      if (viewportName === "tablet") {
        const originalUrl = page.url()
        const advancedFilters = page.getByTestId("mtm-pharmacy-advanced-filters")
        await advancedFilters.click()
        await page.getByTestId("mtm-pharmacy-filter-sheet").waitFor({ state: "visible" })
        await page.getByTestId("mtm-pharmacy-filter-scroll").evaluate((element) => { element.scrollTop = element.scrollHeight })
        await page.getByTestId("mtm-pharmacy-filter-apply").click()
        await page.getByTestId("mtm-pharmacy-filter-sheet").waitFor({ state: "hidden" })

        await advancedFilters.click()
        await page.getByTestId("mtm-pharmacy-filter-reset").click()
        await page.getByTestId("mtm-pharmacy-filter-sheet").waitFor({ state: "hidden" })

        await page.goto(originalUrl, { waitUntil: "domcontentloaded" })
        await page.locator("[data-testid=mtm-pharmacy-promotions][aria-busy=false]").waitFor({ state: "visible" })
        await page.getByTestId("mtm-pharmacy-advanced-filters").click()
        await page.getByTestId("mtm-pharmacy-filter-sheet").waitFor({ state: "visible" })
        await page.getByTestId("mtm-pharmacy-filter-scroll").evaluate((element) => { element.scrollTop = element.scrollHeight })
        return
      }
      const reviewButton = page.locator(`[data-testid="mtm-pharmacy-review-${resources.promotionReviewExecutionId}"]:visible`).first()
      await reviewButton.waitFor({ state: "visible" })
      await reviewButton.click()
      await page.getByTestId("mtm-pharmacy-review-dialog").waitFor({ state: "visible" })
    },
  },
  {
    id: "SWM-12",
    name: "Live team map",
    path: (resources) => resources.liveAgentId ? "/mtm/map" : null,
    fallbackPath: "/mtm/map",
    missingReason: (resources) => resources.resourceProbeError || resources.liveProbeError || "qa_live_agent_coordinate_missing",
    waitFor: "[data-testid=mtm-live-map-canvas][data-ready=true] .leaflet-container",
    prepare: async (page, resources) => {
      const filteredRosterReady = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return response.ok()
          && url.pathname === "/api/v1/mtm/locations"
          && url.searchParams.get("employee") === "[QA-SWISSMED] Field Agent"
      })
      await page.getByTestId("mtm-map-employee-filter").fill("[QA-SWISSMED] Field Agent")
      await filteredRosterReady
      await page.waitForFunction((agentId) => {
        const canvas = document.querySelector("[data-testid=mtm-live-map-canvas][data-ready=true]")
        return (canvas?.getAttribute("data-rendered-agent-ids") || "")
          .split(",")
          .includes(agentId)
      }, resources.liveAgentId, { timeout: 30_000 })
    },
  },
  {
    id: "SWM-08",
    name: "Dense organization grid",
    path: () => "/mtm/customers?scope=ALL",
    prepare: async (page, _resources, viewportName) => {
      if (viewportName === "phone") {
        await page.getByTestId("mtm-organization-card").first().waitFor({ state: "visible" })
        return
      }
      const gridSettings = page.getByTestId("mtm-organization-grid-settings")
      await gridSettings.click()
      await page.getByTestId("mtm-organization-density-compact").click()
      await gridSettings.click()
      await page.locator('[data-density="COMPACT"]').waitFor({ state: "visible" })
      const gridScroll = page.getByTestId("mtm-organization-grid-scroll")
      const exposure = await gridScroll.evaluate(async (element) => {
        const target = element.querySelector('[data-column="lastVisit"]')
        const organization = element.querySelector('[data-column="organization"]')
        const actions = element.querySelector('[data-column="actions"]')
        if (!(target instanceof HTMLElement)) throw new Error("swm08_last_visit_column_missing")
        if (!(organization instanceof HTMLElement)) throw new Error("swm08_organization_column_missing")
        const scrollerBefore = element.getBoundingClientRect()
        const organizationBefore = organization.getBoundingClientRect()
        const desiredLeft = Math.max(0, organizationBefore.right - scrollerBefore.left + 8)
        element.scrollLeft = Math.max(0, Math.min(
          element.scrollWidth - element.clientWidth,
          target.offsetLeft - desiredLeft,
        ))
        await new Promise((resolve) => requestAnimationFrame(() => resolve()))
        const scroller = element.getBoundingClientRect()
        const organizationRect = organization.getBoundingClientRect()
        const targetRect = target.getBoundingClientRect()
        const actionsRect = actions instanceof HTMLElement ? actions.getBoundingClientRect() : null
        const actionsSticky = actions instanceof HTMLElement && getComputedStyle(actions).position === "sticky"
        const visibleRight = actionsSticky && actionsRect ? actionsRect.left : scroller.right
        return {
          leftVisible: targetRect.left >= organizationRect.right + 4,
          rightVisible: targetRect.right <= visibleRight - 4,
        }
      })
      if (!exposure.leftVisible || !exposure.rightVisible) throw new Error("swm08_last_visit_column_obscured")
    },
  },
  {
    id: "SWM-06",
    name: "Organization detail",
    path: (resources) => resources.organizationId
      ? "/mtm/customers/" + encodeURIComponent(resources.organizationId)
      : null,
    fallbackPath: "/mtm/customers",
    waitFor: "[data-testid=mtm-organization-detail]",
  },
  {
    id: "SWM-04",
    name: "Doctor scoring and brand potential",
    path: (resources) => resources.contactId
      ? "/mtm/contacts/" + encodeURIComponent(resources.contactId)
      : null,
    fallbackPath: "/mtm/contacts",
    prepare: async (page) => {
      await page.getByTestId("mtm-contact-tab-categories").click()
      await page.getByTestId("mtm-contact-scoring-state").waitFor({ state: "visible" })
    },
  },
  {
    id: "SWM-05",
    name: "My contacts",
    path: (resources) => resources.agentId
      ? `/mtm/contacts?ownerAgentId=${encodeURIComponent(resources.agentId)}`
      : null,
    fallbackPath: "/mtm/contacts",
    waitFor: "[data-testid=mtm-contact-explorer][aria-busy=false]",
  },
  {
    id: "SWM-03",
    name: "Contact master card",
    path: (resources) => resources.contactId
      ? "/mtm/contacts/" + encodeURIComponent(resources.contactId)
      : null,
    fallbackPath: "/mtm/contacts",
    waitFor: "[data-testid=mtm-contact-detail]",
  },
  {
    id: "SWM-01",
    name: "Organization catalogue and ownership",
    path: (resources) => resources.organizationId
      ? "/mtm/customers?scope=ALL&search=QA-SWM-CLINIC"
      : null,
    fallbackPath: "/mtm/customers?scope=ALL",
    prepare: async (page, resources) => {
      await page.locator(`[data-testid="mtm-organization-select-${resources.organizationId}"]:visible`).first().check()
      await page.getByTestId("mtm-organization-assign-open").click()
      await page.getByTestId("mtm-organization-assignment-dialog").waitFor({ state: "visible" })
    },
  },
]

function requireConfiguration() {
  if (!baseURL) throw new Error("mtm_evidence_base_url_not_configured")
  if (roles.length === 0) throw new Error("mtm_evidence_roles_not_selected")
  if (scenarioBatchName !== "all" && !selectedScenarioIds) {
    throw new Error("mtm_evidence_scenario_batch_invalid_" + scenarioBatchName)
  }
  if (isProductionEvidenceTarget(baseURL)) {
    if (roles.length !== 1) throw new Error("mtm_evidence_production_requires_one_role")
    if (selectedViewports.size !== 1) throw new Error("mtm_evidence_production_requires_one_viewport")
    if (!selectedScenarioIds || selectedScenarioIds.size > 9) {
      throw new Error("mtm_evidence_production_requires_bounded_scenario_batch")
    }
  }
  for (const role of roles) {
    if (!role.email || !role.password) {
      throw new Error("mtm_evidence_credentials_missing_" + role.key)
    }
  }
  for (const viewport of selectedViewports) {
    if (!viewports[viewport]) throw new Error("mtm_evidence_viewport_invalid_" + viewport)
  }
  for (const scenario of scenarios) {
    if (!scenario.waitFor && !scenario.prepare) {
      throw new Error("mtm_evidence_target_assertion_missing_" + scenario.id)
    }
  }
}

async function authenticate(context, role) {
  const csrfResponse = await context.request.get("/api/auth/csrf")
  if (!csrfResponse.ok()) throw new Error("csrf_request_failed_" + csrfResponse.status())
  const csrfPayload = await csrfResponse.json()
  if (!csrfPayload?.csrfToken) throw new Error("csrf_payload_invalid")

  const loginResponse = await context.request.post("/api/auth/callback/credentials", {
    headers: { "X-Auth-Return-Redirect": "1" },
    form: {
      csrfToken: csrfPayload.csrfToken,
      email: role.email,
      password: role.password,
      organizationSlug,
      callbackUrl: baseURL + "/mtm?evidence=authenticated",
    },
  })
  if (!loginResponse.ok()) {
    throw new Error("credentials_callback_failed_" + role.key + "_" + loginResponse.status())
  }
  const loginPayload = await loginResponse.json().catch(() => null)
  if (!loginPayload?.url) throw new Error("credentials_callback_payload_invalid_" + role.key)
  const redirect = new URL(loginPayload.url, baseURL)
  const loginError = redirect.searchParams.get("error")
  if (loginError) throw new Error("credentials_callback_rejected_" + role.key + "_" + loginError)

  const cookies = await context.cookies(baseURL)
  if (!cookies.some((cookie) => cookie.name.endsWith("authjs.session-token"))) {
    throw new Error("authenticated_cookie_missing_" + role.key)
  }
}

async function firstResourceId(request, endpoint, collectionKey) {
  const response = await request.get(endpoint)
  if (!response.ok()) return null
  const payload = await response.json().catch(() => null)
  const collection = payload?.data?.[collectionKey]
  return Array.isArray(collection) && collection[0]?.id ? String(collection[0].id) : null
}

async function loadResources(request, roleKey) {
  const [contactId, organizationId, taskId, historyResponse] = await Promise.all([
    firstResourceId(request, "/api/v1/mtm/contacts?search=QA-SWM-DOCTOR-01&limit=1", "contacts"),
    firstResourceId(request, "/api/v1/mtm/organizations?search=QA-SWM-CLINIC&limit=1", "organizations"),
    firstResourceId(request, "/api/v1/mtm/tasks?search=QA-SWISSMED&limit=1", "tasks"),
    request.get("/api/v1/mtm/location-history"),
  ])
  const historyPayload = historyResponse.ok() ? await historyResponse.json().catch(() => null) : null
  const historyProbeError = !historyResponse.ok()
    ? "qa_location_history_probe_http_" + historyResponse.status()
    : !Array.isArray(historyPayload?.data?.agents)
      ? "qa_location_history_probe_invalid_payload"
      : null
  const agents = Array.isArray(historyPayload?.data?.agents) ? historyPayload.data.agents : []
  const evidenceAgent = agents.find((agent) => String(agent?.name || "").includes("[QA-SWISSMED] Field Agent"))
  const agentId = evidenceAgent?.id ? String(evidenceAgent.id) : null
  const [promotionResponse, liveResponse] = agentId ? await Promise.all([
    request.get(
      "/api/v1/mtm/pharmacy-promotion-executions?view=registry&q=%5BQA-SWISSMED%5D"
      + "&employeeId=" + encodeURIComponent(agentId)
      + "&pageSize=100",
    ),
    roleKey === "admin"
      ? request.get("/api/v1/mtm/locations?employee=%5BQA-SWISSMED%5D%20Field%20Agent")
      : Promise.resolve(null),
  ]) : [null, null]
  const promotionPayload = promotionResponse?.ok() ? await promotionResponse.json().catch(() => null) : null
  const livePayload = liveResponse?.ok() ? await liveResponse.json().catch(() => null) : null
  const promotionProbeError = promotionResponse
    ? !promotionResponse.ok()
      ? "qa_pharmacy_promotion_probe_http_" + promotionResponse.status()
      : !Array.isArray(promotionPayload?.data?.rows) || typeof promotionPayload?.data?.capabilities?.canReview !== "boolean"
        ? "qa_pharmacy_promotion_probe_invalid_payload"
        : null
    : null
  const liveProbeError = liveResponse
    ? !liveResponse.ok()
      ? "qa_live_map_probe_http_" + liveResponse.status()
      : !Array.isArray(livePayload?.data?.agentLocations)
        ? "qa_live_map_probe_invalid_payload"
        : null
    : null
  const timezone = String(historyPayload?.data?.timezone || "Asia/Baku")
  const dateParts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  )
  const evidenceDateValue = new Date(Date.UTC(Number(dateParts.year), Number(dateParts.month) - 1, Number(dateParts.day)))
  const todayDate = evidenceDateValue.toISOString().slice(0, 10)
  evidenceDateValue.setUTCDate(evidenceDateValue.getUTCDate() - 1)
  const evidenceDate = evidenceDateValue.toISOString().slice(0, 10)
  return {
    contactId,
    organizationId,
    taskId,
    agentId,
    promotionReviewExecutionId: findQaPromotionReviewExecutionId(promotionPayload, agentId),
    liveAgentId: findQaLiveAgentId(livePayload, agentId),
    promotionProbeError,
    liveProbeError,
    resourceProbeError: historyProbeError,
    todayDate,
    evidenceDate,
  }
}

function artifactName(scenario, role, viewport) {
  return scenario.id.toLowerCase() + "-" + role + "-" + viewport + ".png"
}

async function assertTabletScenarioGeometry(page, scenarioId, viewportName) {
  const issues = await page.evaluate(({ currentScenarioId, currentViewportName }) => {
    const failures = []
    const tolerance = 2

    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity) !== 0
        && rect.width > 0
        && rect.height > 0
    }
    const testId = (value) => document.querySelector(`[data-testid="${value}"]`)
    const requireVisible = (element, failure) => {
      if (!isVisible(element)) {
        failures.push(failure)
        return false
      }
      return true
    }
    const horizontallyContained = (container, element, failure) => {
      if (!requireVisible(container, `${failure}_container_missing`)
        || !requireVisible(element, `${failure}_target_missing`)) return
      const containerRect = container.getBoundingClientRect()
      const targetRect = element.getBoundingClientRect()
      if (targetRect.left < containerRect.left - tolerance
        || targetRect.right > containerRect.right + tolerance) {
        failures.push(failure)
      }
    }
    const fullyContained = (container, element, failure) => {
      if (!requireVisible(container, `${failure}_container_missing`)
        || !requireVisible(element, `${failure}_target_missing`)) return
      const containerRect = container.getBoundingClientRect()
      const targetRect = element.getBoundingClientRect()
      if (targetRect.left < containerRect.left - tolerance
        || targetRect.right > containerRect.right + tolerance
        || targetRect.top < containerRect.top - tolerance
        || targetRect.bottom > containerRect.bottom + tolerance) {
        failures.push(failure)
      }
    }
    const horizontallyVisibleThroughAncestors = (element, failure) => {
      if (!requireVisible(element, `${failure}_missing`)) return
      const targetRect = element.getBoundingClientRect()
      if (targetRect.left < -tolerance || targetRect.right > window.innerWidth + tolerance) {
        failures.push(failure)
        return
      }
      let ancestor = element.parentElement
      while (ancestor && ancestor !== document.body) {
        const style = window.getComputedStyle(ancestor)
        if (["auto", "scroll", "hidden", "clip"].includes(style.overflowX)) {
          const ancestorRect = ancestor.getBoundingClientRect()
          if (targetRect.left < ancestorRect.left - tolerance
            || targetRect.right > ancestorRect.right + tolerance) {
            failures.push(failure)
            return
          }
        }
        ancestor = ancestor.parentElement
      }
    }

    const header = testId("global-header")
    const launcher = document.querySelector('[data-tour-id="app-launcher"]')
    const headerActions = testId("global-header-actions")
    if (requireVisible(header, "global_header_missing")
      && requireVisible(launcher, "global_header_launcher_missing")
      && requireVisible(headerActions, "global_header_actions_missing")) {
      fullyContained(header, launcher, "global_header_launcher_outside")
      fullyContained(header, headerActions, "global_header_actions_outside")
      const launcherRect = launcher.getBoundingClientRect()
      const actionsRect = headerActions.getBoundingClientRect()
      if (launcherRect.right > actionsRect.left - 4) failures.push("global_header_launcher_actions_overlap")
    }

    if (currentScenarioId === "SWM-10" || currentScenarioId === "SWM-11") {
      const form = testId("mtm-location-history-filter-form")
      const accuracy = testId("mtm-location-history-accuracy")
      const submit = testId("mtm-location-history-submit")
      fullyContained(form, accuracy, "location_history_accuracy_outside_form")
      fullyContained(form, submit, "location_history_submit_outside_form")
      if (isVisible(form) && form.scrollWidth > form.clientWidth + tolerance) {
        failures.push("location_history_filter_form_overflow")
      }
    }

    if (currentScenarioId === "SWM-16") {
      const switcher = testId("mtm-route-view-switcher")
      const main = document.querySelector("main") || document.documentElement
      horizontallyContained(main, switcher, "route_switcher_outside_main")
      if (isVisible(switcher)) {
        if (switcher.scrollWidth > switcher.clientWidth + tolerance) {
          failures.push("route_switcher_tabs_hidden")
        }
        for (const button of switcher.querySelectorAll("button")) {
          if (!isVisible(button)) continue
          horizontallyContained(switcher, button, "route_switcher_tab_outside")
          horizontallyContained(main, button, "route_switcher_tab_outside_main")
        }
      }

      const actions = testId("mtm-route-builder-actions")
      if (requireVisible(actions, "route_builder_actions_missing")) {
        const position = window.getComputedStyle(actions).position
        if (position === "fixed" || position === "sticky") {
          failures.push("route_builder_actions_overlay_risk")
        }
        const previousSection = actions.previousElementSibling
        if (isVisible(previousSection)) {
          const previousRect = previousSection.getBoundingClientRect()
          const actionsRect = actions.getBoundingClientRect()
          const horizontalIntersection = Math.min(previousRect.right, actionsRect.right)
            - Math.max(previousRect.left, actionsRect.left)
          const verticalIntersection = Math.min(previousRect.bottom, actionsRect.bottom)
            - Math.max(previousRect.top, actionsRect.top)
          if (horizontalIntersection > tolerance && verticalIntersection > tolerance) {
            failures.push("route_builder_actions_overlap_content")
          }
        }
      }
    }

    if (currentScenarioId === "SWM-18") {
      const matrix = testId("mtm-route-planning-matrix")
      const agentSelect = testId("mtm-matrix-agent-select")
      horizontallyContained(matrix, agentSelect, "matrix_agent_select_clipped")
      horizontallyVisibleThroughAncestors(agentSelect, "matrix_agent_select_clipped_by_ancestor")

      const dayList = testId("mtm-week-day-list")
      if (!isVisible(dayList)) failures.push("weekly_day_list_missing")
      horizontallyContained(matrix, dayList, "weekly_day_list_clipped")
    }

    if (currentScenarioId === "SWM-13") {
      const appliedScope = testId("mtm-kpi-applied-scope")
      horizontallyVisibleThroughAncestors(appliedScope, "kpi_applied_scope_clipped")
      if (isVisible(appliedScope) && appliedScope.scrollWidth > appliedScope.clientWidth + tolerance) {
        failures.push("kpi_applied_scope_text_clipped")
      }

      const filters = document.querySelector("#mtm-kpi-filters")
      if (requireVisible(filters, "kpi_filters_missing")) {
        horizontallyVisibleThroughAncestors(filters, "kpi_filters_clipped")
        if (filters.scrollWidth > filters.clientWidth + tolerance) failures.push("kpi_filters_overflow")
        for (const child of filters.children) {
          if (!isVisible(child)) continue
          horizontallyContained(filters, child, "kpi_filter_control_outside")
        }
      }
    }

    if (currentScenarioId === "SWM-09" && currentViewportName === "tablet") {
      const sheet = testId("mtm-pharmacy-filter-sheet")
      const filterScroll = testId("mtm-pharmacy-filter-scroll")
      const reset = testId("mtm-pharmacy-filter-reset")
      const apply = testId("mtm-pharmacy-filter-apply")
      const sheetVisible = requireVisible(sheet, "pharmacy_filter_sheet_missing")
      requireVisible(reset, "pharmacy_filter_reset_missing")
      requireVisible(apply, "pharmacy_filter_apply_missing")

      if (sheetVisible) {
        const rect = sheet.getBoundingClientRect()
        if (rect.left < -tolerance || rect.right > window.innerWidth + tolerance
          || rect.top < -tolerance || rect.bottom > window.innerHeight + tolerance) {
          failures.push("pharmacy_filter_sheet_outside_viewport")
        }
        if (rect.height < window.innerHeight - tolerance) failures.push("pharmacy_filter_sheet_not_full_height")
      }
      if (requireVisible(filterScroll, "pharmacy_filter_scroll_missing")) {
        horizontallyContained(sheet, filterScroll, "pharmacy_filter_scroll_outside_sheet")
      }
      for (const [control, code] of [[reset, "reset"], [apply, "apply"]]) {
        if (!isVisible(control)) continue
        fullyContained(sheet, control, `pharmacy_filter_${code}_outside_sheet`)
        const rect = control.getBoundingClientRect()
        if (rect.width < 44 || rect.height < 44) failures.push(`pharmacy_filter_${code}_touch_target_small`)
      }
    }

    if (currentScenarioId === "SWM-09" && currentViewportName === "tablet-landscape") {
      const masterDetail = testId("mtm-pharmacy-tablet-master-detail")
      const inspector = testId("mtm-pharmacy-tablet-inspector")
      const columnChooser = testId("mtm-pharmacy-column-chooser")
      const masterPane = masterDetail?.firstElementChild

      const masterDetailVisible = requireVisible(masterDetail, "pharmacy_tablet_master_detail_missing")
      const inspectorVisible = requireVisible(inspector, "pharmacy_tablet_inspector_missing")
      const columnChooserVisible = requireVisible(columnChooser, "pharmacy_column_chooser_missing")

      if (masterDetailVisible && inspectorVisible) {
        horizontallyContained(masterDetail, inspector, "pharmacy_tablet_inspector_outside_workspace")
        const masterDetailRect = masterDetail.getBoundingClientRect()
        const inspectorRect = inspector.getBoundingClientRect()
        if (window.getComputedStyle(masterDetail).display !== "grid") {
          failures.push("pharmacy_tablet_master_detail_not_grid")
        }
        const masterPaneVisible = requireVisible(masterPane, "pharmacy_tablet_master_pane_missing")
        if (masterPaneVisible) {
          const masterPaneRect = masterPane.getBoundingClientRect()
          if (masterPaneRect.right > inspectorRect.left + tolerance) {
            failures.push("pharmacy_tablet_master_inspector_overlap")
          }
          if (masterPaneRect.left < masterDetailRect.left - tolerance
            || inspectorRect.right > masterDetailRect.right + tolerance) {
            failures.push("pharmacy_tablet_columns_outside_workspace")
          }
        }
      }

      if (columnChooserVisible) {
        horizontallyVisibleThroughAncestors(columnChooser, "pharmacy_column_chooser_clipped")
        const chooserRect = columnChooser.getBoundingClientRect()
        if (chooserRect.width < 44 || chooserRect.height < 44) {
          failures.push("pharmacy_column_chooser_touch_target_small")
        }
        if (masterDetailVisible) {
          const masterDetailRect = masterDetail.getBoundingClientRect()
          if (chooserRect.bottom > masterDetailRect.top + tolerance) {
            failures.push("pharmacy_column_chooser_overlaps_workspace")
          }
        }
      }
    }

    return failures
  }, { currentScenarioId: scenarioId, currentViewportName: viewportName })

  if (issues.length > 0) {
    throw new Error("tablet_geometry_" + scenarioId.toLowerCase() + "_" + issues.join(","))
  }
}

function summaryMarkdown(report) {
  const lines = [
    "# SwissMed MTM browser evidence",
    "",
    "- Generated: " + report.generatedAt,
    "- Base URL: " + report.baseURL,
    "- Organization slug: " + report.organizationSlug,
    "- Scenario batch: " + report.scenarioBatch,
    "- Results: " + report.totals.total,
    "- Passed: " + report.totals.passed,
    "- Blocked: " + report.totals.blocked,
    "- Failed: " + report.totals.failed,
    "",
    "| SWM | Role | Viewport | Status | Route | Evidence |",
    "|---|---|---|---|---|---|",
  ]
  for (const result of report.results) {
    lines.push(
      "| " + result.id
      + " | " + result.role
      + " | " + result.viewport
      + " | " + result.status
      + " | " + (result.path || "—")
      + " | " + (result.screenshot || result.reason || "—")
      + " |",
    )
  }
  lines.push("")
  lines.push("A visual pass does not approve missing SwissMed product policies or replace physical-device evidence.")
  return lines.join("\n")
}

requireConfiguration()
await mkdir(outputDirectory, { recursive: true })

const report = {
  generatedAt: new Date().toISOString(),
  baseURL,
  organizationSlug,
  scenarioBatch: scenarioBatchName,
  results: [],
}

const browser = await chromium.launch({ headless: true })
try {
  for (const role of roles) {
    for (const viewportName of selectedViewports) {
      const viewport = viewports[viewportName]
      const context = await browser.newContext({
        baseURL,
        viewport,
        locale: "ru-RU",
        reducedMotion: "reduce",
      })
      try {
        await authenticate(context, role)
        const resources = await loadResources(context.request, role.key)

        for (const scenario of scenarios) {
          if (selectedScenarioIds && !selectedScenarioIds.has(scenario.id)) continue
          if (role.key === "agent" && !agentScenarios.has(scenario.id)) continue

          const resolvedPath = scenario.path(resources)
          if (!resolvedPath) {
            report.results.push({
              id: scenario.id,
              name: scenario.name,
              role: role.key,
              viewport: viewportName,
              status: "blocked",
              path: scenario.fallbackPath || null,
              reason: typeof scenario.missingReason === "function"
                ? scenario.missingReason(resources)
                : scenario.missingReason || resources.resourceProbeError || "required_demo_fixture_missing",
            })
            continue
          }

          const page = await context.newPage()
          const consoleErrors = []
          const externalConsoleErrors = []
          const telemetryConsoleErrors = []
          const pageErrors = []
          const responseErrors = []
          const telemetryResponseErrors = []
          const telemetryRequestUrls = new Set()
          page.on("request", (request) => {
            const requestUrl = new URL(request.url())
            if (requestUrl.origin !== baseOrigin) return
            if (isNonBlockingTelemetryResponse({
              method: request.method(),
              url: requestUrl.pathname + requestUrl.search,
            })) {
              telemetryRequestUrls.add(requestUrl.href)
            }
          })
          page.on("console", (message) => {
            if (message.type() !== "error") return
            const entry = { text: message.text(), url: message.location().url || "" }
            const bucket = consoleErrorBucket(entry.url, baseURL, baseOrigin, telemetryRequestUrls)
            if (bucket === "external") externalConsoleErrors.push(entry)
            else if (bucket === "telemetry") telemetryConsoleErrors.push(entry)
            else consoleErrors.push(entry)
          })
          page.on("pageerror", (error) => pageErrors.push(error.message))
          page.on("response", (response) => {
            if (response.status() < 400) return
            const responseUrl = new URL(response.url())
            if (responseUrl.origin !== baseOrigin) return
            const responseError = {
              status: response.status(),
              method: response.request().method(),
              url: responseUrl.pathname + responseUrl.search,
            }
            if (isNonBlockingTelemetryResponse(responseError)) {
              telemetryResponseErrors.push(responseError)
            } else {
              responseErrors.push(responseError)
            }
          })

          const screenshot = artifactName(scenario, role.key, viewportName)
          const screenshotPath = outputDirectory + "/" + screenshot
          try {
            const response = await page.goto(resolvedPath, {
              waitUntil: "domcontentloaded",
              timeout: 60_000,
            })
            const status = response?.status() ?? 0
            const currentPath = new URL(page.url()).pathname
            if (currentPath === "/login") throw new Error("authenticated_session_not_established")
            if (status >= 400) throw new Error("page_http_" + status)

            await page.locator("body").waitFor({ state: "visible", timeout: 30_000 })
            await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {})
            if (scenario.waitFor) {
              await page.locator(scenario.waitFor).waitFor({ state: "visible", timeout: 30_000 })
            }
            if (scenario.prepare) await scenario.prepare(page, resources, viewportName)
            await page.waitForTimeout(1_000)
            if (tabletViewportNames.has(viewportName)) {
              await assertTabletScenarioGeometry(page, scenario.id, viewportName)
            }

            const layout = await page.evaluate(() => ({
              clientWidth: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
              headingCount: document.querySelectorAll("h1,h2,h3").length,
            }))
            const horizontalOverflow = layout.scrollWidth > layout.clientWidth + 2
            await page.screenshot({ path: screenshotPath, fullPage: true })

            report.results.push({
              id: scenario.id,
              name: scenario.name,
              role: role.key,
              viewport: viewportName,
              status: consoleErrors.length || externalConsoleErrors.length || pageErrors.length || responseErrors.length || horizontalOverflow ? "failed" : "passed",
              path: resolvedPath,
              finalUrl: page.url(),
              screenshot,
              httpStatus: status,
              layout,
              horizontalOverflow,
              consoleErrors,
              externalConsoleErrors,
              telemetryConsoleErrors,
              pageErrors,
              responseErrors,
              telemetryResponseErrors,
            })
          } catch (error) {
            await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {})
            report.results.push({
              id: scenario.id,
              name: scenario.name,
              role: role.key,
              viewport: viewportName,
              status: "failed",
              path: resolvedPath,
              finalUrl: page.url(),
              screenshot,
              reason: error instanceof Error ? error.message : String(error),
              consoleErrors,
              externalConsoleErrors,
              telemetryConsoleErrors,
              pageErrors,
              responseErrors,
              telemetryResponseErrors,
            })
          } finally {
            await page.close()
          }
        }
      } catch (error) {
        report.results.push({
          id: "AUTH",
          name: "Authenticated session",
          role: role.key,
          viewport: viewportName,
          status: "blocked",
          path: "/login",
          reason: error instanceof Error ? error.message : String(error),
        })
      } finally {
        await context.close()
      }
    }
  }
} finally {
  await browser.close()
}

report.totals = {
  total: report.results.length,
  passed: report.results.filter((result) => result.status === "passed").length,
  blocked: report.results.filter((result) => result.status === "blocked").length,
  failed: report.results.filter((result) => result.status === "failed").length,
}

await writeFile(outputDirectory + "/report.json", JSON.stringify(report, null, 2) + "\n")
await writeFile(outputDirectory + "/summary.md", summaryMarkdown(report) + "\n")

const incomplete = report.results.filter((result) => result.status !== "passed")
console.log(
  "SwissMed MTM evidence run finished: "
  + (report.results.length - incomplete.length)
  + " passed, "
  + report.totals.blocked
  + " blocked, "
  + report.totals.failed
  + " failed",
)
if (incomplete.length > 0) process.exitCode = 1
