import { execFileSync } from "node:child_process"
import { Buffer } from "node:buffer"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  HISTORICAL_LAYOUT_CONTROLS, HISTORICAL_LAYOUT_ROUTES,
  assertHistoricalCaptureEnvironment, assertHistoricalDatabaseEnvironment, assertHistoricalSemanticData,
  historicalFailureCode, historicalFixtureDigest, historicalMedian, historicalNavigationPreferencesMatch, validateHistoricalEvidence,
} from "./support-ux-historical-layout-contract.mjs"

export function historicalDataPath(id, stage) {
  if (id === "service-desk" || (id === "agent-desktop" && stage === "before")) return "/api/v1/tickets"
  if (id === "agent-desktop") return "/api/v1/support/agent-desktop"
  if (id === "support-entitlements") return "/api/v1/entitlements"
  if (id === "agent-calendar") return "/api/v1/calendar/agent"
  throw new Error("ROUTE_INVALID")
}

export function historicalRequestDisposition(url, method, baseUrl, postData, fixture) {
  const target = new URL(url)
  if (target.origin !== baseUrl || target.username || target.password) return "external"
  if (new Set(["GET", "HEAD"]).has(method)) return "read"
  if (target.search || target.hash || typeof postData !== "string") return "write"
  const paths = new Set(HISTORICAL_LAYOUT_ROUTES.map((route) => route.path))
  try {
    if (method === "POST" && target.pathname === "/api/v1/public/csp-report" && Buffer.byteLength(postData, "utf8") <= 16384) {
      const body = JSON.parse(postData)
      const document = new URL(body?.["csp-report"]?.["document-uri"])
      if (document.origin === baseUrl && !document.username && !document.password && !document.search && !document.hash && paths.has(document.pathname)) return "cspReport"
    }
    if (method === "PUT" && target.pathname === "/api/v1/users/me/preferences" && Buffer.byteLength(postData, "utf8") <= 2048 && fixture) {
      const body = JSON.parse(postData)
      if (historicalNavigationPreferencesMatch(body, fixture)) return "navigationPreferences"
    }
  } catch { /* Malformed/unknown bodies retain the strict write block. */ }
  return "write"
}

// Both exact runtimes use the same explicitly unsupported service-worker
// capability. Playwright's registration shim resolves undefined, which older
// Serwist dereferences; leaving that artificial exception would invalidate
// layout measurement. The context-level block remains a fail-safe.
export function initializeHistoricalBrowserState({ adminId }) {
  if (!Reflect.deleteProperty(Navigator.prototype, "serviceWorker") || "serviceWorker" in navigator) throw new Error("CAPTURE_ENVIRONMENT_INVALID")
  localStorage.setItem("theme", "light")
  for (const user of [adminId, "anonymous"]) localStorage.setItem("leaddrive_tours_" + user, JSON.stringify(["tickets"]))
}

const diagnosticPaths = new Set([
  ...HISTORICAL_LAYOUT_ROUTES.map((route) => route.path),
  "/api/auth/session", "/api/v1/tickets", "/api/v1/support/agent-desktop", "/api/v1/entitlements", "/api/v1/calendar/agent",
  "/api/v1/calls/active", "/api/v1/voip/capabilities", "/api/v1/web-chat/sessions/unread-count",
  "/api/v1/mtm/pharmacy-promotion-executions/sync-context", "/api/v1/public/csp-report",
  "/api/v1/users/me", "/api/v1/users/me/preferences", "/api/v1/users/me/notification-preferences", "/api/v1/notifications",
  "/api/v1/ai/voice/access",
  "/favicon.ico", "/manifest.json", "/manifest.webmanifest",
])

export function historicalNetworkDiagnostic(url, method, status, baseUrl) {
  const target = new URL(url)
  const endpoint = target.origin !== baseUrl ? "EXTERNAL" : diagnosticPaths.has(target.pathname) ? target.pathname : "OTHER_SAME_ORIGIN"
  const verb = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]).has(method) ? method : "OTHER_METHOD"
  const code = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 0
  return endpoint + "|" + verb + "|" + code
}

