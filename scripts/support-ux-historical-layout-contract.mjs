import { createHash } from "node:crypto"

export const HISTORICAL_LAYOUT_BEFORE_SHA = "76994875a251e0956b56f8d300625b97eb098661"
export const HISTORICAL_LAYOUT_ROUTES = Object.freeze([
  { id: "service-desk", path: "/tickets", file: "src/app/(dashboard)/tickets/page.tsx", beforeBlob: "530f6feb66b4fae8e112fffc6159e5de58da5d2a" },
  { id: "agent-desktop", path: "/support/agent-desktop", file: "src/app/(dashboard)/support/agent-desktop/page.tsx", beforeBlob: "bb5fd8d85e7e7b8ae6c56145e009e6609db3b884" },
  { id: "support-entitlements", path: "/support/entitlements", file: "src/app/(dashboard)/support/entitlements/page.tsx", beforeBlob: "9d9fd0d53abf28e2cd963c951063684a2c1fc61f" },
  { id: "agent-calendar", path: "/support/calendar", file: "src/app/(dashboard)/support/calendar/page.tsx", beforeBlob: "186ca992c82cb3b3fa79871072d28a005d69293f" },
])
export const HISTORICAL_LAYOUT_CONTROLS = Object.freeze({
  role: "admin", locale: "en", theme: "light", timezone: "UTC",
  viewportWidth: 1366, viewportHeight: 768, expectsTouch: false,
  reducedMotion: "reduce", visionDeficiency: "standard", sampleCount: 3,
  dataProfile: "typical", fixtureKind: "support-historical-layout-v1", ticketCount: 50,
  metricDefinition: "first-matched-actionable-work-item-container-top-from-viewport-after-zero-scroll-v1",
  blockDefinition: "rendered-bordered-rounded-elements-within-main-including-offscreen-v1",
  clockPolicy: "shared-future-utc-day-browser-server-anchor-with-monotonic-runtime-v1",
  fixtureTimestamps: "ui-significant-created-updated-dates-at-anchor-v1",
})
const failureCodes = new Set([
  "SOURCE_IDENTITY_INVALID", "STAGE_INVALID", "FIXTURE_CLOCK_INVALID", "FIXTURE_IDENTITY_INVALID",
  "EPHEMERAL_SEED_REQUIRED", "EPHEMERAL_DATABASE_REQUIRED", "EPHEMERAL_CAPTURE_REQUIRED",
  "TICKET_FIXTURE_MISSING", "TICKET_COHORT_MISMATCH", "AGENT_FIXTURE_MISMATCH",
  "ENTITLEMENT_FIXTURE_MISMATCH", "CALENDAR_FIXTURE_MISMATCH", "ROUTE_INVALID", "GEOMETRY_INVALID",
  "MATCHED_CONTROLS_INVALID", "ROUTE_COVERAGE_INVALID", "CAPTURE_ENVIRONMENT_INVALID",
  "PRIMARY_ITEM_AMBIGUOUS", "PRIMARY_ITEM_MISSING", "EPHEMERAL_PASSWORD_REQUIRED", "EMPTY_DATABASE_REQUIRED",
  "AUTH_SESSION_MISMATCH", "PAGE_UNAVAILABLE", "DATA_UNAVAILABLE", "RUNTIME_FAILURE", "CAPTURE_INCOMPLETE",
])

export function historicalFailureCode(error) {
  return failureCodes.has(error?.message) ? error.message : "CAPTURE_FAILED"
}

export function requireHistoricalSha(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) throw new Error("SOURCE_IDENTITY_INVALID")
  return value
}

export function requireHistoricalStage(value) {
  if (value !== "before" && value !== "after") throw new Error("STAGE_INVALID")
  return value
}

export function requireHistoricalAnchor(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T08:00:00\.000Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error("FIXTURE_CLOCK_INVALID")
  }
  return value
}

export function chooseHistoricalAnchor(now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error("FIXTURE_CLOCK_INVALID")
  // Native browser/API cookie jars retain their real transport clock. The
  // common synthetic clock must leave the application's existing 8h session
  // cookie expiry in the future for both bounded runtime jobs.
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 8)).toISOString()
}

