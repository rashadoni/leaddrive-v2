import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"
import { makeRlsTestPrisma } from "./_rls.mjs"
import { collectRenderedTextContrast } from "./workforce-calendar-contrast-dom.mjs"
import { evaluateTextContrast } from "./workforce-calendar-contrast-colors.mjs"
import { captureNativeViewport, createNativeZoomContext, isNativeZoomPage, proveNative200Zoom } from "./workforce-native-browser-zoom.mjs"
import bcrypt from "bcryptjs"
import { chromium } from "playwright"

// This harness is deliberately not a production browser/seed entry point.
// Real authentication, UI and mutations run only in the disposable CI database.
const baseURL = process.env.WF_CALENDAR_BROWSER_BASE_URL
const databaseName = "/workforce_calendar_browser"
const local = new Set(["127.0.0.1", "localhost", "[::1]"])
function databaseTarget(value, username) {
  const url = new URL(value)
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol))
  assert.ok(local.has(url.hostname), "Only a loopback test database is allowed")
  assert.equal(url.pathname, databaseName)
  assert.equal(url.username, username)
  return url
}
assert.equal(process.env.GITHUB_ACTIONS, "true", "Run this harness on hosted CI")
assert.equal(process.env.WF_CALENDAR_BROWSER, "1", "Explicit disposable fixture opt-in required")
assert.notEqual(process.env.NODE_ENV, "production")
const origin = new URL(baseURL)
assert.equal(origin.protocol, "http:")
assert.ok(local.has(origin.hostname))
assert.equal(origin.pathname, "/")
assert.equal(origin.username + origin.password + origin.search + origin.hash, "")
const adminURL = databaseTarget(process.env.ADMIN_DATABASE_URL, "postgres")
const appURL = databaseTarget(process.env.DATABASE_URL, "wf_calendar_browser")
assert.equal(adminURL.host, appURL.host)

const outputDirectory = process.env.WF_CALENDAR_BROWSER_OUTPUT_DIR || "artifacts/workforce-calendar-browser"
await mkdir(outputDirectory, { recursive: true })
const admin = makeRlsTestPrisma(adminURL.toString())
const app = makeRlsTestPrisma(appURL.toString())
const endpoint = "/api/v1/workforce/configuration/calendar"
const calendarRoute = url => url.origin === origin.origin && url.pathname === endpoint
const suffix = randomUUID().replaceAll("-", "").slice(0, 12)
const password = `Fixture!9a-${randomUUID()}`
const receipts = {
  version: 1,
  candidateHead: process.env.WF_CALENDAR_BROWSER_HEAD_SHA,
  checkedMergeSha: process.env.GITHUB_SHA,
  startedAt: new Date().toISOString(),
  environment: "hosted Chromium / loopback Next dev / disposable PostgreSQL16",
  authentication: "real CSRF + credentials provider + session cookie; no auth mocks",
  authenticationDiagnostics: [],
  reflowDiagnostics: [],
  readingDiagnostics: [],
  nativeZoomDiagnostics: [],
  nativeCaptureDiagnostics: [],
  focusGeometryDiagnostics: [],
  nativeZoomVerdict: "NOT RUN",
  contrastDiagnostics: [],
  contrastVerdict: "NOT RUN",
  cases: [],
  limitations: ["Development bundle, not production build", "No production business data", "No Android/AT/load/pilot evidence", "Keyboard cases cover reversal actions; fixture selection/refresh uses existing UI", "No whole-page keyboard, all-page zoom or WCAG acceptance", "Native200 cases are fixture-extension automatic browser zoom, not a human browser-shortcut/AT session", "Contrast covers bounded default-light enabled/normal/native-focused text targets only; no dark/forced-color/hover/pressed/non-text/focus-ring or overall WCAG compliance claim"],
  status: "RUNNING",
}
// Selected raw checkout bindings, validated against candidate Git by review.
// A generated fixture/schema is not represented as a historical migration replay.
const sourcePaths = [
  "scripts/workforce-calendar-browser-evidence.mjs", "scripts/workforce-native-browser-zoom.mjs",
  "scripts/workforce-calendar-contrast-colors.mjs", "scripts/workforce-calendar-contrast-dom.mjs",
  "scripts/ci/fixtures/workforce-native-zoom-extension/manifest.json",
  "scripts/ci/fixtures/workforce-native-zoom-extension/background.js",
  "scripts/ci/fixtures/workforce-calendar-browser.sql", "scripts/_rls.mjs",
  ".github/workflows/workforce-calendar-browser-evidence.yml", "prisma/schema.prisma",
  "src/components/workforce/workforce-calendar-configuration.tsx",
  "src/app/api/v1/workforce/configuration/calendar/route.ts",
  "src/lib/workforce/calendar-configuration.ts", "src/lib/workforce/calendar-configuration-contract.ts",
  "src/lib/workforce/calendar-moved-day-pair.ts", "src/lib/with-workforce-rls-auth.ts", "src/lib/with-rls.ts",
  "src/lib/auth.ts", "src/lib/api-auth.ts", "src/lib/user-module-access.ts", "src/proxy.ts",
  "src/app/layout.tsx", "src/app/(dashboard)/layout.tsx", "src/app/globals.css", "src/components/providers.tsx",
  "src/components/ui/button.tsx", "src/components/ui/input.tsx", "src/components/ui/select.tsx",
  "messages/en.json", "messages/ru.json", "messages/az.json",
]
receipts.sourceBindings = await Promise.all(sourcePaths.map(async path => {
  const bytes = await readFile(new URL(`../${path}`, import.meta.url))
  return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }
}))
const contexts = []
const nativeZoomContexts = []
const barriers = []
const handlerErrors = []
const readDiagnostics = []
const authenticationPostTimes = []
let browser
let activePage