export function historicalConsoleDiagnostic(message) {
  if (/unsafe-eval|Evaluating a string as JavaScript/.test(message)) return "CSP_EVAL"
  if (message.startsWith("Failed to load resource:")) return "RESOURCE_FAILURE"
  return "OTHER_CONSOLE_ERROR"
}

function incrementDiagnostic(diagnostics, key) {
  if (Object.hasOwn(diagnostics, key)) diagnostics[key] += 1
  else if (Object.keys(diagnostics).length < 24) diagnostics[key] = 1
  else diagnostics.DIAGNOSTIC_LIMIT = (diagnostics.DIAGNOSTIC_LIMIT ?? 0) + 1
}

export async function completeHistoricalBackgroundRequest(request, kind) {
  try {
    const response = await request.response()
    return response?.status() === (kind === "cspReport" ? 204 : 200) && await response.finished() === null
  } catch { return false }
}

async function waitHistoricalBackgroundRequests(completions) {
  let timeout
  try {
    return await Promise.race([
      Promise.all(completions).then((results) => results.every(Boolean)),
      new Promise((resolve) => { timeout = setTimeout(() => resolve(false), 5000) }),
    ])
  } finally { clearTimeout(timeout) }
}

export async function verifyHistoricalBackgroundPersistence(prisma, fixture) {
  historicalFixtureDigest(fixture)
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`
    const userPreferenceRows = await tx.userPreference.count()
    const pref = await tx.userPreference.findUnique({ where: { userId: fixture.admin.id }, select: { userId: true, organizationId: true, favorites: true, recents: true } })
    const ticketCount = await tx.ticket.count({ where: { organizationId: fixture.organization.id, assignedTo: fixture.admin.id } })
    const entitlementCount = await tx.entitlement.count({ where: { organizationId: fixture.organization.id } })
    if (userPreferenceRows !== 1 || pref?.userId !== fixture.admin.id || pref?.organizationId !== fixture.organization.id || !historicalNavigationPreferencesMatch({ favorites: pref?.favorites, recents: pref?.recents }, fixture) || ticketCount !== fixture.ticketCount || entitlementCount !== 1) throw new Error("BACKGROUND_PERSISTENCE_MISMATCH")
    return { status: "verified", userPreferenceRows, selfOwned: true, validPreferences: true, ticketCount, entitlementCount }
  }, { timeout: 5000 })
}

export function finalizeHistoricalLayoutReport(report, stage, controlSha) {
  // Failure counters remain live through screenshot and page/context closure.
  // Preserve an incomplete receipt even when a late event or admission check
  // fails; never lose diagnosis by throwing before writing the artifact.
  report.status = "incomplete"
  for (const result of report.results) {
    if (result.status === "captured" && Object.values(result.failures).some((value) => value > 0)) {
      result.status = "failed"
      result.code = "RUNTIME_FAILURE"
    }
  }
  if (report.results.length === HISTORICAL_LAYOUT_ROUTES.length && report.results.every((result) => result.status === "captured")) {
    report.status = "captured"
    try { validateHistoricalEvidence(report, stage, controlSha) } catch (error) {
      report.status = "incomplete"
      report.validationFailureCode = historicalFailureCode(error)
    }
  }
  return report
}

export function historicalPrimaryLocator(page, id, stage, fixture) {
  const title = id === "support-entitlements" ? fixture.company.name : fixture.ticket.subject
  let primary
  let label
  if (id === "service-desk") {
    if (stage === "before") {
      primary = page.locator("main table tbody tr:visible").filter({ hasText: title })
    } else {
      const text = fixture.ticket.number + " · " + title
      primary = page.locator("main [data-tour-id='tickets-list'] > div").filter({ has: page.getByText(text, { exact: true }) })
      label = primary.getByText(text, { exact: true })
    }
  } else if (id === "agent-desktop") {
    primary = stage === "before"
      ? page.locator("main table").first().locator("tbody tr:visible").filter({ hasText: title })
      : page.getByTestId("agent-desktop-next-case").filter({ hasText: title })
  } else if (id === "support-entitlements") {
    primary = stage === "before"
      ? page.locator("main [id='support-term-" + fixture.entitlement.id + "']")
      : page.locator("main [data-testid='support-entitlement-row'][data-entitlement-id='" + fixture.entitlement.id + "']:visible")
  } else if (id === "agent-calendar") {
    primary = stage === "before"
      ? page.locator("main [class~='min-w-[800px]'] div.cursor-pointer").filter({ has: page.getByText(title, { exact: true }) })
      : page.getByTestId("support-calendar-next-item").filter({ hasText: title })
    if (stage === "after") label = primary.locator("span.block.truncate").filter({ hasText: title })
  } else {
    throw new Error("ROUTE_INVALID")
  }
  return { primary, label: label ?? primary.getByText(title, { exact: true }).first() }
}

export async function authenticateHistorical(context, baseUrl, fixture, password) {
  if (typeof password !== "string" || password.length < 32) throw new Error("EPHEMERAL_PASSWORD_REQUIRED")
  const csrfResponse = await context.request.get(baseUrl + "/api/auth/csrf")
  if (!csrfResponse.ok()) throw new Error("AUTH_CSRF_UNAVAILABLE")
  const csrf = await csrfResponse.json()
  const login = await context.request.post(baseUrl + "/api/auth/callback/credentials", { form: {
    csrfToken: csrf.csrfToken, email: fixture.admin.email, password,
    organizationSlug: fixture.organization.slug, callbackUrl: baseUrl + "/tickets", json: "true",
  } })
  if (!login.ok()) throw new Error("AUTH_LOGIN_REJECTED")
  const response = await context.request.get(baseUrl + "/api/auth/session")
  const session = response.ok() ? await response.json() : null
  if (session?.user?.id !== fixture.admin.id || session?.user?.organizationId !== fixture.organization.id || session?.user?.role !== "admin") throw new Error("AUTH_SESSION_MISMATCH")
}

async function measureGeometry(page, primary, label) {
  if (await primary.count() !== 1 || await label.count() !== 1) throw new Error("PRIMARY_ITEM_AMBIGUOUS")
  // Do not use scrollIntoView: a work item below the fold is valid before
  // evidence, and moving it upward would fabricate the distance reduction.
  await page.evaluate(async () => {
    await document.fonts.ready
    const reset = () => {
      document.querySelector("main")?.scrollTo({ top: 0, left: 0, behavior: "instant" })
      document.scrollingElement?.scrollTo({ top: 0, left: 0, behavior: "instant" })
    }
    reset()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    reset()
  })
  await page.waitForTimeout(500)
  const work = await primary.boundingBox()
  const text = await label.boundingBox()
  if (!work || !text || work.width <= 0 || work.height <= 0 || text.width <= 0 || text.height <= 0) throw new Error("PRIMARY_ITEM_MISSING")
  const environment = await page.evaluate(() => {
    const main = document.querySelector("main")
    if (!main) return null
    const visible = (element) => {
      const rectangle = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rectangle.width > 0 && rectangle.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }
    const borderedRoundedBlocks = [...main.querySelectorAll("*")].filter((element) => {
      const style = getComputedStyle(element)
      return visible(element) && Math.max(...[style.borderTopWidth, style.borderBottomWidth, style.borderLeftWidth, style.borderRightWidth].map(parseFloat)) > 0 && Math.max(...[style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius].map(parseFloat)) > 0
    }).length
    return {
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      maxTouchPoints: navigator.maxTouchPoints, serviceWorkerAvailable: "serviceWorker" in navigator,
      documentLang: document.documentElement.lang,
      darkTheme: document.documentElement.classList.contains("dark") || matchMedia("(prefers-color-scheme: dark)").matches,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      scrollTop: main.scrollTop, documentScrollTop: document.scrollingElement?.scrollTop ?? 0,
      borderedRoundedBlocks, majorChildren: [...main.children].filter(visible).length,
    }
  })
  if (!environment) throw new Error("PRIMARY_ITEM_MISSING")
  return { ...environment, primaryWorkTop: work.y, primaryLabelTop: text.y }
}

export async function captureHistoricalLayout(env = process.env) {
  const { stage, sourceSha, controlSha } = assertHistoricalCaptureEnvironment(env)
  assertHistoricalDatabaseEnvironment(env)
  const fixture = JSON.parse(await readFile(".support-ux-historical-control/fixture.json", "utf8"))
  const fixtureDigest = historicalFixtureDigest(fixture)
  if (fixture.anchor !== env.SUPPORT_HISTORICAL_ANCHOR) throw new Error("FIXTURE_CLOCK_INVALID")
  const actualSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  if (actualSha !== sourceSha) throw new Error("SOURCE_IDENTITY_INVALID")
  const proofPath = path.join(env.RUNNER_TEMP, "support-historical-clock-" + stage + ".json")
  if (env.SUPPORT_HISTORICAL_CLOCK_PROOF !== proofPath) throw new Error("CAPTURE_ENVIRONMENT_INVALID")
  const proofText = await readFile(proofPath, "utf8")
  if (proofText.length > 1024) throw new Error("CAPTURE_ENVIRONMENT_INVALID")
  const rawClockProof = JSON.parse(proofText)
  if (Object.keys(rawClockProof).sort().join(",") !== "anchor,clockPolicy,dateNow,nativeStartedAt,schemaVersion") throw new Error("CAPTURE_ENVIRONMENT_INVALID")
  const { schemaVersion, clockPolicy, anchor, dateNow } = rawClockProof
  const serverClockProof = { schemaVersion, clockPolicy, anchor, dateNow }
  const output = path.join("artifacts", "support-ux-historical-layout", stage)
  await mkdir(output, { recursive: true })
  const report = {
    schemaVersion: 1, comparisonKind: "exact-source-runtime", stage, sourceSha, controlSha,
    mainSha: env.SUPPORT_HISTORICAL_MAIN_SHA, mainSnapshotSha: env.SUPPORT_HISTORICAL_MAIN_SNAPSHOT_SHA,
    anchor: fixture.anchor, fixtureDigest,
    controls: HISTORICAL_LAYOUT_CONTROLS, serverClockProof, status: "incomplete", results: [],
  }
  const { chromium } = await import("playwright")
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    baseURL: env.SUPPORT_HISTORICAL_BASE_URL,
    viewport: { width: 1366, height: 768 }, hasTouch: false, locale: "en-US", timezoneId: "UTC",
    colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block",
  })
  try {
    await authenticateHistorical(context, env.SUPPORT_HISTORICAL_BASE_URL, fixture, env.SUPPORT_HISTORICAL_ADMIN_PASSWORD)
    await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: env.SUPPORT_HISTORICAL_BASE_URL }])
    await context.addInitScript(initializeHistoricalBrowserState, { adminId: fixture.admin.id })
    for (const route of HISTORICAL_LAYOUT_ROUTES) {
      const failures = { external: 0, write: 0, page: 0, console: 0, response: 0 }
      const backgroundWrites = { cspReport: 0, navigationPreferences: 0 }
      const backgroundWriteSamples = []
      const backgroundResponseSamples = []
      const backgroundCompletions = []
      let sampleBackgroundWrites
      let sampleBackgroundResponses
      const diagnostics = {}
      const page = await context.newPage()
      try {
        await page.clock.install({ time: new Date(fixture.anchor) })
        await page.route("**/*", async (requestRoute) => {
          const request = requestRoute.request()
          const disposition = historicalRequestDisposition(request.url(), request.method(), env.SUPPORT_HISTORICAL_BASE_URL, request.postData(), fixture)
          if (Object.hasOwn(backgroundWrites, disposition)) {
            backgroundWrites[disposition] += 1
            if (sampleBackgroundWrites) sampleBackgroundWrites[disposition] += 1
            if (sampleBackgroundWrites?.[disposition] === 1 && backgroundWrites[disposition] <= HISTORICAL_LAYOUT_CONTROLS.sampleCount) {
              const responseSample = sampleBackgroundResponses
              backgroundCompletions.push(completeHistoricalBackgroundRequest(request, disposition).then((complete) => {
                if (complete) responseSample[disposition] += 1
                return complete
              }))
              await requestRoute.continue(); return
            }
          }
          if (disposition !== "read") {
            failures[disposition === "external" ? "external" : "write"] += 1
            incrementDiagnostic(diagnostics, historicalNetworkDiagnostic(request.url(), request.method(), 0, env.SUPPORT_HISTORICAL_BASE_URL))
            await requestRoute.abort(); return
          }
          await requestRoute.continue()
        })
        page.on("pageerror", (error) => {
          failures.page += 1
          incrementDiagnostic(diagnostics, "PAGE_" + (new Set(["Error", "TypeError", "DOMException", "ReferenceError", "SyntaxError"]).has(error.name) ? error.name : "OTHER_ERROR"))
        })
        page.on("console", (message) => {
          if (message.type() === "error") {
            failures.console += 1
            incrementDiagnostic(diagnostics, historicalConsoleDiagnostic(message.text()))
          }
        })
        page.on("response", (response) => {
          if (new URL(response.url()).origin === env.SUPPORT_HISTORICAL_BASE_URL && response.status() >= 400) {
            failures.response += 1
            incrementDiagnostic(diagnostics, historicalNetworkDiagnostic(response.url(), response.request().method(), response.status(), env.SUPPORT_HISTORICAL_BASE_URL))
          }
        })
        const samples = []
        for (let sample = 0; sample < HISTORICAL_LAYOUT_CONTROLS.sampleCount; sample += 1) {
          sampleBackgroundWrites = { cspReport: 0, navigationPreferences: 0 }
          sampleBackgroundResponses = { cspReport: 0, navigationPreferences: 0 }
          backgroundWriteSamples.push(sampleBackgroundWrites)
          backgroundResponseSamples.push(sampleBackgroundResponses)
          const dataPromise = page.waitForResponse((response) => new URL(response.url()).pathname === historicalDataPath(route.id, stage) && response.request().method() === "GET", { timeout: 30000 }).catch(() => null)
          const navigation = await page.goto(route.path, { waitUntil: "domcontentloaded", timeout: 60000 })
          if (!navigation?.ok()) throw new Error("PAGE_UNAVAILABLE")
          const data = await dataPromise
          if (!data?.ok()) throw new Error("DATA_UNAVAILABLE")
          assertHistoricalSemanticData(route.id, stage, await data.json(), fixture)
          const { primary, label } = historicalPrimaryLocator(page, route.id, stage, fixture)
          await primary.waitFor({ state: "attached", timeout: 30000 })
          await page.getByTestId("global-header").waitFor({ state: "visible", timeout: 30000 })
          await page.waitForFunction((name) => document.body.innerText.includes(name), fixture.organization.name, { timeout: 30000 })
          const tour = page.getByTestId("tour-overlay")
          if (await tour.isVisible()) throw new Error("CAPTURE_ENVIRONMENT_INVALID")
          await page.waitForTimeout(HISTORICAL_LAYOUT_CONTROLS.postReadyObservationMs)
          const geometry = await measureGeometry(page, primary, label)
          const serviceWorkerCount = context.serviceWorkers().length
          if (geometry.serviceWorkerAvailable !== false || serviceWorkerCount !== 0) throw new Error("CAPTURE_ENVIRONMENT_INVALID")
          samples.push({ ...geometry, serviceWorkerCount })
          if (!await waitHistoricalBackgroundRequests(backgroundCompletions)) throw new Error("BACKGROUND_REQUEST_INCOMPLETE")
        }
        if (Object.values(failures).some((value) => value > 0)) throw new Error("RUNTIME_FAILURE")
        const last = samples.at(-1)
        await page.screenshot({ path: path.join(output, route.id + ".png"), fullPage: false, animations: "disabled" })
        report.results.push({
          id: route.id, path: route.path, status: "captured", semanticFixture: true,
          representation: stage === "before" ? route.beforeRepresentation : route.afterRepresentation,
          failures, backgroundWrites, backgroundWriteSamples, backgroundResponseSamples, diagnostics,
          ...last, primaryWorkTop: historicalMedian(samples.map((sample) => sample.primaryWorkTop)),
          primaryWorkTopSamples: samples.map((sample) => sample.primaryWorkTop),
          primaryLabelTop: historicalMedian(samples.map((sample) => sample.primaryLabelTop)),
          primaryLabelTopSamples: samples.map((sample) => sample.primaryLabelTop),
          sourcePageBlob: execFileSync("git", ["hash-object", route.file], { encoding: "utf8" }).trim(),
          screenshot: route.id + ".png",
        })
      } catch (error) {
        report.results.push({ id: route.id, path: route.path, status: "failed", code: historicalFailureCode(error), failures, backgroundWrites, backgroundWriteSamples, backgroundResponseSamples, diagnostics })
      } finally {
        await page.close()
      }
    }
  } catch (error) {
    report.bootstrapFailureCode = historicalFailureCode(error)
  } finally {
    await context.close()
    await browser.close()
  }
  if (report.results.length === HISTORICAL_LAYOUT_ROUTES.length && report.results.every((result) => result.status === "captured" && Object.values(result.failures).every((value) => value === 0))) {
    let prisma
    try {
      assertHistoricalDatabaseEnvironment(process.env)
      if (env.DATABASE_URL !== process.env.DATABASE_URL) throw new Error("CAPTURE_ENVIRONMENT_INVALID")
      const { makeScriptPrisma } = await import("../scripts/_rls.mjs")
      prisma = await makeScriptPrisma()
      report.backgroundPersistenceProof = await verifyHistoricalBackgroundPersistence(prisma, fixture)
    } catch (error) {
      report.backgroundPersistenceFailureCode = historicalFailureCode(error)
    } finally {
      try { await prisma?.$disconnect() } catch { report.backgroundPersistenceFailureCode = "BACKGROUND_PERSISTENCE_MISMATCH" }
    }
  }
  finalizeHistoricalLayoutReport(report, stage, controlSha)
  await writeFile(path.join(output, "evidence.json"), JSON.stringify(report, null, 2) + "\n")
  await writeFile(path.join(output, "evidence.md"), [
    "# Historical Support layout capture", "", "Collection status: " + report.status,
    "Exact source: " + sourceSha, "Fixture digest: " + fixtureDigest,
    "Collection alone does not establish a 35% improvement or complete acceptance.", "",
    "| Route | Collection | Primary top | Bordered/rounded blocks | Screenshot / failure |",
    "| --- | --- | --- | --- | --- |",
    ...report.results.map((result) => "| " + [result.id, result.status, result.primaryWorkTop ?? "—", result.borderedRoundedBlocks ?? "—", result.screenshot ?? result.code].join(" | ") + " |"), "",
  ].join("\n"))
  if (report.status !== "captured") throw new Error("CAPTURE_INCOMPLETE")
  console.log("Captured four exact-runtime historical layout surfaces: " + stage)
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  captureHistoricalLayout().catch((error) => { console.error("Historical layout capture failed: " + historicalFailureCode(error)); process.exitCode = 1 })
}