export function historicalFixture(anchor) {
  requireHistoricalAnchor(anchor)
  return {
    schemaVersion: 1, kind: HISTORICAL_LAYOUT_CONTROLS.fixtureKind, anchor,
    organization: { id: "clhistorg00000000000000001", name: "Historical Support Layout Lab", slug: "support-historical-layout" },
    admin: { id: "clhistadmin000000000000001", name: "Synthetic Layout Administrator", email: "admin@historical-support.invalid", role: "admin" },
    company: { id: "clhistcompany0000000000001", name: "Synthetic Layout Customer" },
    sla: { id: "clhistsla00000000000000001", name: "Synthetic Standard Care" },
    entitlement: { id: "clhistentitle0000000000001", status: "active", supportLevel: "premium" },
    ticket: { id: "clhistticket00000000000001", number: "HIST-0001", subject: "Resolve the synthetic sign-in incident", priority: "critical", status: "open", dueAt: new Date(Date.parse(anchor) + 60 * 60 * 1000).toISOString() },
    ticketCount: HISTORICAL_LAYOUT_CONTROLS.ticketCount,
    synthetic: true,
  }
}

export function historicalFixtureDigest(fixture) {
  const expected = historicalFixture(fixture?.anchor)
  if (JSON.stringify(fixture) !== JSON.stringify(expected)) throw new Error("FIXTURE_IDENTITY_INVALID")
  return createHash("sha256").update(JSON.stringify(expected)).digest("hex")
}

export function historicalTicketIdentity(fixture, index) {
  if (!Number.isInteger(index) || index < 0 || index >= HISTORICAL_LAYOUT_CONTROLS.ticketCount) throw new Error("FIXTURE_IDENTITY_INVALID")
  return {
    id: index === 0 ? fixture.ticket.id : "clhistticket" + String(index + 1).padStart(14, "0"),
    number: "HIST-" + String(index + 1).padStart(4, "0"),
    subject: index === 0 ? fixture.ticket.subject : "Synthetic support case " + String(index + 1),
    dueAt: index === 0 ? fixture.ticket.dueAt : new Date(Date.parse(fixture.anchor) + (index + 120) * 60000).toISOString(),
  }
}

export function assertHistoricalSeedEnvironment(env) {
  if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted" || env.NODE_ENV !== "test" || env.SUPPORT_HISTORICAL_SEED_CONFIRM !== "ephemeral-support-historical-layout-v1") {
    throw new Error("EPHEMERAL_SEED_REQUIRED")
  }
  let url
  try { url = new URL(env.DATABASE_URL) } catch { throw new Error("EPHEMERAL_DATABASE_REQUIRED") }
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "5432" || url.pathname !== "/support_ux_historical_layout" || url.search || url.hash) {
    throw new Error("EPHEMERAL_DATABASE_REQUIRED")
  }
}

export function assertHistoricalCaptureEnvironment(env) {
  if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted" || env.SUPPORT_HISTORICAL_BASE_URL !== "http://127.0.0.1:3000") {
    throw new Error("EPHEMERAL_CAPTURE_REQUIRED")
  }
  const stage = requireHistoricalStage(env.SUPPORT_HISTORICAL_STAGE)
  const sourceSha = requireHistoricalSha(env.SUPPORT_HISTORICAL_SOURCE_SHA)
  const controlSha = requireHistoricalSha(env.SUPPORT_HISTORICAL_CONTROL_SHA)
  requireHistoricalSha(env.SUPPORT_HISTORICAL_MAIN_SHA)
  if ((stage === "before" && sourceSha !== HISTORICAL_LAYOUT_BEFORE_SHA) || (stage === "after" && sourceSha !== controlSha)) throw new Error("SOURCE_IDENTITY_INVALID")
  return { stage, sourceSha, controlSha }
}