function barrier() {
  let release
  const promise = new Promise(resolve => { release = resolve })
  barriers.push(release)
  return { promise, release }
}
async function until(check, description, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (handlerErrors.length) throw handlerErrors[0]
    if (await check()) return
    await delay(100)
  }
  throw new Error(`Timed out: ${description}`)
}
function handled(handler) {
  return async route => {
    try { await handler(route) } catch (error) {
      handlerErrors.push(new Error(`Intercepted calendar request failed (${error.name})`))
      await route.abort().catch(() => {})
    }
  }
}
async function copy(locale) {
  return JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")).workforceCalendarConfiguration
}
async function assertSession(context, principal, phase = "credentials-session") {
  const response = await context.request.get("/api/auth/session", { timeout: 120_000 })
  assert.equal(response.status(), 200)
  const session = await response.json()
  assert.equal(session.user.id, principal.id, `${phase}: real session principal must remain current`)
  assert.equal(session.user.organizationId, principal.organizationId, `${phase}: real session organization must remain current`)
}
async function checkedContextRead(response, phase, targetTeam) {
  const diagnostic = {
    phase,
    scope: new URL(response.url()).searchParams.get("scope") || "ORGANIZATION",
    status: response.status(),
    sessionCookieHeaderPresent: (await response.headersArray()).some(header => header.name.toLowerCase() === "set-cookie" && header.value.includes("authjs.session-token")),
  }
  readDiagnostics.push(diagnostic)
  const payload = await response.json().catch(() => null)
  diagnostic.success = payload?.success === true
  if (typeof payload?.code === "string" && /^[A-Za-z0-9_]{1,100}$/.test(payload.code)) diagnostic.code = payload.code
  assert.equal(response.status(), 200, `${phase}: actual calendar read must succeed`)
  assert.equal(payload?.success, true, `${phase}: actual calendar JSON must succeed`)
  assert.ok(payload.data.teamDirectory.items.some(team => team.id === targetTeam.id), `${phase}: new-context team must remain available`)
  return payload.data
}
async function authenticate(context, principal) {
  const diagnostic = { ordinal: receipts.authenticationDiagnostics.length + 1, csrfStatus: null, callbackStatus: null, pacingWaitMs: 0 }
  receipts.authenticationDiagnostics.push(diagnostic)
  const csrf = await context.request.get("/api/auth/csrf", { timeout: 120_000 })
  diagnostic.csrfStatus = csrf.status()
  assert.equal(csrf.status(), 200)
  const { csrfToken } = await csrf.json()
  assert.equal(typeof csrfToken, "string")
  // The unchanged proxy/principal policies allow 10 auth POSTs per 60s.
  // Respect that real policy with at most eight fixture callbacks per 61s;
  // never retry credentials, spoof an IP, or disable the production limiter.
  const authenticationWindowMs = 61_000
  const pruneAuthenticationPosts = () => {
    const cutoff = Date.now() - authenticationWindowMs
    while (authenticationPostTimes.length && authenticationPostTimes[0] <= cutoff) authenticationPostTimes.shift()
  }
  pruneAuthenticationPosts()
  if (authenticationPostTimes.length >= 8) {
    diagnostic.pacingWaitMs = Math.max(0, authenticationPostTimes[0] + authenticationWindowMs - Date.now()) + 25
    assert.ok(diagnostic.pacingWaitMs <= 62_000, "Fixture authentication wait must remain bounded")
    await delay(diagnostic.pacingWaitMs)
    pruneAuthenticationPosts()
  }
  assert.ok(authenticationPostTimes.length < 8, "Fixture authentication must remain within its conservative budget")
  authenticationPostTimes.push(Date.now())
  diagnostic.callbackStartedAt = new Date().toISOString()
  const response = await context.request.post("/api/auth/callback/credentials", {
    timeout: 120_000,
    headers: { "X-Auth-Return-Redirect": "1" },
    form: { csrfToken, email: principal.email, password, organizationSlug: principal.slug, callbackUrl: `${baseURL}/workforce/calendar` },
  })
  diagnostic.callbackStatus = response.status()
  assert.equal(response.status(), 200, "Real credentials callback must succeed")
  const redirect = new URL((await response.json()).url, baseURL)
  assert.equal(redirect.origin, origin.origin)
  assert.equal(redirect.searchParams.get("error"), null)
  assert.ok((await context.cookies()).some(cookie => cookie.name.endsWith("authjs.session-token")))
  await assertSession(context, principal)
}
async function open(principal, locale = "en", viewport = { width: 1440, height: 1000 }, nativeZoom = false) {
  const native = nativeZoom ? await createNativeZoomContext(baseURL) : null
  if (native) nativeZoomContexts.push(native)
  const context = native?.context ?? await browser.newContext({ baseURL, locale: "en-US", viewport, serviceWorkers: "block" })
  contexts.push(context)
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL }])
  await authenticate(context, principal)
  const page = await context.newPage()
  activePage = page
  page.setDefaultTimeout(30_000)
  page.setDefaultNavigationTimeout(120_000)
  await page.goto("/workforce/calendar", { waitUntil: "domcontentloaded" })
  const ui = await copy(locale)
  const section = page.locator('section[aria-labelledby="workforce-calendar-configuration-title"]')
  await section.locator("#workforce-calendar-date").waitFor()
  assert.notEqual(new URL(page.url()).pathname, "/login")
  const view = { context, page, section, ui, ...(native ? { worker: native.worker } : {}) }
  if (native) {
    view.nativeZoom = await proveNative200Zoom(view, outputDirectory, locale, diagnostic => receipts.nativeCaptureDiagnostics.push(diagnostic))
    receipts.nativeZoomDiagnostics.push({ locale, status: "PASS", ...view.nativeZoom })
  }
  return view
}
async function inventory(context, principal, scope = "ORGANIZATION", teamId) {
  const query = new URLSearchParams({ scope, ...(teamId ? { teamId } : {}) })
  const response = await context.request.get(`${endpoint}?${query}`, { timeout: 120_000, headers: { "x-organization-id": principal.organizationId } })
  assert.equal(response.status(), 200)
  const body = await response.json()
  assert.equal(body.success, true)
  return body.data
}
async function pair(context, principal, index, teamId, name = `Browser proof ${index} ${suffix}`) {
  const data = await inventory(context, principal)
  const source = new Date(`${data.currentDate}T00:00:00.000Z`)
  source.setUTCDate(source.getUTCDate() + 14 + index * 14)
  while (source.getUTCDay() !== 1) source.setUTCDate(source.getUTCDate() + 1)
  const destination = new Date(source)
  destination.setUTCDate(destination.getUTCDate() + 5)
  const draft = {
    operation: "MOVE_WORKDAY", scope: teamId ? "TEAM" : "ORGANIZATION", ...(teamId ? { teamId } : {}),
    sourceDate: source.toISOString().slice(0, 10), destinationDate: destination.toISOString().slice(0, 10),
    name,
  }
  const response = await context.request.post(endpoint, { timeout: 120_000, headers: { "x-organization-id": principal.organizationId }, data: draft })
  assert.equal(response.status(), 201, "Fixture pair uses the actual calendar writer")
  const loaded = await inventory(context, principal, draft.scope, teamId)
  const row = loaded.days.find(day => day.date === draft.sourceDate && day.name === draft.name)
  assert.equal(typeof row?.pairGenerationId, "string")
  return { ...draft, pairGenerationId: row.pairGenerationId }
}
async function tabToButton(page, button) {
  await button.waitFor()
  assert.equal(await button.isDisabled(), false)
  for (let tabs = 0; tabs <= 80; tabs++) {
    if (await button.evaluate(element => document.activeElement === element && element.matches(":focus-visible"))) return tabs
    if (tabs < 80) await page.keyboard.press("Tab")
  }
  throw new Error("Native Tab did not reach the named reversal action")
}
async function focusedInViewport(locator, description) {
  const diagnostic = { description, status: "FAIL", polls: 0 }
  try {
    await until(async () => {
      const sample = await locator.evaluate(element => {
        const bounds = element.getBoundingClientRect()
        const container = element.closest("main")?.getBoundingClientRect()
        // Keep the original predicate and timeout exactly. Diagnostics read
        // unrounded coordinates; they never focus, scroll or change styles.
        const pass = document.activeElement === element
          && bounds.top >= Math.max(0, container?.top ?? 0)
          && bounds.bottom <= Math.min(window.innerHeight, container?.bottom ?? window.innerHeight)
          && bounds.left >= Math.max(0, container?.left ?? 0)
          && bounds.right <= Math.min(window.innerWidth, container?.right ?? window.innerWidth)
        const rect = box => box ? Object.fromEntries(["top", "bottom", "left", "right", "width", "height"]
          .map(key => [key, Number.isFinite(box[key]) ? box[key] : null])) : null
        const dimensions = node => ({ clientWidth: node.clientWidth, clientHeight: node.clientHeight,
          scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight, offsetWidth: node.offsetWidth,
          offsetHeight: node.offsetHeight, scrollLeft: node.scrollLeft, scrollTop: node.scrollTop })
        const ancestors = []
        for (let node = element.parentElement; node && ancestors.length < 8; node = node.parentElement) {
          const style = getComputedStyle(node)
          const overflow = value => ["visible", "hidden", "clip", "auto", "scroll", "overlay"].includes(value) ? value : "OTHER"
          ancestors.push({ tag: node.tagName, bounds: rect(node.getBoundingClientRect()), ...dimensions(node),
            overflowX: overflow(style.overflowX), overflowY: overflow(style.overflowY) })
        }
        return { pass, focused: document.activeElement === element, focusVisible: element.matches(":focus-visible"),
          connected: element.isConnected, disabled: element.matches(":disabled"),
          clauses: { top: bounds.top >= Math.max(0, container?.top ?? 0),
            bottom: bounds.bottom <= Math.min(window.innerHeight, container?.bottom ?? window.innerHeight),
            left: bounds.left >= Math.max(0, container?.left ?? 0),
            right: bounds.right <= Math.min(window.innerWidth, container?.right ?? window.innerWidth) },
          target: rect(bounds), main: rect(container),
          viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio,
            visualWidth: window.visualViewport?.width, visualHeight: window.visualViewport?.height,
            visualScale: window.visualViewport?.scale, scrollX: window.scrollX, scrollY: window.scrollY },
          root: dimensions(document.documentElement), body: dimensions(document.body), ancestors }
      })
      diagnostic.polls++
      diagnostic.first ??= sample
      diagnostic.last = sample
      return sample.pass
    }, description)
    diagnostic.status = "PASS"
  } finally {
    receipts.focusGeometryDiagnostics.push(diagnostic)
  }
}

