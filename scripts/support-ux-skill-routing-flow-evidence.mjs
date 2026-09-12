import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { requireScreenshotTarget } from "./screenshot-auth-config.mjs"
import { assertDemoTenant, requireDemoTenant } from "./screenshot-safety.mjs"
import { captureSupportEvidenceScreenshot } from "./support-ux-screenshot.mjs"

if (process.env.SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral") {
  throw new Error("Mutating Skill Routing evidence is restricted to the ephemeral target")
}

const { baseUrl, hostname } = requireScreenshotTarget()
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
  throw new Error("Mutating Skill Routing evidence refuses a non-local host")
}

const demoOrganization = requireDemoTenant()
const commit = (process.env.SUPPORT_EVIDENCE_COMMIT || "").trim()
if (!/^[0-9a-f]{7,40}$/i.test(commit)) throw new Error("SUPPORT_EVIDENCE_COMMIT must be an exact Git commit")

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function singleSelection(name, fallback, allowed) {
  const values = (process.env[name] || fallback).split(",").map((value) => value.trim()).filter(Boolean)
  if (values.length !== 1 || !allowed.has(values[0])) {
    throw new Error(`${name} must select exactly one supported value for mutating flow evidence`)
  }
  return values[0]
}

const locale = singleSelection("SUPPORT_EVIDENCE_LOCALES", "az", new Set(["az", "ru", "en"]))
const theme = singleSelection("SUPPORT_EVIDENCE_THEMES", "light", new Set(["light", "dark"]))
const viewportName = singleSelection("SUPPORT_EVIDENCE_VIEWPORTS", "desktop", new Set(["desktop", "tablet", "narrow-tablet", "mobile"]))
const viewports = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 1024, height: 900 },
  "narrow-tablet": { width: 768, height: 900 },
  mobile: { width: 375, height: 812 },
}
const usesFocusedTabs = viewports[viewportName].width < 1024
const outputDirectory = process.env.SUPPORT_EVIDENCE_OUTPUT_DIR
  || path.join("artifacts", "support-ux", new Date().toISOString().slice(0, 10))
const admin = {
  email: requiredEnv("SUPPORT_EVIDENCE_ADMIN_EMAIL"),
  password: requiredEnv("SUPPORT_EVIDENCE_ADMIN_PASSWORD"),
}

async function authenticate(context) {
  const csrfResponse = await context.request.get("/api/auth/csrf")
  const csrf = await csrfResponse.json()
  const response = await context.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email: admin.email,
      password: admin.password,
      callbackUrl: baseUrl + "/support/skill-routing",
      json: "true",
    },
  })
  if (!response.ok()) throw new Error("skill_routing_authentication_failed")
}

async function dismissTour(page) {
  const overlay = page.getByTestId("tour-overlay")
  if (await overlay.waitFor({ state: "visible", timeout: 1_000 }).then(() => true).catch(() => false)) {
    await page.keyboard.press("Escape")
  }
}

async function openWorkspace(page) {
  const response = await page.goto("/support/skill-routing", { waitUntil: "domcontentloaded", timeout: 60_000 })
  if (!response || response.status() >= 400) throw new Error(`page_http_${response?.status() || 0}`)
  await page.locator("[data-testid='skill-routing-workspace'][data-state='ready']").waitFor({ state: "visible", timeout: 30_000 })
  await dismissTour(page)
  assertDemoTenant(await page.locator("body").innerText(), demoOrganization, "Skill Routing")
}

function jsonFailure(message, status = 503) {
  return { status, contentType: "application/json", body: JSON.stringify({ success: false, error: message }) }
}

await mkdir(outputDirectory, { recursive: true })
const report = {
  generatedAt: new Date().toISOString(),
  commit,
  targetHost: hostname,
  demoOrganization,
  role: "admin",
  locale,
  theme,
  viewport: viewportName,
  results: [],
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  baseURL: baseUrl,
  viewport: viewports[viewportName],
  locale,
  colorScheme: theme,
  reducedMotion: "reduce",
  hasTouch: viewportName !== "desktop",
})
await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: hostname, path: "/" }])
await context.addInitScript((activeTheme) => localStorage.setItem("theme", activeTheme), theme)

async function recordStep(page, id, action) {
  console.log(`[skill-routing-flow] ${id}`)
  try {
    const detail = await action()
    const screenshot = `skill-routing-flow-${id}-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" })
    report.results.push({ id, status: "passed", screenshot, ...detail })
  } catch (error) {
    const screenshot = `skill-routing-flow-${id}-failed-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" }).catch(() => undefined)
    report.results.push({ id, status: "failed", screenshot, reason: error instanceof Error ? error.message : String(error) })
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined)
  }
}