export function assertHistoricalSemanticData(id, stage, body, fixture) {
  requireHistoricalStage(stage)
  historicalFixtureDigest(fixture)
  const expectedTickets = new Map(Array.from({ length: fixture.ticketCount }, (_, index) => {
    const ticket = historicalTicketIdentity(fixture, index)
    return [ticket.id, ticket]
  }))
  if (id === "service-desk" || (id === "agent-desktop" && stage === "before")) {
    const tickets = body?.data?.tickets ?? body?.data
    if (!body?.success || !Array.isArray(tickets) || tickets.length !== fixture.ticketCount || !tickets.some((ticket) => ticket.id === fixture.ticket.id && ticket.subject === fixture.ticket.subject)) throw new Error("TICKET_FIXTURE_MISSING")
    if (new Set(tickets.map((ticket) => ticket.id)).size !== fixture.ticketCount || tickets.some((ticket) => ticket.assignedTo !== fixture.admin.id || expectedTickets.get(ticket.id)?.subject !== ticket.subject)) throw new Error("TICKET_COHORT_MISMATCH")
    return
  }
  if (id === "agent-desktop") {
    const data = body?.data
    const elapsed = Date.parse(data?.generatedAt) - Date.parse(fixture.anchor)
    if (!body?.success || !Number.isFinite(elapsed) || elapsed < 0 || elapsed > 600000 || data?.scope !== "assigned_to_current_user" || data?.queue?.total !== fixture.ticketCount || data?.queue?.nextTicket?.id !== fixture.ticket.id || data?.queue?.nextTicket?.subject !== fixture.ticket.subject) throw new Error("AGENT_FIXTURE_MISMATCH")
    return
  }
  if (id === "support-entitlements") {
    const entitlement = body?.entitlements?.find((item) => item.id === fixture.entitlement.id)
    if (body?.entitlements?.length !== 1 || !entitlement || entitlement.companyName !== fixture.company.name || entitlement.status !== "active" || entitlement.definitionCount !== 2 || !Array.isArray(entitlement.definitions) || entitlement.definitions.length !== 2) throw new Error("ENTITLEMENT_FIXTURE_MISMATCH")
    return
  }
  if (id === "agent-calendar") {
    const items = body?.data?.items
    const target = items?.find((item) => item.id === fixture.ticket.id && item.type === "ticket")
    const sources = body?.data?.sources
    if (!body?.success || body?.data?.partial || (stage === "after" && (!sources || Object.keys(sources).sort().join(",") !== "activities,events,tasks,tickets")) || (sources && Object.values(sources).some((status) => status !== "ok")) || !Array.isArray(items) || items.length !== fixture.ticketCount || new Set(items.map((item) => item.id)).size !== fixture.ticketCount || !target || target.title !== fixture.ticket.subject || target.date !== fixture.ticket.dueAt || target.allDay || items.some((item) => item.type !== "ticket" || expectedTickets.get(item.id)?.subject !== item.title || expectedTickets.get(item.id)?.dueAt !== item.date)) throw new Error("CALENDAR_FIXTURE_MISMATCH")
    return
  }
  throw new Error("ROUTE_INVALID")
}

export function historicalMedian(values) {
  if (!Array.isArray(values) || values.length !== HISTORICAL_LAYOUT_CONTROLS.sampleCount || values.some((value) => !Number.isFinite(value) || value <= 0 || value > 10000)) throw new Error("GEOMETRY_INVALID")
  return [...values].sort((left, right) => left - right)[1]
}