async function evidenceScreenshot(page, path, fullPage) {
  if (isNativeZoomPage(page)) {
    await captureNativeViewport(page, path, diagnostic => receipts.nativeCaptureDiagnostics.push(diagnostic))
  } else {
    await page.screenshot({ path, fullPage })
  }
}
async function tabToNext(page, button, key = "Tab") {
  await page.keyboard.press(key)
  assert.equal(await button.evaluate(element => document.activeElement === element && element.matches(":focus-visible")), true,
    "Native keyboard navigation must focus the expected button")
  await focusedInViewport(button, "keyboard button is fully inside the viewport")
}
async function review(view, moved, team, activate) {
  const { section, ui } = view
  if (team) {
    await section.locator("#workforce-calendar-scope").selectOption("TEAM")
    await section.locator(`#workforce-calendar-team option[value="${team.id}"]`).waitFor({ state: "attached" })
    await section.locator("#workforce-calendar-team").selectOption(team.id)
  } else {
    await section.getByRole("button", { name: ui.refresh, exact: true }).click()
  }
  const action = section.getByRole("button", { name: ui.reversalActionLabel.replace("{name}", moved.name), exact: true })
  await action.waitFor()
  assert.equal(await section.getByRole("button", { name: ui.reversalAction, exact: true }).count(), 0, "Action must name the specific pair")
  if (activate) await activate(action)
  else await action.click()
  return reviewedConfirmation(view, moved, team)
}
async function reviewedConfirmation(view, moved, team) {
  const { page, section, ui } = view
  await section.getByRole("heading", { name: ui.reversalReviewTitle, exact: true }).waitFor()
  const confirmation = section.locator('[aria-labelledby="workforce-calendar-reversal-title"]')
  await until(async () => confirmation.evaluate(element => {
    const title = element.querySelector("h3")
    const bounds = element.getBoundingClientRect()
    const container = element.closest("main")?.getBoundingClientRect()
    return document.activeElement === title
      && bounds.top >= Math.max(0, container?.top ?? 0)
      && bounds.bottom <= Math.min(window.innerHeight, container?.bottom ?? window.innerHeight)
      && bounds.left >= Math.max(0, container?.left ?? 0)
      && bounds.right <= Math.min(window.innerWidth, container?.right ?? window.innerWidth)
  }), "confirmation is focused and fully inside the viewport")
  const text = await confirmation.innerText()
  const formatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" })
  assert.ok(text.includes(formatter.format(new Date(`${moved.sourceDate}T00:00:00Z`))))
  assert.ok(text.includes(formatter.format(new Date(`${moved.destinationDate}T00:00:00Z`))))
  assert.ok(text.includes(team?.name || ui.scopes.ORGANIZATION))
  assert.equal((await section.innerText()).includes(moved.pairGenerationId), false, "Opaque generation must not leak into UX")
  assert.equal(await section.locator("#workforce-calendar-scope").isDisabled(), true)
  assert.equal(await section.getByRole("button", { name: ui.refresh, exact: true }).isDisabled(), true)
  await page.screenshot({ path: `${outputDirectory}/confirmation-${moved.scope}-${moved.sourceDate}.png`, fullPage: true })
  return confirmation
}
async function state(principal, moved) {
  const rows = await admin.mtmWorkCalendarDay.findMany({
    where: { organizationId: principal.organizationId, name: moved.name }, orderBy: { date: "asc" },
  })
  const audits = await admin.mtmAuditLog.findMany({
    where: { organizationId: principal.organizationId, action: "WORKFORCE_CALENDAR_MOVED_DAY_REVERSED", entityId: moved.pairGenerationId }, orderBy: { id: "asc" },
  })
  // Display labels may be reused by distinct physical pairs. Retain every
  // same-label row, but bind reversal assertions to this exact scoped pair.
  const pairRows = rows.filter(row => row.agentId === null
    && row.teamId === (moved.scope === "TEAM" ? moved.teamId : null)
    && [moved.sourceDate, moved.destinationDate].includes(row.date.toISOString().slice(0, 10)))
  return JSON.parse(JSON.stringify({ rows: pairRows,
    otherSameNameRows: rows.filter(row => !pairRows.includes(row)), audits }))
}
function reversed(persisted, principal) {
  assert.equal(persisted.rows.length, 2)
  assert.ok(persisted.rows[0].deletedAt)
  assert.equal(persisted.rows[0].deletedAt, persisted.rows[1].deletedAt)
  for (const row of persisted.rows) {
    assert.equal(row.updatedBy, principal.id)
    assert.equal(row.updatedAt, row.deletedAt)
  }
  assert.equal(persisted.audits.length, 1, "The Workforce mtm audit receipt must exist exactly once")
  assert.equal(persisted.audits[0].actorUserId, principal.id)
  assert.equal(persisted.audits[0].entity, "work_calendar_pair")
  assert.equal(persisted.audits[0].metadataKind, "workforce_calendar_configuration")
}
async function standard(principal, team, index, locale, viewport) {
  const view = await open(principal, locale, viewport)
  const moved = await pair(view.context, principal, index, team?.id)
  let posts = 0
  const listener = request => { if (calendarRoute(new URL(request.url())) && request.method() === "POST") posts++ }
  view.page.on("request", listener)
  await review(view, moved, team)
  assert.equal(posts, 0, "Opening confirmation must not mutate")
  await view.section.getByRole("button", { name: view.ui.reversalCancel, exact: true }).click()
  assert.equal(posts, 0, "Cancelling confirmation must not mutate")
  assert.equal((await state(principal, moved)).rows.every(row => row.deletedAt === null), true)
  await review(view, moved, team)
  const [response] = await Promise.all([
    view.page.waitForResponse(response => calendarRoute(new URL(response.url())) && response.request().method() === "POST"),
    view.section.getByRole("button", { name: view.ui.reversalConfirm, exact: true }).click(),
  ])
  assert.equal(response.status(), 200)
  assert.equal((await response.json()).data.reversed, true)
  await until(async () => (await view.section.innerText()).includes(view.ui.reversalRecorded), "reversal success notice")
  await until(async () => await view.section.locator('[aria-labelledby="workforce-calendar-reversal-title"]').count() === 0, "confirmation clears")
  assert.equal(posts, 1)
  await until(async () => !(await view.section.innerText()).includes(moved.name)
    && await view.section.getAttribute("aria-busy") === "false", "post-reversal inventory finishes refreshing")
  reversed(await state(principal, moved), principal)
  receipts.cases.push({ name: `confirmation-cancel-confirm-${moved.scope}-${locale}`, status: "PASS", posts, tombstones: 2, audits: 1 })
  await view.context.close()
}
async function lostResponse(principal, index = 3, locale = "en", viewport = { width: 1440, height: 1000 }) {
  const view = await open(principal, locale, viewport)
  const moved = await pair(view.context, principal, index)
  await review(view, moved)
  const committed = barrier()
  const delivery = barrier()
  const bodies = []
  const responses = []
  await view.page.route(calendarRoute, handled(async route => {
    if (route.request().method() !== "POST") return route.continue()
    bodies.push(route.request().postData())
    const response = await route.fetch({ timeout: 120_000, maxRedirects: 0 })
    assert.equal(response.status(), 200)
    const payload = await response.json()
    responses.push(payload.data.reversed)
    if (bodies.length === 1) {
      assert.equal(payload.data.reversed, true)
      committed.release()
      await delivery.promise
      await route.abort("connectionreset") // Actual transaction already committed.
    } else {
      assert.equal(payload.data.reversed, false)
      await route.fulfill({ response })
    }
  }))
  await view.section.getByRole("button", { name: view.ui.reversalConfirm, exact: true }).evaluate(button => {
    button.click()
    button.click() // Same browser task: exercises the synchronous shared token.
  })
  await until(() => responses.length === 1, "first real commit", 120_000)
  await committed.promise
  assert.equal(bodies.length, 1, "Same-task double submit must send one POST")
  const beforeRetry = await state(principal, moved)
  reversed(beforeRetry, principal)
  assert.equal(await view.section.getByRole("button", { name: view.ui.reversalConfirm, exact: true }).isDisabled(), true)
  delivery.release()
  await until(async () => (await view.section.getByRole("alert").innerText()).includes(view.ui.reversalOutcomeUnknown), "unknown outcome after committed response loss")
  await until(async () => view.section.getByRole("alert").evaluate(element => {
    const bounds = element.getBoundingClientRect()
    const container = element.closest("main")?.getBoundingClientRect()
    return document.activeElement === element
      && bounds.top >= Math.max(0, container?.top ?? 0)
      && bounds.bottom <= Math.min(window.innerHeight, container?.bottom ?? window.innerHeight)
      && bounds.left >= Math.max(0, container?.left ?? 0)
      && bounds.right <= Math.min(window.innerWidth, container?.right ?? window.innerWidth)
  }), "unknown-outcome explanation is focused and fully visible")
  assert.equal(await view.section.locator('[aria-labelledby="workforce-calendar-reversal-title"]').count(), 1)
  assert.equal(await view.section.locator("#workforce-calendar-scope").isDisabled(), true)
  await view.page.screenshot({ path: `${outputDirectory}/exact-retry-unknown-${locale}.png`, fullPage: true })
  await view.section.getByRole("button", { name: view.ui.reversalConfirm, exact: true }).click()
  await until(async () => (await view.section.innerText()).includes(view.ui.reversalAlreadyRecorded), "actual audit-backed replay notice")
  assert.equal(bodies.length, 2)
  assert.equal(bodies[0], bodies[1], "Retry must preserve the exact serialized generation-bound draft")
  assert.deepEqual(responses, [true, false])
  assert.deepEqual(await state(principal, moved), beforeRetry, "Replay must not alter either tombstone or audit")
  await until(async () => !(await view.section.innerText()).includes(moved.name)
    && await view.section.getAttribute("aria-busy") === "false", "post-replay inventory finishes refreshing")
  receipts.cases.push({ name: `committed-response-loss-exact-retry-same-task-double-submit-${locale}`, status: "PASS", posts: 2, reversedResponses: responses, byteIdenticalRetry: true, replayWrites: 0, unknownNoticeVisibleAndFocused: true })
  await view.context.close()
}
async function keyboardCancelConfirm(principal) {
  const view = await open(principal)
  const moved = await pair(view.context, principal, 7)
  const before = await state(principal, moved)
  let posts = 0
  let sourceTabs = 0
  view.page.on("request", request => { if (calendarRoute(new URL(request.url())) && request.method() === "POST") posts++ })
  const confirmation = await review(view, moved, null, async action => {
    sourceTabs = await tabToButton(view.page, action)
    assert.ok(sourceTabs > 0, "Initial source action must be reached with native Tab")
    await view.page.keyboard.press("Enter")
  })
  const confirm = confirmation.getByRole("button", { name: view.ui.reversalConfirm, exact: true })
  const cancel = confirmation.getByRole("button", { name: view.ui.reversalCancel, exact: true })
  await tabToNext(view.page, confirm)
  await tabToNext(view.page, cancel)
  await tabToNext(view.page, confirm, "Shift+Tab")
  await tabToNext(view.page, cancel)
  assert.equal(posts, 0, "Keyboard review and Tab navigation must not mutate")
  await view.page.keyboard.press("Space")
  await until(async () => await view.section.locator('[aria-labelledby="workforce-calendar-reversal-title"]').count() === 0, "keyboard cancel removes the review")
  const sourceAction = view.section.getByRole("button", { name: view.ui.reversalActionLabel.replace("{name}", moved.name), exact: true })
  await focusedInViewport(sourceAction, "cancel restores the original source action focus and visibility")
  assert.equal(await sourceAction.isDisabled(), false)
  assert.equal(posts, 0)
  assert.deepEqual(await state(principal, moved), before, "Keyboard cancel must preserve the complete rows and audit state")
  await view.page.screenshot({ path: `${outputDirectory}/keyboard-cancel-source-ORGANIZATION-en.png`, fullPage: true })
  await view.page.keyboard.press("Enter")
  await reviewedConfirmation(view, moved)
  await tabToNext(view.page, confirm)
  const [response] = await Promise.all([
    view.page.waitForResponse(response => calendarRoute(new URL(response.url())) && response.request().method() === "POST"),
    view.page.keyboard.press("Enter"),
  ])
  assert.equal(response.status(), 200)
  assert.equal((await response.json()).data.reversed, true)
  await until(async () => !(await view.section.innerText()).includes(moved.name)
    && await view.section.getAttribute("aria-busy") === "false", "keyboard reversal inventory settles")
  const result = view.section.getByRole("status")
  assert.ok((await result.innerText()).includes(view.ui.reversalRecorded))
  await focusedInViewport(result, "completed reversal notice receives stable focus")
  assert.equal(posts, 1)
  reversed(await state(principal, moved), principal)
  await assertSession(view.context, principal, "keyboard-cancel-confirm")
  await view.page.screenshot({ path: `${outputDirectory}/keyboard-completed-ORGANIZATION-en.png`, fullPage: true })
  receipts.cases.push({ name: "keyboard-cancel-reopen-confirm-ORGANIZATION-en", status: "PASS", nativeTabNavigation: true, sourceTabs, openedWithEnter: true, confirmationTabOrder: true, shiftTabReturnsToConfirm: true, cancelledWithSpace: true, cancelWrites: 0, cancelStateUnchanged: true, cancelRestoresSourceFocus: true, reopenedWithEnter: true, confirmedWithEnter: true, resultFocusedAndVisible: true, posts, tombstones: 2, audits: 1, realSessionPreserved: true })
  await view.context.close()
}
async function keyboardLostResponse(principal, team) {
  const view = await open(principal, "ru", { width: 390, height: 844 })
  const moved = await pair(view.context, principal, 8, team.id)
  let sourceTabs = 0
  const confirmation = await review(view, moved, team, async action => {
    sourceTabs = await tabToButton(view.page, action)
    assert.ok(sourceTabs > 0, "Initial TEAM source action must be reached with native Tab")
    await view.page.keyboard.press("Enter")
  })
  const delivery = barrier()
  const bodies = []
  const responses = []
  await view.page.route(calendarRoute, handled(async route => {
    if (route.request().method() !== "POST") return route.continue()
    bodies.push(route.request().postData())
    const response = await route.fetch({ timeout: 120_000, maxRedirects: 0 })
    assert.equal(response.status(), 200)
    const payload = await response.json()
    responses.push(payload.data.reversed)
    if (bodies.length === 1) {
      assert.equal(payload.data.reversed, true)
      await delivery.promise
      await route.abort("connectionreset")
    } else {
      assert.equal(payload.data.reversed, false)
      await route.fulfill({ response })
    }
  }))
  const confirm = confirmation.getByRole("button", { name: view.ui.reversalConfirm, exact: true })
  const cancel = confirmation.getByRole("button", { name: view.ui.reversalCancel, exact: true })
  await tabToNext(view.page, confirm)
  await view.page.keyboard.press("Space")
  await until(() => responses.length === 1, "keyboard confirmation commits before response loss", 120_000)
  const beforeRetry = await state(principal, moved)
  reversed(beforeRetry, principal)
  assert.equal(bodies.length, 1)
  assert.equal(await confirm.isDisabled(), true)
  assert.equal(await cancel.isDisabled(), true)
  delivery.release()
  const alert = view.section.getByRole("alert")
  await until(async () => (await alert.innerText()).includes(view.ui.reversalOutcomeUnknown), "keyboard unknown-outcome explanation")
  await focusedInViewport(alert, "unknown-outcome explanation is focused and fully visible for keyboard retry")
  await until(async () => !(await confirm.isDisabled()), "exact retry becomes available")
  assert.equal(await view.section.locator("#workforce-calendar-scope").isDisabled(), true)
  assert.equal(await view.section.locator("#workforce-calendar-team").inputValue(), team.id)
  await view.page.screenshot({ path: `${outputDirectory}/keyboard-exact-retry-unknown-TEAM-ru.png`, fullPage: true })
  await tabToNext(view.page, confirm)
  await view.page.keyboard.press("Enter")
  await until(async () => (await view.section.innerText()).includes(view.ui.reversalAlreadyRecorded)
    && !(await view.section.innerText()).includes(moved.name)
    && await view.section.getAttribute("aria-busy") === "false", "keyboard audit-backed replay inventory settles")
  assert.equal(bodies.length, 2)
  assert.equal(bodies[0], bodies[1], "Keyboard retry must preserve the exact serialized generation-bound TEAM draft")
  assert.deepEqual(responses, [true, false])
  assert.deepEqual(await state(principal, moved), beforeRetry, "Keyboard replay must not change either tombstone or audit")
  const result = view.section.getByRole("status")
  assert.ok((await result.innerText()).includes(view.ui.reversalAlreadyRecorded))
  await focusedInViewport(result, "audit-backed replay result receives stable keyboard focus")
  await assertSession(view.context, principal, "keyboard-team-replay")
  await view.page.screenshot({ path: `${outputDirectory}/keyboard-replay-TEAM-ru.png`, fullPage: true })
  receipts.cases.push({ name: "keyboard-committed-response-loss-exact-retry-TEAM-ru", status: "PASS", nativeTabNavigation: true, sourceTabs, openedWithEnter: true, confirmedWithSpace: true, pendingButtonsDisabled: true, unknownNoticeVisibleAndFocused: true, alertTabReachesExactConfirm: true, retriedWithEnter: true, posts: 2, reversedResponses: responses, byteIdenticalRetry: true, replayWrites: 0, resultFocusedAndVisible: true, realSessionPreserved: true })
  await view.context.close()
}
// New 320-CSS-pixel evidence is separate from the nine existing strict cases.
// Collect horizontal failures before asserting them at case completion so the
// original viewport screenshots also preserve every observed clipping phase.
async function reflowGeometry(view, phase) {
  const diagnostic = await view.section.locator("h2, h3, p, label, button, input, select, li span").evaluateAll(elements => {
    const failures = []
    let textFragments = 0
    const tolerance = 1 // CSS-pixel rounding only; existing cases stay strict.
    for (const [index, element] of elements.entries()) {
      const bounds = element.getBoundingClientRect()
      const section = element.closest('section[aria-labelledby="workforce-calendar-configuration-title"]')
      const main = element.closest("main")
      if (!main || !section || bounds.width <= 0 || bounds.height <= 0) {
        failures.push({ index, tag: element.tagName, kind: "missing-visible-element" })
        continue
      }
      const sectionBounds = section.getBoundingClientRect()
      const mainBounds = main.getBoundingClientRect()
      let left = Math.max(0, sectionBounds.left, mainBounds.left)
      let right = Math.min(window.innerWidth, sectionBounds.right, mainBounds.right)
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (["hidden", "clip", "auto", "scroll"].includes(getComputedStyle(ancestor).overflowX)) {
          const box = ancestor.getBoundingClientRect()
          left = Math.max(left, box.left + ancestor.clientLeft)
          right = Math.min(right, box.left + ancestor.clientLeft + ancestor.clientWidth)
        }
      }
      if (bounds.left < left - tolerance || bounds.right > right + tolerance) {
        failures.push({ index, tag: element.tagName, kind: "element", left: bounds.left, right: bounds.right, clipLeft: left, clipRight: right })
      }
      // Native input/select text is rendered by the browser; their control
      // boxes are checked above. Paragraph/button text must fit its own box.
      if (["INPUT", "SELECT"].includes(element.tagName)) continue
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      let fragments = 0
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        for (const text of range.getClientRects()) {
          if (text.width <= 0 || text.height <= 0) continue
          fragments++
          const clipLeft = Math.max(left, bounds.left)
          const clipRight = Math.min(right, bounds.right)
          if (text.left < clipLeft - tolerance || text.right > clipRight + tolerance) {
            failures.push({ index, tag: element.tagName, kind: "text", left: text.left, right: text.right, clipLeft, clipRight })
          }
        }
      }
      if (element.textContent.trim() && fragments === 0) failures.push({ index, tag: element.tagName, kind: "missing-text-fragments" })
      textFragments += fragments
    }
    return { viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, toleranceCssPixels: tolerance, elements: elements.length, textFragments, failures }
  })
  assert.equal(diagnostic.viewportWidth, 320)
  assert.equal(diagnostic.viewportHeight, view.nativeZoom?.zoomed.height ?? 844)
  assert.ok(diagnostic.elements > 0 && diagnostic.textFragments > 0)
  receipts.reflowDiagnostics.push({ phase, ...diagnostic })
  await evidenceScreenshot(view.page, `${outputDirectory}/reflow-320-${phase}.png`, false)
}
async function readReflowText(view, locator, phase) {
  // Reading probes scroll only. Native navigation/product effects establish
  // focus, which must remain unchanged through every text-line scroll probe.
  const elements = await locator.all()
  assert.ok(elements.length > 0, "The requested reflow text must actually exist")
  for (const element of elements) {
    const diagnostic = await element.evaluate(async paragraph => {
      const focused = document.activeElement
      const main = paragraph.closest("main")
      if (!main) return { fragments: 0, scrolls: 0, verticallyReadable: false, focusPreserved: false }
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
      let fragments = 0
      let scrolls = 0
      let verticallyReadable = true
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        const count = range.getClientRects().length
        for (let index = 0; index < count; index++) {
          let bounds = range.getClientRects()[index]
          if (!bounds || bounds.width <= 0 || bounds.height <= 0) continue
          const viewport = main.getBoundingClientRect()
          const top = Math.max(0, viewport.top)
          const bottom = Math.min(window.innerHeight, viewport.bottom)
          const delta = bounds.top < top ? bounds.top - top : bounds.bottom > bottom ? bounds.bottom - bottom : 0
          if (delta) {
            main.scrollBy({ top: delta, behavior: "instant" })
            scrolls++
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            bounds = range.getClientRects()[index]
          }
          fragments++
          const paragraphBounds = paragraph.getBoundingClientRect()
          let clipTop = Math.max(top, paragraphBounds.top)
          let clipBottom = Math.min(bottom, paragraphBounds.bottom)
          for (let ancestor = paragraph.parentElement; ancestor; ancestor = ancestor.parentElement) {
            if (["hidden", "clip", "auto", "scroll"].includes(getComputedStyle(ancestor).overflowY)) {
              const box = ancestor.getBoundingClientRect()
              clipTop = Math.max(clipTop, box.top + ancestor.clientTop)
              clipBottom = Math.min(clipBottom, box.top + ancestor.clientTop + ancestor.clientHeight)
            }
          }
          verticallyReadable &&= Boolean(bounds && bounds.top >= clipTop - 1 && bounds.bottom <= clipBottom + 1)
        }
      }
      return { fragments, scrolls, verticallyReadable, focusPreserved: document.activeElement === focused }
    })
    receipts.readingDiagnostics.push({ phase, ...diagnostic })
    assert.ok(diagnostic.fragments > 0)
    assert.equal(diagnostic.verticallyReadable, true, "Each reflow text line must be reachable by vertical reading scroll")
    assert.equal(diagnostic.focusPreserved, true, "Reading scroll must never inject or change focus")
  }
}
async function reviewedReflowConfirmation(view, moved, team, phase) {
  const title = view.section.getByRole("heading", { name: view.ui.reversalReviewTitle, exact: true })
  await title.waitFor()
  await focusedInViewport(title, "320 CSS review title receives visible product focus")
  const confirmation = view.section.locator('[aria-labelledby="workforce-calendar-reversal-title"]')
  const text = await confirmation.innerText()
  const formatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" })
  assert.ok(text.includes(moved.name))
  assert.ok(text.includes(team.name))
  assert.ok(text.includes(formatter.format(new Date(`${moved.sourceDate}T00:00:00Z`))))
  assert.ok(text.includes(formatter.format(new Date(`${moved.destinationDate}T00:00:00Z`))))
  assert.equal((await view.section.innerText()).includes(moved.pairGenerationId), false)
  assert.equal(await view.section.locator("#workforce-calendar-scope").isDisabled(), true)
  assert.equal(await view.section.locator("#workforce-calendar-team").isDisabled(), true)
  assert.equal(await view.section.locator("#workforce-calendar-team").inputValue(), team.id)
  assert.equal(await view.section.getByRole("button", { name: view.ui.refresh, exact: true }).isDisabled(), true)
  await reflowGeometry(view, phase)
  await readReflowText(view, confirmation.locator("h3, p"), phase)
  await title.scrollIntoViewIfNeeded()
  await focusedInViewport(title, "reading probes preserve the product-focused review title")
  return confirmation
}
const contrastTargetKeys = ["source-action", "source-label", "source-date", "source-paired-date", "review-title", "review-label-team", "review-dates", "review-hint", "confirm-enabled-focused", "cancel-enabled-focused", "unknown-focused", "replay-focused"]
async function reflowTextContrast(view, locator, locale, phase, key, expectedTexts, requirements = {}) {
  assert.ok(contrastTargetKeys.includes(key))
  const target = { key, locale, phase, screenshot: `reflow-320-${phase}.png` }
  if (await locator.count() !== 1) {
    receipts.contrastDiagnostics.push({ ...target, status: "NOT_PROVEN", failures: [{ code: "required-single-text-target-missing" }] })
    return
  }
  await view.page.evaluate(() => document.fonts.ready)
  let observation
  try {
    observation = await locator.evaluate(collectRenderedTextContrast, { expectedTexts, ...requirements })
  } catch (error) {
    receipts.contrastDiagnostics.push({ ...target, status: "NOT_PROVEN", failures: [{ code: "browser-text-observation-failed", kind: error.name }] })
    return
  }
  const evaluation = evaluateTextContrast(observation)
  receipts.contrastDiagnostics.push({ ...target, observation, ...evaluation })
}
async function reflow320(principal, team, locale = "ru", index = 9, nativeZoom = false) {
  const labels = {
    ru: ["Проверка переноса", "Ж"],
    az: ["Köçürmənin yoxlanması", "Ş"],
    en: ["Moved-day reflow", "W"],
  }
  assert.ok(Object.hasOwn(labels, locale), "Reflow evidence requires one supported locale")
  const [prefix, repeatedCharacter] = labels[locale]
  const view = await open(principal, locale, { width: 320, height: 844 }, nativeZoom)
  const name = (`${prefix} ${suffix} ` + repeatedCharacter.repeat(160)).slice(0, 160)
  // Keep existing RU phase identities; additional locales have distinct receipts/PNGs.
  const phase = value => nativeZoom ? `native-200-${locale}-${value}` : locale === "ru" ? value : `${locale}-${value}`
  assert.equal(name.length, 160)
  assert.ok(/\S{80}/u.test(name), "The valid maximum-length fixture includes a long unbroken fragment")
  const moved = await pair(view.context, principal, index, team.id, name)
  const before = await state(principal, moved)
  assert.equal(before.rows.length, 2)
  assert.equal(before.otherSameNameRows.length, nativeZoom ? 2 : 0)
  assert.ok(before.otherSameNameRows.every(row => row.deletedAt !== null))
  let posts = 0
  view.page.on("request", request => { if (calendarRoute(new URL(request.url())) && request.method() === "POST") posts++ })
  await view.section.locator("#workforce-calendar-scope").selectOption("TEAM")
  await view.section.locator(`#workforce-calendar-team option[value="${team.id}"]`).waitFor({ state: "attached" })
  await view.section.locator("#workforce-calendar-team").selectOption(team.id)
  const source = view.section.getByRole("button", { name: view.ui.reversalActionLabel.replace("{name}", name), exact: true })
  const sourceTabs = await tabToButton(view.page, source)
  assert.ok(sourceTabs > 0)
  await focusedInViewport(source, "320 CSS source action is visibly reached by native Tab")
  await reflowGeometry(view, phase("inventory"))
  const formatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" })
  const sourceDate = formatter.format(new Date(`${moved.sourceDate}T00:00:00Z`))
  const destinationDate = formatter.format(new Date(`${moved.destinationDate}T00:00:00Z`))
  const inventoryText = source.locator("xpath=ancestor::li[1]").locator(":scope > div").first().locator(":scope > p")
  await reflowTextContrast(view, source, locale, phase("inventory"), "source-action", [view.ui.reversalAction], { focused: true, enabled: true })
  await reflowTextContrast(view, inventoryText.nth(0), locale, phase("inventory"), "source-label", [name])
  await reflowTextContrast(view, inventoryText.nth(1), locale, phase("inventory"), "source-date", [sourceDate])
  await reflowTextContrast(view, inventoryText.nth(2), locale, phase("inventory"), "source-paired-date", [destinationDate])
  assert.equal(await view.section.getByText(name, { exact: true }).count(), 2, "Both original pair labels must be present")
  await readReflowText(view, view.section.getByText(name, { exact: true }), phase("inventory-label"))
  await source.scrollIntoViewIfNeeded()
  await focusedInViewport(source, "reading long inventory labels preserves native source focus")
  await view.page.keyboard.press("Enter")
  const confirmation = await reviewedReflowConfirmation(view, moved, team, phase("review"))
  const reviewText = confirmation.locator(":scope > p")
  await reflowTextContrast(view, confirmation.locator("#workforce-calendar-reversal-title"), locale, phase("review"), "review-title", [view.ui.reversalReviewTitle], { focused: true })
  await reflowTextContrast(view, reviewText.nth(0), locale, phase("review"), "review-label-team", [name, team.name])
  await reflowTextContrast(view, reviewText.nth(1), locale, phase("review"), "review-dates", [sourceDate, destinationDate])
  await reflowTextContrast(view, reviewText.nth(2), locale, phase("review"), "review-hint", [view.ui.reversalReviewHint])
  const confirm = confirmation.getByRole("button", { name: view.ui.reversalConfirm, exact: true })
  const cancel = confirmation.getByRole("button", { name: view.ui.reversalCancel, exact: true })
  await tabToNext(view.page, confirm)
  await reflowGeometry(view, phase("confirm"))
  await reflowTextContrast(view, confirm, locale, phase("confirm"), "confirm-enabled-focused", [view.ui.reversalConfirm], { focused: true, enabled: true })
  await tabToNext(view.page, cancel)
  await reflowGeometry(view, phase("cancel"))
  await reflowTextContrast(view, cancel, locale, phase("cancel"), "cancel-enabled-focused", [view.ui.reversalCancel], { focused: true, enabled: true })
  assert.equal(posts, 0)
  await view.page.keyboard.press("Space")
  await until(async () => await confirmation.count() === 0, "320 CSS cancel removes the review")
  await focusedInViewport(source, "320 CSS cancel restores visible source focus")
  assert.equal(await source.isDisabled(), false)
  assert.equal(posts, 0)
  assert.deepEqual(await state(principal, moved), before)
  await reflowGeometry(view, phase("cancel-source"))
  await view.page.keyboard.press("Enter")
  await reviewedReflowConfirmation(view, moved, team, phase("reopened-review"))
  const delivery = barrier()
  const bodies = []
  const responses = []
  await view.page.route(calendarRoute, handled(async route => {
    if (route.request().method() !== "POST") return route.continue()
    bodies.push(route.request().postData())
    const response = await route.fetch({ timeout: 120_000, maxRedirects: 0 })
    assert.equal(response.status(), 200)
    const payload = await response.json()
    responses.push(payload.data.reversed)
    if (bodies.length === 1) {
      assert.equal(payload.data.reversed, true)
      await delivery.promise
      await route.abort("connectionreset")
    } else {
      assert.equal(payload.data.reversed, false)
      await route.fulfill({ response })
    }
  }))
  await tabToNext(view.page, confirm)
  await view.page.keyboard.press("Space")
  await until(() => responses.length === 1, "320 CSS real transaction commits before response loss", 120_000)
  const beforeRetry = await state(principal, moved)
  reversed(beforeRetry, principal)
  assert.deepEqual(beforeRetry.otherSameNameRows, before.otherSameNameRows,
    "Reversal must preserve same-label rows outside the exact pair")
  assert.equal(posts, 1)
  assert.equal(bodies.length, 1)
  assert.deepEqual(JSON.parse(bodies[0]), {
    operation: "REVERSE_MOVE_WORKDAY", scope: "TEAM", teamId: team.id,
    sourceDate: moved.sourceDate, destinationDate: moved.destinationDate, pairGenerationId: moved.pairGenerationId,
  })
  assert.equal(await confirm.isDisabled(), true)
  assert.equal(await cancel.isDisabled(), true)
  delivery.release()
  const alert = view.section.getByRole("alert")
  await until(async () => (await alert.innerText()).includes(view.ui.reversalOutcomeUnknown), "320 CSS unknown outcome")
  await focusedInViewport(alert, "320 CSS unknown explanation receives fully visible product focus")
  await reflowGeometry(view, phase("unknown"))
  await readReflowText(view, alert, phase("unknown"))
  await reflowTextContrast(view, alert, locale, phase("unknown"), "unknown-focused", [view.ui.reversalOutcomeUnknown], { focused: true })
  await until(async () => !(await confirm.isDisabled()), "320 CSS exact retry becomes available")
  assert.equal(await view.section.locator("#workforce-calendar-scope").isDisabled(), true)
  assert.equal(await view.section.locator("#workforce-calendar-team").inputValue(), team.id)
  await tabToNext(view.page, confirm)
  await reflowGeometry(view, phase("retry-confirm"))
  await view.page.keyboard.press("Enter")
  await until(async () => (await view.section.innerText()).includes(view.ui.reversalAlreadyRecorded)
    && !(await view.section.innerText()).includes(name)
    && await view.section.getAttribute("aria-busy") === "false", "320 CSS replay inventory settles")
  assert.equal(posts, 2)
  assert.equal(bodies.length, 2)
  assert.equal(bodies[0], bodies[1])
  assert.deepEqual(responses, [true, false])
  assert.deepEqual(await state(principal, moved), beforeRetry)
  const result = view.section.getByRole("status")
  assert.ok((await result.innerText()).includes(view.ui.reversalAlreadyRecorded))
  await focusedInViewport(result, "320 CSS replay result receives stable visible focus")
  await reflowGeometry(view, phase("replay"))
  await readReflowText(view, result, phase("replay"))
  await reflowTextContrast(view, result, locale, phase("replay"), "replay-focused", [view.ui.reversalAlreadyRecorded], { focused: true })
  assert.equal(await view.section.locator("#workforce-calendar-team").inputValue(), team.id)
  await assertSession(view.context, principal, "320-css-team-replay")
  const functional = { cancelWrites: 0, cancelStateUnchanged: true, posts, tombstones: 2, audits: 1, byteIdenticalRetry: true, reversedResponses: responses, replayWrites: 0, realSessionPreserved: true, otherSameNameRows: before.otherSameNameRows.length, otherSameNameRowsUnchanged: true }
  if (locale === "ru" && !nativeZoom) receipts.reflowFunctional = functional
  assert.equal(receipts.reflowDiagnostics.reduce((count, phase) => count + phase.failures.length, 0), 0,
    "320 CSS controls and every text fragment must fit their visible horizontal bounds")
  receipts.cases.push({ name: `${nativeZoom ? "native-200" : "320-css"}-reflow-keyboard-cancel-exact-retry-TEAM-${locale}`, status: "PASS",
    viewport: { width: 320, height: view.nativeZoom?.zoomed.height ?? 844 }, ...(nativeZoom ? { browserZoom: view.nativeZoom } : {}),
    labelLength: 160, sourceTabs, nativeKeyboard: true, verticalReadingScrollOnly: true, horizontalContainment: true, focusedTargetsVisible: true, ...functional })
  await view.context.close()
}
async function switchContext(from, to, index, targetTeam, label) {
  const view = await open(from)
  const moved = await pair(view.context, from, index)
  await review(view, moved)
  const delivery = barrier()
  const newReadDelivery = barrier()
  let oldCommitted = false
  let oldDelivered = false
  let oldFinished = false
  let holdNewRead = false
  let obsoleteResponseReleased = false
  let heldNewRead
  let newReadReady = false
  let newReadFinished = false
  let posts = 0
  view.page.on("requestfinished", request => {
    if (calendarRoute(new URL(request.url())) && request.method() === "POST") oldFinished = true
    if (request === heldNewRead) newReadFinished = true
  })
  view.page.on("requestfailed", request => {
    if (calendarRoute(new URL(request.url()))) readDiagnostics.push({
      phase: `${label}-request-failed`, method: request.method(), requestFailed: true,
      matchesHeldRead: request === heldNewRead, beforeObsoleteResponse: !obsoleteResponseReleased,
      aborted: request.failure()?.errorText === "net::ERR_ABORTED",
    })
  })
  await view.page.route(calendarRoute, handled(async route => {
    const request = route.request()
    if (request.method() === "POST") {
      posts++
      const response = await route.fetch({ timeout: 120_000, maxRedirects: 0 })
      assert.equal(response.status(), 200)
      assert.equal((await response.json()).data.reversed, true)
      oldCommitted = true
      await delivery.promise
      await route.fulfill({ response })
      oldDelivered = true
    } else if (request.headers()["x-organization-id"] === to.organizationId && oldCommitted && holdNewRead && !heldNewRead) {
      heldNewRead = request
      const response = await route.fetch({ timeout: 120_000, maxRedirects: 0 })
      await checkedContextRead(response, `${label}-held-context-read`, targetTeam)
      newReadReady = true
      await newReadDelivery.promise
      await route.fulfill({ response })
    } else await route.continue()
  }))
  await view.section.getByRole("button", { name: view.ui.reversalConfirm, exact: true }).click()
  await until(() => oldCommitted, "old principal transaction commits", 120_000)
  reversed(await state(from, moved), from)
  await authenticate(view.context, to)
  // Auth.js' existing broadcast listener refetches its own real session; no
  // session payload is injected. Focus refetch is intentionally disabled here.
  const [bootstrapResponse] = await Promise.all([
    view.page.waitForResponse(response => calendarRoute(new URL(response.url()))
      && response.request().method() === "GET" && response.request().headers()["x-organization-id"] === to.organizationId
      && new URL(response.url()).searchParams.get("scope") === "ORGANIZATION"),
    view.page.evaluate(() => {
      const channel = new BroadcastChannel("next-auth")
      channel.postMessage({ event: "session", data: { trigger: "getSession" } })
      channel.close()
    }),
  ])
  await checkedContextRead(bootstrapResponse, `${label}-context-bootstrap-read`, targetTeam)
  await until(async () => await view.page.getByText(to.name, { exact: true }).isVisible()
    && await view.section.locator("#workforce-calendar-date").isVisible()
    && await view.section.getAttribute("aria-busy") === "false", "real new-context bootstrap settles before holding its refresh")
  await assertSession(view.context, to, `${label}-bootstrapped-context`)
  // The dashboard remounts on identity changes. Let its development effect
  // cleanup finish, then hold one real user refresh instead of a mount GET.
  holdNewRead = true
  await view.section.getByRole("button", { name: view.ui.refresh, exact: true }).click()
  await until(() => newReadReady, "specific new-context GET succeeds and is held", 120_000)
  assert.equal(heldNewRead.failure(), null, "The exact held refresh must be live before releasing the obsolete POST")
  assert.equal(newReadFinished, false, "The live refresh must still be held")
  assert.equal(await view.section.getAttribute("aria-busy"), "true", "The new-context UI must be waiting for its held refresh")
  assert.equal(await view.section.locator('[aria-labelledby="workforce-calendar-reversal-title"]').count(), 0)
  assert.equal((await view.section.innerText()).includes(moved.name), false)
  obsoleteResponseReleased = true
  delivery.release()
  await until(() => oldDelivered, "obsolete response delivery")
  await until(() => oldFinished, "obsolete POST finishes in the browser")
  await view.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal((await view.section.innerText()).includes(view.ui.reversalRecorded), false)
  assert.equal(heldNewRead.failure(), null, "The obsolete POST must not cancel the exact live new-context refresh")
  assert.equal(newReadFinished, false, "The exact new-context refresh must remain held after obsolete POST settlement")
  newReadDelivery.release()
  await until(() => newReadFinished, "new context GET survives obsolete POST settlement")
  await until(async () => await view.section.locator("#workforce-calendar-date").isVisible()
    && await view.section.getAttribute("aria-busy") === "false", "held new-context read settles in the UI")
  await assertSession(view.context, to, `${label}-settled-context`)
  assert.equal((await view.section.innerText()).includes(view.ui.reversalRecorded), false)
  assert.equal(posts, 1)
  const [scopeResponse] = await Promise.all([
    view.page.waitForResponse(response => calendarRoute(new URL(response.url()))
      && response.request().method() === "GET" && response.request().headers()["x-organization-id"] === to.organizationId
      && new URL(response.url()).searchParams.get("scope") === "ORGANIZATION"),
    view.section.locator("#workforce-calendar-scope").selectOption("TEAM"),
  ])
  await checkedContextRead(scopeResponse, `${label}-scope-bootstrap-read`, targetTeam)
  await until(async () => await view.section.getAttribute("aria-busy") === "false", "scope bootstrap read settles before selecting its team")
  await view.section.locator(`#workforce-calendar-team option[value="${targetTeam.id}"]`).waitFor({ state: "attached" })
  const [teamResponse] = await Promise.all([
    view.page.waitForResponse(response => calendarRoute(new URL(response.url()))
      && response.request().method() === "GET" && response.request().headers()["x-organization-id"] === to.organizationId
      && new URL(response.url()).searchParams.get("scope") === "TEAM"
      && new URL(response.url()).searchParams.get("teamId") === targetTeam.id),
    view.section.locator("#workforce-calendar-team").selectOption(targetTeam.id),
  ])
  const selected = await checkedContextRead(teamResponse, `${label}-selected-team-read`, targetTeam)
  assert.equal(selected.team.id, targetTeam.id)
  await until(async () => await view.section.locator("#workforce-calendar-date").isVisible()
    && await view.section.getAttribute("aria-busy") === "false"
    && await view.section.locator("#workforce-calendar-team").inputValue() === targetTeam.id, "selected-team read settles in the new context")
  await assertSession(view.context, to, `${label}-settled-team`)
  assert.equal(posts, 1, "Settled new-context navigation must not send another POST")
  await view.page.screenshot({ path: `${outputDirectory}/context-${label}.png`, fullPage: true })
  receipts.cases.push({ name: `late-committed-response-${label}-switch`, status: "PASS", realSessionChanged: true, staleNotice: false, newReadCompleted: true, exactHeldRead: true, newContextRefreshHeld: true, heldReadLiveBeforeObsoleteResponse: true, obsoleteResponseDidNotCancelHeldRead: true, realSessionPreserved: true, teamNavigationCompleted: true, posts })
  await view.context.close()
}

