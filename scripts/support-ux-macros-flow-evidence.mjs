import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { requireScreenshotTarget } from "./screenshot-auth-config.mjs"
import { assertDemoTenant, requireDemoTenant } from "./screenshot-safety.mjs"
import { captureSupportEvidenceScreenshot } from "./support-ux-screenshot.mjs"

if (process.env.SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral") {
  throw new Error("Macros flow evidence is restricted to the ephemeral target")
}

const { baseUrl, hostname } = requireScreenshotTarget()
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
  throw new Error("Macros flow evidence refuses a non-local host")
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
    throw new Error(`${name} must select exactly one supported value for flow evidence`)
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
const outputDirectory = process.env.SUPPORT_EVIDENCE_OUTPUT_DIR
  || path.join("artifacts", "support-ux", new Date().toISOString().slice(0, 10))
const admin = {
  email: requiredEnv("SUPPORT_EVIDENCE_ADMIN_EMAIL"),
  password: requiredEnv("SUPPORT_EVIDENCE_ADMIN_PASSWORD"),
}
const agents = [
  { id: "macro-agent-1", name: "Evidence Agent", role: "agent", isActive: true, isAvailable: true },
  { id: "macro-agent-2", name: "Evidence Manager", role: "manager", isActive: true, isAvailable: false },
]

function macro(index, overrides = {}) {
  return {
    id: `macro-evidence-${index}`,
    name: `Macro evidence ${index + 1}`,
    description: `Compact macro description ${index + 1}`,
    category: index % 3 === 0 ? "Evidence shared" : index % 2 === 0 ? "technical" : "general",
    actions: index === 0
      ? [{ type: "set_status", value: "in_progress" }, { type: "set_assignee", value: agents[0].id }]
      : [{ type: "add_tag", value: `evidence-${index + 1}` }],
    shortcutKey: index < 9 ? `Alt+${index + 1}` : null,
    usageCount: index * 3,
    isActive: index % 4 !== 3,
    sortOrder: index,
    ...overrides,
  }
}

function json(body, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) }
}

async function authenticate(context) {
  const csrfResponse = await context.request.get("/api/auth/csrf")
  const csrf = await csrfResponse.json()
  const response = await context.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email: admin.email,
      password: admin.password,
      callbackUrl: baseUrl + "/settings/macros",
      json: "true",
    },
  })
  if (!response.ok()) throw new Error("macros_authentication_failed")
}

async function dismissTour(page) {
  const overlay = page.getByTestId("tour-overlay")
  if (await overlay.waitFor({ state: "visible", timeout: 1_000 }).then(() => true).catch(() => false)) {
    await page.keyboard.press("Escape")
  }
}

async function openWorkspace(page) {
  const response = await page.goto("/settings/macros", { waitUntil: "domcontentloaded", timeout: 60_000 })
  if (!response || response.status() >= 400) throw new Error(`page_http_${response?.status() || 0}`)
  await page.locator("[data-testid='macros-workspace'][data-state='ready']").waitFor({ state: "visible", timeout: 30_000 })
  await dismissTour(page)
  assertDemoTenant(await page.locator("body").innerText(), demoOrganization, "Macros")
}

function installMacroApi(page, initialMacros, options = {}) {
  let macros = structuredClone(initialMacros)
  let categories = ["general", "billing", "technical", "onboarding", "sales", "Evidence shared"]
  let putAttempts = 0
  let deleteAttempts = 0
  let categoryPostAttempts = 0
  const pattern = "**/api/v1/ticket-macros**"
  const handler = async (route) => {
    const request = route.request()
    const method = request.method()
    const url = new URL(request.url())
    const isCategories = url.pathname.endsWith("/categories")
    const id = decodeURIComponent(url.pathname.split("/").pop() || "")

    if (method === "GET" && !isCategories) {
      return route.fulfill(json({ success: true, data: macros, categories, agents, permissions: { canWrite: options.canWrite !== false } }))
    }
    if (isCategories && method === "POST") {
      categoryPostAttempts += 1
      if (options.failFirstCategoryPost && categoryPostAttempts === 1) {
        return route.fulfill(json({ success: false, error: "Synthetic category save failure" }, 503))
      }
      const body = request.postDataJSON()
      categories = [...categories, body.name.trim()]
      return route.fulfill(json({ success: true, data: { categories } }, 201))
    }
    if (method === "POST") {
      const body = request.postDataJSON()
      const created = { ...body, id: `macro-created-${macros.length}`, usageCount: 0, isActive: true, sortOrder: macros.length }
      macros = [...macros, created]
      return route.fulfill(json({ success: true, data: created }, 201))
    }
    if (method === "PUT") {
      putAttempts += 1
      if (options.failFirstPut && putAttempts === 1) return route.fulfill(json({ success: false, error: "Synthetic macro save failure" }, 503))
      const body = request.postDataJSON()
      macros = macros.map((item) => item.id === id ? { ...item, ...body } : item)
      return route.fulfill(json({ success: true, data: macros.find((item) => item.id === id) }))
    }
    if (method === "DELETE" && !isCategories) {
      deleteAttempts += 1
      if (options.failFirstDelete && deleteAttempts === 1) return route.fulfill(json({ success: false, error: "Synthetic macro delete failure" }, 503))
      macros = macros.filter((item) => item.id !== id)
      return route.fulfill(json({ success: true, data: { deleted: id } }))
    }
    return route.fulfill(json({ success: false, error: "Unexpected synthetic macro request" }, 405))
  }
  return page.route(pattern, handler)
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
  console.log(`[macros-flow] ${id}`)
  try {
    const detail = await action()
    const screenshot = `macros-flow-${id}-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" })
    report.results.push({ id, status: "passed", screenshot, ...detail })
  } catch (error) {
    const screenshot = `macros-flow-${id}-failed-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" }).catch(() => undefined)
    report.results.push({ id, status: "failed", screenshot, reason: error instanceof Error ? error.message : String(error) })
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined)
  }
}