const page = await context.newPage()
try {
  await authenticate(context)

  await recordStep(page, "dual-load-failure-permission-and-keyboard-recovery", async () => {
    const queuesPattern = "**/api/v1/ticket-queues"
    const agentsPattern = "**/api/v1/skill-routing/agents"
    const denyQueues = async (route) => route.fulfill(jsonFailure("Synthetic queue load failure"))
    const denyAgents = async (route) => route.fulfill(jsonFailure("Synthetic agent load failure"))
    await page.route(queuesPattern, denyQueues)
    await page.route(agentsPattern, denyAgents)
    await page.goto("/support/skill-routing", { waitUntil: "domcontentloaded" })
    await page.getByTestId("routing-queues-error").waitFor({ state: "visible" })
    await page.getByTestId("routing-agents-error").waitFor({ state: "attached" })
    await page.unroute(queuesPattern, denyQueues)
    await page.unroute(agentsPattern, denyAgents)
    await page.getByTestId("routing-queues-retry").focus()
    await page.getByTestId("routing-queues-retry").press("Enter")
    if (usesFocusedTabs) await page.getByTestId("skill-routing-tab-agents").click()
    await page.getByTestId("routing-agents-retry").focus()
    await page.getByTestId("routing-agents-retry").press("Enter")
    await page.locator("[data-testid='skill-routing-workspace'][data-state='ready']").waitFor({ state: "visible" })

    const forbidQueues = async (route) => route.fulfill(jsonFailure("Synthetic queue permission denial", 403))
    const forbidAgents = async (route) => route.fulfill(jsonFailure("Synthetic agent permission denial", 403))
    await page.route(queuesPattern, forbidQueues)
    await page.route(agentsPattern, forbidAgents)
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.locator("[data-testid='skill-routing-workspace'][data-state='error']").waitFor({ state: "visible" })
    if (await page.getByTestId("routing-queues-retry").count() !== 0 || await page.getByTestId("routing-agents-retry").count() !== 0) {
      throw new Error("routing_permission_offered_misleading_retry")
    }
    await page.unroute(queuesPattern, forbidQueues)
    await page.unroute(agentsPattern, forbidAgents)
    await openWorkspace(page)
    return { totalFailureObserved: true, keyboardRetry: true, permissionStateObserved: true, misleadingRetryAbsent: true }
  })

  await recordStep(page, "partial-source-failure-and-recovery", async () => {
    const queuesPattern = "**/api/v1/ticket-queues"
    const denyQueues = async (route) => route.fulfill(jsonFailure("Synthetic partial queue failure"))
    await page.route(queuesPattern, denyQueues)
    await page.goto("/support/skill-routing", { waitUntil: "domcontentloaded" })
    await page.locator("[data-testid='skill-routing-workspace'][data-state='partial']").waitFor({ state: "visible" })
    await page.getByTestId("skill-routing-partial").waitFor({ state: "visible" })
    await page.locator("[data-testid='routing-agents-manager'][data-state='ready']").waitFor({ state: "attached" })
    await page.unroute(queuesPattern, denyQueues)
    await page.getByTestId("routing-queues-retry").focus()
    await page.getByTestId("routing-queues-retry").press("Enter")
    await page.locator("[data-testid='skill-routing-workspace'][data-state='ready']").waitFor({ state: "visible" })
    return { partialStateObserved: true, unaffectedSourcePreserved: true, keyboardRetry: true }
  })

  await recordStep(page, "empty-filtered-and-operational-density", async () => {
    const queuesPattern = "**/api/v1/ticket-queues"
    const agentsPattern = "**/api/v1/skill-routing/agents"
    const emptyQueues = async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: [], permissions: { canWrite: true } }) })
    const emptyAgents = async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: [], permissions: { canWrite: true } }) })
    await page.route(queuesPattern, emptyQueues)
    await page.route(agentsPattern, emptyAgents)
    await page.goto("/support/skill-routing", { waitUntil: "domcontentloaded" })
    await page.getByTestId("routing-queues-empty").waitFor({ state: "visible" })
    await page.getByTestId("routing-agents-empty").waitFor({ state: "attached" })
    await page.unroute(queuesPattern, emptyQueues)
    await page.unroute(agentsPattern, emptyAgents)
    await openWorkspace(page)
    await page.getByTestId("routing-queue-search").fill("no-such-routing-queue")
    await page.getByTestId("routing-queues-no-results").waitFor({ state: "visible" })
    await page.getByTestId("routing-queues-reset").click()
    if (usesFocusedTabs) await page.getByTestId("skill-routing-tab-agents").click()
    await page.getByTestId("routing-agent-search").fill("no-such-routing-agent")
    await page.getByTestId("routing-agents-no-results").waitFor({ state: "visible" })
    await page.getByTestId("routing-agents-reset").click()

    const densityQueues = async (route) => {
      const response = await route.fetch()
      const payload = await response.json()
      const source = payload.data[0]
      const data = Array.from({ length: 50 }, (_, index) => ({ ...source, id: `density-queue-${index}`, name: `Density queue ${index + 1}`, skills: index % 5 === 0 ? [`unmatched-${index}`] : source.skills }))
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...payload, data }) })
    }
    const densityAgents = async (route) => {
      const response = await route.fetch()
      const payload = await response.json()
      const source = payload.data[0]
      const data = Array.from({ length: 100 }, (_, index) => ({ ...source, id: `density-agent-${index}`, name: `Density agent ${index + 1}` }))
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...payload, data }) })
    }
    await page.route(queuesPattern, densityQueues)
    await page.route(agentsPattern, densityAgents)
    await page.goto("/support/skill-routing", { waitUntil: "domcontentloaded" })
    await page.locator("[data-testid='skill-routing-workspace'][data-state='ready']").waitFor({ state: "visible" })
    if (await page.getByTestId("routing-queue-row").count() !== 50) throw new Error("routing_queue_density_rendered_incorrectly")
    if (await page.getByTestId("routing-agent-row").count() !== 100) throw new Error("routing_agent_density_rendered_incorrectly")
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    if (overflow) throw new Error("routing_density_horizontal_overflow")
    return { emptySourcesObserved: true, filteredRecovery: true, queues: 50, agents: 100, horizontalOverflow: false }
  })

  await recordStep(page, "queue-master-detail-toggle-rollback-and-create-delete", async () => {
    await openWorkspace(page)
    const row = page.getByTestId("routing-queue-row").first()
    const queueId = await row.getAttribute("data-queue-id")
    if (!queueId) throw new Error("routing_queue_fixture_missing")
    const select = page.getByTestId(`routing-queue-select-${queueId}`)
    await select.focus()
    await select.press("Enter")
    await page.locator(`[data-testid='routing-agents-manager'][data-selected-queue-id='${queueId}']`).waitFor({ state: "attached" })
    if (usesFocusedTabs) {
      if (await page.getByTestId("skill-routing-tab-agents").getAttribute("aria-selected") !== "true") throw new Error("routing_mobile_master_detail_did_not_focus_agents")
      await page.getByTestId("skill-routing-tab-queues").click()
    }

    const toggle = page.getByTestId(`routing-queue-toggle-${queueId}`)
    const before = await toggle.getAttribute("aria-checked")
    const itemPattern = `**/api/v1/ticket-queues/${queueId}`
    const denyPatch = async (route) => route.request().method() === "PATCH" ? route.fulfill(jsonFailure("Synthetic queue toggle failure")) : route.continue()
    await page.route(itemPattern, denyPatch)
    await toggle.click()
    await page.locator("[data-testid='routing-queue-status'][data-kind='error']").waitFor({ state: "visible" })
    if (await toggle.getAttribute("aria-checked") !== before) throw new Error("routing_queue_toggle_failed_to_rollback")
    await page.unroute(itemPattern, denyPatch)

    const name = "Disposable routing evidence queue"
    await page.getByTestId("routing-queue-create").click()
    await page.locator("#routing-queue-name").fill(name)
    const collectionPattern = "**/api/v1/ticket-queues"
    const denyPost = async (route) => route.request().method() === "POST" ? route.fulfill(jsonFailure("Synthetic queue save failure")) : route.continue()
    await page.route(collectionPattern, denyPost)
    await page.getByTestId("routing-queue-form-submit").click()
    await page.getByTestId("routing-queue-form-error").waitFor({ state: "visible" })
    if (await page.locator("#routing-queue-name").inputValue() !== name) throw new Error("routing_queue_save_failure_discarded_values")
    await page.unroute(collectionPattern, denyPost)
    await page.getByTestId("routing-queue-form-submit").click()
    await page.getByTestId("routing-queue-form").waitFor({ state: "hidden" })
    const created = page.getByTestId("routing-queue-row").filter({ hasText: name }).first()
    await created.waitFor({ state: "visible" })
    const createdId = await created.getAttribute("data-queue-id")
    if (!createdId) throw new Error("routing_created_queue_id_missing")

    const deletePattern = `**/api/v1/ticket-queues/${createdId}`
    const denyDelete = async (route) => route.request().method() === "DELETE" ? route.fulfill(jsonFailure("Synthetic queue delete failure")) : route.continue()
    await page.route(deletePattern, denyDelete)
    await page.getByTestId(`routing-queue-delete-${createdId}`).click()
    const confirmation = page.getByRole("dialog").last()
    await confirmation.locator("button").last().click()
    await confirmation.getByRole("alert").waitFor({ state: "visible" })
    if (await created.count() === 0) throw new Error("routing_queue_delete_failure_removed_row")
    await page.unroute(deletePattern, denyDelete)
    await confirmation.locator("button").last().click()
    await confirmation.waitFor({ state: "hidden" })
    await created.waitFor({ state: "hidden" })
    return { keyboardMasterDetail: true, focusedTabFlow: usesFocusedTabs ? true : "not_applicable", toggleRollback: true, formValuesPreserved: true, disposableQueueRemoved: true }
  })

  await recordStep(page, "bulk-skill-rollback-retry-and-fixture-restore", async () => {
    await openWorkspace(page)
    if (usesFocusedTabs) await page.getByTestId("skill-routing-tab-agents").click()
    const rows = page.getByTestId("routing-agent-row")
    if (await rows.count() < 2) throw new Error("routing_bulk_fixture_requires_two_agents")
    const ids = [await rows.nth(0).getAttribute("data-agent-id"), await rows.nth(1).getAttribute("data-agent-id")]
    if (ids.some((id) => !id)) throw new Error("routing_bulk_agent_ids_missing")
    for (const id of ids) await page.getByTestId(`routing-agent-select-${id}`).click()
    const bulk = page.getByTestId("routing-agent-bulk-editor")
    await bulk.locator("[data-testid='skill-picker-option'][data-skill='administration']").click()
    const agentsPattern = "**/api/v1/skill-routing/agents"
    const denyPatch = async (route) => route.request().method() === "PATCH" ? route.fulfill(jsonFailure("Synthetic bulk skill failure")) : route.continue()
    await page.route(agentsPattern, denyPatch)
    await page.getByTestId("routing-agent-bulk-add").click()
    await page.locator("[data-testid='routing-agent-status'][data-kind='error']").waitFor({ state: "visible" })
    for (let index = 0; index < 2; index += 1) {
      if ((await rows.nth(index).innerText()).includes("administration")) throw new Error("routing_bulk_failure_did_not_rollback")
    }
    await page.unroute(agentsPattern, denyPatch)
    await page.getByTestId("routing-agent-bulk-add").click()
    await bulk.waitFor({ state: "hidden" })
    await page.locator("[data-testid='routing-agent-status'][data-kind='success']").waitFor({ state: "visible" })
    for (const id of ids) await page.getByTestId(`routing-agent-select-${id}`).click()
    await page.getByTestId("routing-agent-bulk-editor").locator("[data-testid='skill-picker-option'][data-skill='administration']").click()
    await page.getByTestId("routing-agent-bulk-remove").click()
    await page.getByTestId("routing-agent-bulk-editor").waitFor({ state: "hidden" })
    await page.locator("[data-testid='routing-agent-status'][data-kind='success']").waitFor({ state: "visible" })
    for (let index = 0; index < 2; index += 1) {
      if ((await rows.nth(index).innerText()).includes("administration")) throw new Error("routing_bulk_fixture_restore_failed")
    }
    return { optimisticRollback: true, selectionPreservedAfterFailure: true, retrySucceeded: true, unrelatedSkillsPreservedByContract: true, fixtureRestored: true }
  })

  await recordStep(page, "read-only-permission-suppresses-mutations", async () => {
    const queuesPattern = "**/api/v1/ticket-queues"
    const agentsPattern = "**/api/v1/skill-routing/agents"
    const readOnly = async (route) => {
      const response = await route.fetch()
      const payload = await response.json()
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...payload, permissions: { canWrite: false } }) })
    }
    await page.route(queuesPattern, readOnly)
    await page.route(agentsPattern, readOnly)
    await page.goto("/support/skill-routing", { waitUntil: "domcontentloaded" })
    await page.getByTestId("skill-routing-read-only").waitFor({ state: "visible" })
    if (await page.getByTestId("routing-queue-create").count() !== 0) throw new Error("routing_read_only_queue_create_visible")
    if (await page.getByTestId("routing-agents-select-visible").count() !== 0) throw new Error("routing_read_only_agent_selection_visible")
    return { readOnlyObserved: true, queueMutationsAbsent: true, agentMutationsAbsent: true }
  })
} finally {
  await context.close()
  await browser.close()
}

await writeFile(path.join(outputDirectory, "skill-routing-flow-evidence.json"), JSON.stringify(report, null, 2) + "\n")
const failures = report.results.filter((result) => result.status !== "passed")
if (report.results.length !== 6 || failures.length > 0) {
  console.error(JSON.stringify({ expected: 6, actual: report.results.length, failures }, null, 2))
  process.exitCode = 1
}