try {
  const role = await app.$queryRaw`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`
  assert.deepEqual(role.map(value => [value.rolsuper, value.rolbypassrls]), [[false, false]])
  const passwordHash = await bcrypt.hash(password, 4)
  const principals = []
  const teams = []
  for (let index = 0; index < 2; index++) {
    const organization = await admin.organization.create({ data: {
      name: `Workforce browser fixture ${index}`, slug: `wf-browser-${suffix}-${index}`,
      plan: "enterprise", modules: { "workforce-hrm": true }, features: ["workforce-hrm"], settings: {},
    } })
    teams.push(await admin.mtmTeam.create({ data: { organizationId: organization.id, name: `Browser team ${index}`, code: `BROWSER-${index}` } }))
    for (let actor = 0; actor < (index === 0 ? 2 : 1); actor++) {
      const user = await admin.user.create({ data: {
        organizationId: organization.id, email: `browser-${suffix}-${index}-${actor}@example.test`,
        name: `Browser administrator ${index}-${actor}`, passwordHash, role: "admin",
        require2fa: false, totpEnabled: false, smsAuthEnabled: false, preferredLanguage: "en",
      } })
      principals.push({ ...user, slug: organization.slug })
    }
  }
  // Relevant tables really fail closed for the non-owner application role.
  assert.equal(await app.user.count(), 0)
  assert.equal(await app.mtmTeam.count(), 0)
  assert.equal(await app.mtmAuditLog.count(), 0)
  receipts.databaseRole = { superuser: false, bypassRls: false, unscopedUsers: 0, unscopedTeams: 0, unscopedWorkforceAudits: 0 }
  browser = await chromium.launch({ headless: true })
  await standard(principals[0], null, 0, "en", { width: 1440, height: 1000 })
  await standard(principals[0], teams[0], 1, "ru", { width: 390, height: 844 })
  await standard(principals[0], null, 2, "az", { width: 1440, height: 1000 })
  await lostResponse(principals[0])
  await lostResponse(principals[0], 6, "ru", { width: 390, height: 844 })
  await switchContext(principals[0], principals[1], 4, teams[0], "principal")
  await switchContext(principals[0], principals[2], 5, teams[1], "tenant")
  await keyboardCancelConfirm(principals[0])
  await keyboardLostResponse(principals[0], teams[0])
  assert.equal(receipts.cases.length, 9, "All nine existing scenarios must complete before the new reflow case")
  await reflow320(principals[0], teams[0])
  assert.equal(receipts.cases.length, 10)
  await reflow320(principals[0], teams[0], "az", 10)
  await reflow320(principals[0], teams[0], "en", 11)
  assert.equal(receipts.cases.length, 12)
  assert.equal(receipts.contrastDiagnostics.length, 36, "All existing contrast observations must complete before native zoom")
  assert.equal(receipts.contrastDiagnostics.every(target => target.status === "PASS"), true, "Native cases cannot hide a baseline failure")
  await reflow320(principals[0], teams[0], "en", 12, true)
  await reflow320(principals[0], teams[0], "ru", 13, true)
  await reflow320(principals[0], teams[0], "az", 14, true)
  assert.equal(receipts.cases.length, 15)
  assert.equal(receipts.nativeZoomDiagnostics.length, 3)
  receipts.nativeZoomVerdict = "PASS"
  assert.equal(new Set(receipts.reflowDiagnostics.map(({ phase }) => phase)).size, receipts.reflowDiagnostics.length,
    "Each localized reflow phase must retain a distinct receipt and screenshot identity")
  assert.equal(await app.mtmAuditLog.count(), 0, "Existing Workforce audit receipts must be hidden without tenant context")
  assert.equal(await app.mtmWorkCalendarDay.count(), 0, "Existing calendar tombstones must be hidden without tenant context")
  receipts.databaseRole.populatedAuditAndCalendarFailClosed = true
  assert.equal(handlerErrors.length, 0)
  assert.equal(receipts.contrastDiagnostics.length, 72, "Existing36 and native20036 targets must all produce original observations")
  for (const nativeZoom of [false, true]) for (const locale of ["ru", "az", "en"]) {
    const keys = receipts.contrastDiagnostics.filter(target => target.locale === locale
      && target.phase.startsWith("native-200-") === nativeZoom).map(target => target.key)
    assert.equal(keys.length, 12)
    assert.deepEqual([...keys].sort(), [...contrastTargetKeys].sort(), "No missing or duplicated semantic contrast target may receive acceptance credit")
  }
  const passedTargets = receipts.contrastDiagnostics.filter(target => target.status === "PASS").length
  const lowContrastTargets = receipts.contrastDiagnostics.filter(target => target.status === "FAIL").length
  const notProvenTargets = receipts.contrastDiagnostics.filter(target => target.status === "NOT_PROVEN").length
  receipts.contrastVerdict = lowContrastTargets ? "FAIL" : notProvenTargets ? "NOT_PROVEN" : "PASS"
  receipts.contrastSummary = { criterion: "WCAG2.2 SC1.4.3 (bounded default-light text only)", requiredTargets: 72,
    originalTargets: 36, native200Targets: 36, passedTargets, lowContrastTargets, notProvenTargets,
    allTwelveFunctionalCasesPassed: receipts.cases.slice(0, 12).length === 12 && receipts.cases.slice(0, 12).every(test => test.status === "PASS"),
    allThreeNativeZoomCasesPassed: receipts.cases.slice(12).length === 3 && receipts.cases.slice(12).every(test => test.status === "PASS"),
    populatedRlsGuardReached: receipts.databaseRole.populatedAuditAndCalendarFailClosed }
  assert.equal(passedTargets, 72, "Every required default-light text target must meet its unrounded contrast threshold with proven paint/precision bounds")
  receipts.status = "PASS"
} catch (error) {
  receipts.status = "FAIL"
  // Playwright transport call logs can include authentication headers/body.
  const failureMessage = error.message.split("\n", 1)[0]
  const sourceFrame = String(error?.stack || "").split("\n").find(line => line.includes(import.meta.url))
  const position = sourceFrame?.match(/:(\d+):(\d+)\)?$/)
  const safePrimitive = value => typeof value === "number" && Number.isFinite(value)
    || typeof value === "boolean" || value === null ? value : { type: Array.isArray(value) ? "array" : typeof value }
  receipts.failure = { name: error.name, message: failureMessage,
    sourcePosition: position ? { line: Number(position[1]), column: Number(position[2]) } : null,
    ...(error?.name === "AssertionError" ? { actual: safePrimitive(error.actual), expected: safePrimitive(error.expected) } : {}),
  }
  receipts.readDiagnostics = readDiagnostics
  receipts.interceptedFailureCount = handlerErrors.length
  if (activePage && !activePage.isClosed()) await evidenceScreenshot(activePage, `${outputDirectory}/failure.png`, true).catch(() => {})
  process.exitCode = 1
  console.error(`Workforce calendar browser evidence failed: ${failureMessage}`)
} finally {
  for (const release of barriers) release()
  await Promise.allSettled(contexts.map(context => context.close()))
  const nativeCleanup = await Promise.allSettled(nativeZoomContexts.map(context => context.dispose()))
  receipts.nativeZoomCleanup = nativeCleanup.map((result, index) => ({ ordinal: index + 1, status: result.status === "fulfilled" ? "PASS" : "FAIL" }))
  if (nativeCleanup.some(result => result.status === "rejected")) {
    receipts.status = "FAIL"; receipts.nativeZoomVerdict = "FAIL CLEANUP"; process.exitCode = 1
  }
  await browser?.close()
  await Promise.allSettled([admin.$disconnect(), app.$disconnect()])
  receipts.completedAt = new Date().toISOString()
  await writeFile(`${outputDirectory}/receipt.json`, JSON.stringify(receipts, null, 2) + "\n")
  if (receipts.status === "PASS") console.log(`Workforce calendar browser evidence: ${receipts.cases.length} cases PASS; native profiles closed`)
  // The whole service DB is disposable. Never perform cleanup against an
  // existing org, production records, or a developer's database.
}