export function validateHistoricalEvidence(report, stage, afterSha) {
  requireHistoricalStage(stage)
  requireHistoricalSha(afterSha)
  if (report?.schemaVersion !== 1 || report?.comparisonKind !== "exact-source-runtime" || report?.stage !== stage || report?.sourceSha !== (stage === "before" ? HISTORICAL_LAYOUT_BEFORE_SHA : afterSha) || report?.controlSha !== afterSha || report?.status !== "captured") throw new Error("SOURCE_IDENTITY_INVALID")
  requireHistoricalSha(report.mainSha)
  const fixture = historicalFixture(report.anchor)
  if (report.fixtureDigest !== historicalFixtureDigest(fixture) || JSON.stringify(report.controls) !== JSON.stringify(HISTORICAL_LAYOUT_CONTROLS)) throw new Error("MATCHED_CONTROLS_INVALID")
  if (report.serverClockProof?.schemaVersion !== 1 || report.serverClockProof?.clockPolicy !== HISTORICAL_LAYOUT_CONTROLS.clockPolicy || report.serverClockProof?.anchor !== report.anchor || !Number.isFinite(report.serverClockProof?.dateNow) || report.serverClockProof.dateNow < Date.parse(report.anchor) || report.serverClockProof.dateNow > Date.parse(report.anchor) + 1000) throw new Error("CAPTURE_ENVIRONMENT_INVALID")
  if (!Array.isArray(report.results) || report.results.length !== HISTORICAL_LAYOUT_ROUTES.length) throw new Error("ROUTE_COVERAGE_INVALID")
  const seen = new Set()
  for (const result of report.results) {
    const route = HISTORICAL_LAYOUT_ROUTES.find((item) => item.id === result.id)
    if (!route || seen.has(result.id) || result.path !== route.path || result.status !== "captured" || result.semanticFixture !== true) throw new Error("ROUTE_COVERAGE_INVALID")
    seen.add(result.id)
    if (result.viewportWidth !== 1366 || result.viewportHeight !== 768 || result.maxTouchPoints !== 0 || result.documentLang !== "en" || result.darkTheme !== false || result.reducedMotion !== true || result.scrollTop !== 0 || result.documentScrollTop !== 0) throw new Error("CAPTURE_ENVIRONMENT_INVALID")
    if (result.primaryWorkTop !== historicalMedian(result.primaryWorkTopSamples) || result.primaryLabelTop !== historicalMedian(result.primaryLabelTopSamples)) throw new Error("GEOMETRY_INVALID")
    if (!Number.isInteger(result.borderedRoundedBlocks) || result.borderedRoundedBlocks < 1 || result.borderedRoundedBlocks > 10000 || !Number.isInteger(result.majorChildren) || result.majorChildren < 1 || result.majorChildren > 10000) throw new Error("GEOMETRY_INVALID")
    if (!/^[a-f0-9]{40}$/.test(result.sourcePageBlob) || (stage === "before" && result.sourcePageBlob !== route.beforeBlob) || result.screenshot !== route.id + ".png") throw new Error("SOURCE_IDENTITY_INVALID")
  }
  return report
}

export function compareHistoricalLayouts(before, after, afterSha) {
  validateHistoricalEvidence(before, "before", afterSha)
  validateHistoricalEvidence(after, "after", afterSha)
  if (before.anchor !== after.anchor || before.fixtureDigest !== after.fixtureDigest || before.mainSha !== after.mainSha) throw new Error("MATCHED_CONTROLS_INVALID")
  const results = HISTORICAL_LAYOUT_ROUTES.map((route) => {
    const old = before.results.find((item) => item.id === route.id)
    const current = after.results.find((item) => item.id === route.id)
    const reductionPercent = (old.primaryWorkTop - current.primaryWorkTop) / old.primaryWorkTop * 100
    return {
      id: route.id, beforeTop: old.primaryWorkTop, afterTop: current.primaryWorkTop,
      reductionPercent, requiredReductionPercent: 35,
      beforeBlocks: old.borderedRoundedBlocks, afterBlocks: current.borderedRoundedBlocks,
      beforeLabelTop: old.primaryLabelTop, afterLabelTop: current.primaryLabelTop,
      status: reductionPercent >= 35 && current.primaryWorkTop < 768 && current.primaryLabelTop < 768 ? "passed" : "failed",
    }
  })
  return {
    schemaVersion: 1, status: results.every((result) => result.status === "passed") ? "passed" : "failed",
    comparisonKind: "exact-source-runtime", beforeSha: HISTORICAL_LAYOUT_BEFORE_SHA,
    afterSha, mainSha: after.mainSha, anchor: after.anchor, fixtureDigest: after.fixtureDigest,
    controls: HISTORICAL_LAYOUT_CONTROLS, formula: "(beforeTop-afterTop)/beforeTop*100", results,
  }
}