const page = await context.newPage()
await page.addInitScript(() => {
  const nativeSetTimeout = window.setTimeout.bind(window)
  window.setTimeout = ((callback, delay, ...args) => nativeSetTimeout(callback, delay === 7_000 ? 1_000 : delay, ...args))
})

try {
  await authenticate(context)

  await recordStep(page, "load-failure-permission-and-keyboard-recovery", async () => {
    const pattern = "**/api/v1/ticket-macros**"
    const fail = async (route) => route.fulfill(json({ success: false, error: "Synthetic macro load failure" }, 503))
    await page.route(pattern, fail)
    await page.goto("/settings/macros", { waitUntil: "domcontentloaded" })
    await page.getByTestId("macros-error").waitFor({ state: "visible" })
    await page.unroute(pattern, fail)
    await installMacroApi(page, [macro(0)])
    await page.getByTestId("macros-retry").focus()
    await page.getByTestId("macros-retry").press("Enter")
    await page.locator("[data-testid='macros-workspace'][data-state='ready']").waitFor({ state: "visible" })
    await page.unrouteAll({ behavior: "wait" })

    const forbid = async (route) => route.fulfill(json({ success: false, error: "Synthetic macro permission denial", code: "MACRO_WRITE_FORBIDDEN" }, 403))
    await page.route(pattern, forbid)
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.locator("[data-testid='macros-error'][data-retryable='false']").waitFor({ state: "visible" })
    if (await page.getByTestId("macros-retry").count() !== 0) throw new Error("macros_permission_offered_misleading_retry")
    return { transientErrorObserved: true, keyboardRetry: true, permissionStateObserved: true, misleadingRetryAbsent: true }
  })

  await recordStep(page, "read-only-library-suppresses-mutations", async () => {
    await installMacroApi(page, [macro(0)], { canWrite: false })
    await openWorkspace(page)
    await page.getByTestId("macros-read-only").waitFor({ state: "visible" })
    if (!await page.getByTestId("macro-toggle").isDisabled()) throw new Error("macros_read_only_toggle_enabled")
    for (const selector of ["macro-create", "macro-menu", "macro-categories-manage"]) {
      if (await page.getByTestId(selector).count() !== 0) throw new Error(`macros_read_only_exposed_${selector}`)
    }
    return { readOnlyStateObserved: true, toggleDisabled: true, mutationMenusSuppressed: true }
  })

  await recordStep(page, "empty-filter-and-forty-macro-density", async () => {
    await installMacroApi(page, [])
    await openWorkspace(page)
    await page.getByTestId("macros-empty").waitFor({ state: "visible" })
    await page.unrouteAll({ behavior: "wait" })
    await installMacroApi(page, Array.from({ length: 40 }, (_, index) => macro(index)))
    await openWorkspace(page)
    if (await page.getByTestId("macro-row").count() !== 40) throw new Error("macros_density_row_count_mismatch")
    await page.getByTestId("macros-search").fill("no matching macro evidence")
    await page.getByTestId("macros-filter-empty").waitFor({ state: "visible" })
    await page.getByTestId("macros-reset-filters").click()
    if (await page.getByTestId("macro-row").count() !== 40) throw new Error("macros_filter_reset_failed")
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    if (overflow) throw new Error("macros_density_horizontal_overflow")
    return { emptyObserved: true, macros: 40, filteredEmptyObserved: true, resetRecovered: true, horizontalOverflow: false }
  })

  await recordStep(page, "editor-timeline-assignee-preview-and-draft-recovery", async () => {
    const original = macro(0)
    await installMacroApi(page, [original], { failFirstPut: true })
    await openWorkspace(page)
    const open = page.locator(`[data-macro-id='${original.id}']`).getByTestId("macro-row-open")
    await open.focus()
    await open.press("Enter")
    await page.getByTestId("macro-editor").waitFor({ state: "visible" })
    if (await page.getByTestId("macro-action-row").count() !== 2) throw new Error("macro_timeline_action_count_mismatch")
    if (!await page.getByTestId("macro-editor").getByText("Evidence Agent", { exact: false }).count()) throw new Error("macro_scoped_assignee_missing")
    await page.getByTestId("macro-action-row").nth(1).getByTestId("macro-action-up").click()
    await page.getByTestId("macro-preview-toggle").click()
    await page.getByTestId("macro-preview").waitFor({ state: "visible" })
    const name = page.getByTestId("macro-name")
    await name.fill("Recovered macro draft")
    await page.getByTestId("macro-save").click()
    await page.locator("[data-testid='macros-notice'][data-kind='error']").waitFor({ state: "visible" })
    if (await name.inputValue() !== "Recovered macro draft") throw new Error("macro_failed_save_lost_draft")
    if (await page.getByTestId("macro-action-row").count() !== 2) throw new Error("macro_failed_save_lost_actions")
    await page.getByTestId("macro-save").click()
    await page.getByTestId("macro-editor").waitFor({ state: "hidden" })
    await page.locator(`[data-macro-id='${original.id}']`).getByText("Recovered macro draft").waitFor({ state: "visible" })
    const reopened = page.locator(`[data-macro-id='${original.id}']`).getByTestId("macro-row-open")
    await reopened.focus()
    await reopened.press("Enter")
    await page.keyboard.press("Escape")
    if (!await reopened.isFocused()) throw new Error("macro_editor_focus_not_restored")
    return { keyboardOpen: true, orderedTimeline: true, scopedAssignee: true, preview: true, draftRetained: true, retrySucceeded: true, focusRestored: true }
  })

  await recordStep(page, "toggle-rollback-delete-undo-and-delete-recovery", async () => {
    const original = macro(0)
    await installMacroApi(page, [original], { failFirstPut: true, failFirstDelete: true })
    await openWorkspace(page)
    const row = page.locator(`[data-macro-id='${original.id}']`)
    const toggle = row.getByTestId("macro-toggle")
    await toggle.click()
    await page.locator("[data-testid='macros-notice'][data-kind='error']").waitFor({ state: "visible" })
    if (await toggle.getAttribute("aria-checked") !== "true") throw new Error("macro_toggle_failure_did_not_roll_back")
    await toggle.click()
    await page.locator("[data-testid='macros-notice'][data-kind='success']").waitFor({ state: "visible" })

    const queueDelete = async () => {
      await row.getByTestId("macro-menu").click()
      await page.getByTestId("macro-menu-delete").click()
      await page.getByTestId("macro-delete-confirm").click()
    }
    await queueDelete()
    await page.getByTestId("macro-delete-undo").click()
    if (await page.locator(`[data-macro-id='${original.id}']`).count() !== 1) throw new Error("macro_delete_undo_removed_row")
    await queueDelete()
    await page.locator("[data-testid='macros-notice'][data-kind='error']").waitFor({ state: "visible", timeout: 3_000 })
    if (await page.locator(`[data-macro-id='${original.id}']`).count() !== 1) throw new Error("macro_failed_delete_removed_row")
    await queueDelete()
    await page.locator(`[data-macro-id='${original.id}']`).waitFor({ state: "detached", timeout: 3_000 })
    return { toggleRollback: true, toggleRetry: true, deleteUndo: true, failedDeletePreservedRow: true, deleteRetrySucceeded: true }
  })

  await recordStep(page, "shared-category-failure-retains-input-and-retries", async () => {
    await installMacroApi(page, [macro(0)], { failFirstCategoryPost: true })
    await openWorkspace(page)
    const manage = page.getByTestId("macro-categories-manage")
    await manage.focus()
    await manage.press("Enter")
    const input = page.getByTestId("macro-category-new")
    await input.fill("Recovered shared category")
    await page.getByTestId("macro-category-add").click()
    await page.getByTestId("macro-category-manager").getByRole("status").waitFor({ state: "visible" })
    if (await input.inputValue() !== "Recovered shared category") throw new Error("macro_category_failure_lost_input")
    await page.getByTestId("macro-category-add").click()
    const category = page.locator("[data-testid='macro-category-row'][data-category='Recovered shared category']")
    await category.waitFor({ state: "visible" })
    await category.getByTestId("macro-category-menu").click()
    await page.getByTestId("macro-category-delete").click()
    await page.getByTestId("macro-delete-confirm").click()
    await page.getByTestId("macro-delete-undo").click()
    await manage.click()
    await category.waitFor({ state: "visible" })
    await page.keyboard.press("Escape")
    if (!await manage.isFocused()) throw new Error("macro_category_focus_not_restored")
    return { organizationCategorySurface: true, inputRetained: true, retrySucceeded: true, categoryDeleteUndo: true, focusRestored: true }
  })
} finally {
  await context.close()
  await browser.close()
}

await writeFile(path.join(outputDirectory, "macros-flow-evidence.json"), JSON.stringify(report, null, 2) + "\n")
const failures = report.results.filter((result) => result.status !== "passed")
if (report.results.length !== 6 || failures.length > 0) {
  console.error(JSON.stringify({ expected: 6, actual: report.results.length, failures }, null, 2))
  process.exitCode = 1
}
