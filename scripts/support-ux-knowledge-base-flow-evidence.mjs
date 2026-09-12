import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { requireScreenshotTarget } from "./screenshot-auth-config.mjs"
import { assertDemoTenant, requireDemoTenant } from "./screenshot-safety.mjs"
import { captureSupportEvidenceScreenshot } from "./support-ux-screenshot.mjs"

if (process.env.SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral") {
  throw new Error("Mutating Knowledge Base evidence is restricted to the ephemeral target")
}

const { baseUrl, hostname } = requireScreenshotTarget()
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
  throw new Error("Mutating Knowledge Base evidence refuses a non-local host")
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
const outputDirectory = process.env.SUPPORT_EVIDENCE_OUTPUT_DIR
  || path.join("artifacts", "support-ux", new Date().toISOString().slice(0, 10))
const articleId = requiredEnv("SUPPORT_EVIDENCE_KB_ARTICLE_ID")
const manager = {
  email: requiredEnv("SUPPORT_EVIDENCE_MANAGER_EMAIL"),
  password: requiredEnv("SUPPORT_EVIDENCE_MANAGER_PASSWORD"),
}
const customer = {
  email: requiredEnv("SUPPORT_EVIDENCE_PORTAL_EMAIL"),
  password: requiredEnv("SUPPORT_EVIDENCE_PORTAL_PASSWORD"),
}

async function authenticate(context, account, callbackPath) {
  const csrfResponse = await context.request.get("/api/auth/csrf")
  const csrf = await csrfResponse.json()
  const response = await context.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email: account.email,
      password: account.password,
      callbackUrl: baseUrl + callbackPath,
      json: "true",
    },
  })
  if (!response.ok()) throw new Error("knowledge_base_authentication_failed")
}

async function dismissTour(page) {
  const overlay = page.getByTestId("tour-overlay")
  if (await overlay.waitFor({ state: "visible", timeout: 1_000 }).then(() => true).catch(() => false)) {
    await page.keyboard.press("Escape")
  }
}

async function openLibrary(page, pathName = "/knowledge-base") {
  const response = await page.goto(pathName, { waitUntil: "domcontentloaded", timeout: 60_000 })
  if (!response || response.status() >= 400) throw new Error(`page_http_${response?.status() || 0}`)
  await page.locator("[data-testid='knowledge-base-workspace'][data-state='ready']").waitFor({ state: "visible", timeout: 30_000 })
  await dismissTour(page)
  assertDemoTenant(await page.locator("body").innerText(), demoOrganization, "Knowledge Base")
}

async function openArticle(page) {
  const response = await page.goto(`/knowledge-base/${encodeURIComponent(articleId)}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  if (!response || response.status() >= 400) throw new Error(`page_http_${response?.status() || 0}`)
  await page.locator("[data-testid='knowledge-article-workspace'][data-state='ready']").waitFor({ state: "visible", timeout: 30_000 })
  assertDemoTenant(await page.locator("body").innerText(), demoOrganization, "Knowledge article")
}

function jsonFailure(message, status = 503) {
  return { status, contentType: "application/json", body: JSON.stringify({ success: false, error: message }) }
}

function emptyLibraryResponse() {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      data: { articles: [], total: 0, page: 1, limit: 500, search: "", summary: { total: 0, published: 0, draft: 0, views: 0, categories: [] } },
    }),
  }
}

await mkdir(outputDirectory, { recursive: true })
const report = {
  generatedAt: new Date().toISOString(),
  commit,
  targetHost: hostname,
  demoOrganization,
  roles: ["manager", "customer"],
  locale,
  theme,
  viewport: viewportName,
  results: [],
}

const browser = await chromium.launch({ headless: true })
const contextOptions = {
  baseURL: baseUrl,
  viewport: viewports[viewportName],
  locale,
  colorScheme: theme,
  reducedMotion: "reduce",
  hasTouch: viewportName !== "desktop",
}
const managerContext = await browser.newContext(contextOptions)
const customerContext = await browser.newContext(contextOptions)
for (const context of [managerContext, customerContext]) {
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: hostname, path: "/" }])
  await context.addInitScript((activeTheme) => localStorage.setItem("theme", activeTheme), theme)
}

async function recordStep(page, id, action) {
  console.log(`[knowledge-base-flow] ${id}`)
  try {
    const detail = await action()
    const screenshot = `knowledge-base-flow-${id}-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" })
    report.results.push({ id, status: "passed", screenshot, ...detail })
  } catch (error) {
    const screenshot = `knowledge-base-flow-${id}-failed-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" }).catch(() => undefined)
    report.results.push({ id, status: "failed", screenshot, reason: error instanceof Error ? error.message : String(error) })
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined)
  }
}

const managerPage = await managerContext.newPage()
const customerPage = await customerContext.newPage()
try {
  await authenticate(managerContext, manager, "/knowledge-base")
  await authenticate(customerContext, customer, "/portal/knowledge-base")

  await recordStep(managerPage, "library-load-failure-and-keyboard-recovery", async () => {
    const libraryPattern = /\/api\/v1\/kb\?/
    const deny = async (route) => route.fulfill(jsonFailure("Synthetic library failure"))
    await managerPage.route(libraryPattern, deny)
    await managerPage.goto("/knowledge-base", { waitUntil: "domcontentloaded" })
    await managerPage.getByTestId("knowledge-base-load-error").waitFor({ state: "visible" })
    await managerPage.unroute(libraryPattern, deny)
    await managerPage.getByTestId("knowledge-base-load-retry").focus()
    await managerPage.getByTestId("knowledge-base-load-retry").press("Enter")
    await managerPage.locator("[data-testid='knowledge-base-workspace'][data-state='ready']").waitFor({ state: "visible" })

    const forbid = async (route) => route.fulfill(jsonFailure("Synthetic permission denial", 403))
    await managerPage.route(libraryPattern, forbid)
    await managerPage.reload({ waitUntil: "domcontentloaded" })
    await managerPage.getByTestId("knowledge-base-load-error").waitFor({ state: "visible" })
    if (await managerPage.getByTestId("knowledge-base-load-retry").count() !== 0) throw new Error("library_permission_offered_misleading_retry")
    await managerPage.unroute(libraryPattern, forbid)
    await openLibrary(managerPage)
    return { errorObserved: true, keyboardRetry: true, recoverySucceeded: true, permissionStateObserved: true, misleadingRetryAbsent: true }
  })

  await recordStep(managerPage, "category-partial-failure-and-recovery", async () => {
    const deny = async (route) => route.fulfill(jsonFailure("Synthetic category failure"))
    await managerPage.route("**/api/v1/kb-categories", deny)
    await openLibrary(managerPage)
    await managerPage.getByTestId("knowledge-base-categories-error").waitFor({ state: "visible" })
    if (await managerPage.getByTestId("knowledge-base-article-row").count() === 0) throw new Error("category_failure_removed_article_snapshot")
    await managerPage.unroute("**/api/v1/kb-categories", deny)
    await managerPage.getByTestId("knowledge-base-categories-retry").click()
    await managerPage.getByTestId("knowledge-base-categories-error").waitFor({ state: "hidden" })
    return { articleSnapshotPreserved: true, retrySucceeded: true }
  })

  await recordStep(managerPage, "empty-library-and-recovery", async () => {
    const libraryPattern = /\/api\/v1\/kb\?/
    const empty = async (route) => route.fulfill(emptyLibraryResponse())
    await managerPage.route(libraryPattern, empty)
    await openLibrary(managerPage)
    await managerPage.getByTestId("knowledge-base-empty-state").waitFor({ state: "visible" })
    await managerPage.getByTestId("knowledge-base-empty-create").waitFor({ state: "visible" })
    await managerPage.unroute(libraryPattern, empty)
    await managerPage.reload({ waitUntil: "domcontentloaded" })
    await managerPage.getByTestId("knowledge-base-article-row").first().waitFor({ state: "visible" })
    return { emptyStateObserved: true, createPathPresent: true, recoverySucceeded: true }
  })

  await recordStep(managerPage, "filter-category-keyboard-and-return-context", async () => {
    await openLibrary(managerPage, "/knowledge-base?q=Resolve&status=published")
    const toggle = managerPage.getByTestId("knowledge-base-category-toggle").first()
    await toggle.focus()
    await toggle.press("Space")
    if (await toggle.getAttribute("aria-expanded") !== "false") throw new Error("category_keyboard_collapse_failed")
    await toggle.press("Space")
    if (await toggle.getAttribute("aria-expanded") !== "true") throw new Error("category_keyboard_expand_failed")
    await managerPage.getByTestId("knowledge-base-article-row").first().locator("a").first().click()
    await managerPage.getByTestId("knowledge-article-workspace").waitFor({ state: "visible" })
    await managerPage.getByTestId("knowledge-article-back").click()
    await managerPage.locator("[data-testid='knowledge-base-workspace'][data-state='ready']").waitFor({ state: "visible" })
    const url = new URL(managerPage.url())
    if (url.searchParams.get("q") !== "Resolve" || url.searchParams.get("status") !== "published") throw new Error("knowledge_return_context_lost")
    return { keyboardDisclosure: true, returnContextPreserved: true }
  })

  await recordStep(managerPage, "article-load-failure-permission-and-recovery", async () => {
    const articlePattern = new RegExp(`/api/v1/kb/${articleId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)
    const deny = async (route) => route.fulfill(jsonFailure("Synthetic article failure"))
    await managerPage.route(articlePattern, deny)
    await managerPage.goto(`/knowledge-base/${encodeURIComponent(articleId)}`, { waitUntil: "domcontentloaded" })
    await managerPage.getByTestId("knowledge-article-load-error").waitFor({ state: "visible" })
    await managerPage.unroute(articlePattern, deny)
    await managerPage.getByTestId("knowledge-article-load-retry").click()
    await managerPage.getByTestId("knowledge-article-workspace").waitFor({ state: "visible" })

    const forbid = async (route) => route.fulfill(jsonFailure("Synthetic permission denial", 403))
    await managerPage.route(articlePattern, forbid)
    await managerPage.reload({ waitUntil: "domcontentloaded" })
    await managerPage.getByTestId("knowledge-article-load-error").waitFor({ state: "visible" })
    if (await managerPage.getByTestId("knowledge-article-load-retry").count() !== 0) throw new Error("article_permission_offered_misleading_retry")
    await managerPage.unroute(articlePattern, forbid)
    await openArticle(managerPage)
    return { transientRetrySucceeded: true, permissionStateObserved: true, misleadingRetryAbsent: true }
  })

  await recordStep(managerPage, "edit-form-recovery", async () => {
    await openArticle(managerPage)
    const categoryDeny = async (route) => route.fulfill(jsonFailure("Synthetic category picker failure"))
    await managerPage.route("**/api/v1/kb-categories", categoryDeny)
    await managerPage.getByTestId("knowledge-article-edit").click()
    await managerPage.getByTestId("knowledge-article-categories-retry").waitFor({ state: "visible" })
    await managerPage.unroute("**/api/v1/kb-categories", categoryDeny)
    await managerPage.getByTestId("knowledge-article-categories-retry").click()
    await managerPage.getByTestId("knowledge-article-categories-retry").waitFor({ state: "hidden" })

    const saveDeny = async (route) => route.request().method() === "PUT"
      ? route.fulfill(jsonFailure("Synthetic article save failure"))
      : route.continue()
    await managerPage.route(`**/api/v1/kb/${articleId}`, saveDeny)
    const originalTitle = await managerPage.locator("#title").inputValue()
    await managerPage.getByTestId("knowledge-article-submit").focus()
    await managerPage.getByTestId("knowledge-article-submit").press("Enter")
    await managerPage.getByTestId("knowledge-article-save-error").waitFor({ state: "visible" })
    if (await managerPage.locator("#title").inputValue() !== originalTitle) throw new Error("save_failure_discarded_form_values")
    await managerPage.unroute(`**/api/v1/kb/${articleId}`, saveDeny)
    await managerPage.getByTestId("knowledge-article-submit").click()
    await managerPage.getByTestId("knowledge-article-form").waitFor({ state: "hidden" })
    return { categoryRetrySucceeded: true, keyboardSubmit: true, valuesPreserved: true, saveRetrySucceeded: true }
  })

  await recordStep(managerPage, "publication-failure-portal-boundary-and-restore", async () => {

    await openArticle(managerPage)
    const initialStatus = await managerPage.getByTestId("knowledge-article-status").getAttribute("data-status")
    const nextStatus = initialStatus === "published" ? "draft" : "published"
    const denyPut = async (route) => route.request().method() === "PUT"
      ? route.fulfill(jsonFailure("Synthetic publication failure"))
      : route.continue()
    await managerPage.route(`**/api/v1/kb/${articleId}`, denyPut)
    await managerPage.getByTestId("knowledge-article-publication").click()
    const dialog = managerPage.getByRole("dialog")
    await dialog.locator("button").last().click()
    await dialog.getByRole("alert").waitFor({ state: "visible" })
    if (await managerPage.getByTestId("knowledge-article-status").getAttribute("data-status") !== initialStatus) throw new Error("publication_failure_changed_status")
    await managerPage.unroute(`**/api/v1/kb/${articleId}`, denyPut)
    await dialog.locator("button").last().click()
    await dialog.waitFor({ state: "hidden" })
    await managerPage.locator(`[data-testid='knowledge-article-status'][data-status='${nextStatus}']`).waitFor({ state: "visible" })

    await customerPage.goto("/portal/knowledge-base", { waitUntil: "domcontentloaded" })
    await customerPage.locator("[data-testid='portal-knowledge-workspace'][data-state='ready']").waitFor({ state: "visible" })
    const portalCount = await customerPage.locator(`[data-testid='portal-knowledge-article-row'][data-article-id='${articleId}']`).count()
    if ((nextStatus === "published" && portalCount !== 1) || (nextStatus === "draft" && portalCount !== 0)) throw new Error("portal_publication_boundary_failed")

    await managerPage.getByTestId("knowledge-article-publication").click()
    const restoreDialog = managerPage.getByRole("dialog")
    await restoreDialog.locator("button").last().click()
    await restoreDialog.waitFor({ state: "hidden" })
    await managerPage.locator(`[data-testid='knowledge-article-status'][data-status='${initialStatus}']`).waitFor({ state: "visible" })
    return { failedMutationRolledBack: true, retrySucceeded: true, portalBoundaryVerified: true, fixtureRestored: true }
  })

  await recordStep(customerPage, "portal-load-search-and-recovery", async () => {
    const listPattern = (url) => url.pathname === "/api/v1/public/portal-kb" && !url.searchParams.has("id")
    const deny = async (route) => route.fulfill(jsonFailure("Synthetic portal library failure"))
    await customerPage.route(listPattern, deny)
    await customerPage.goto("/portal/knowledge-base", { waitUntil: "domcontentloaded" })
    await customerPage.getByTestId("portal-knowledge-load-error").waitFor({ state: "visible" })
    await customerPage.unroute(listPattern, deny)
    await customerPage.getByTestId("portal-knowledge-load-retry").focus()
    await customerPage.getByTestId("portal-knowledge-load-retry").press("Enter")
    await customerPage.locator("[data-testid='portal-knowledge-workspace'][data-state='ready']").waitFor({ state: "visible" })
    await customerPage.getByTestId("portal-knowledge-search").fill("no-result-support-evidence")
    await customerPage.getByTestId("portal-knowledge-empty-state").waitFor({ state: "visible" })
    await customerPage.getByTestId("portal-knowledge-clear-filters").click()
    await customerPage.getByTestId("portal-knowledge-list").waitFor({ state: "visible" })
    return { keyboardRetry: true, recoverySucceeded: true, noResultsReset: true }
  })

  await recordStep(customerPage, "portal-article-failure-and-recovery", async () => {
    await customerPage.goto("/portal/knowledge-base", { waitUntil: "domcontentloaded" })
    await customerPage.getByTestId("portal-knowledge-list").waitFor({ state: "visible" })
    const detailPattern = (url) => url.pathname === "/api/v1/public/portal-kb" && url.searchParams.get("id") === articleId
    const deny = async (route) => route.fulfill(jsonFailure("Synthetic portal article failure"))
    await customerPage.route(detailPattern, deny)
    await customerPage.locator(`[data-testid='portal-knowledge-article-row'][data-article-id='${articleId}']`).click()
    await customerPage.getByTestId("portal-knowledge-article-error").waitFor({ state: "visible" })
    await customerPage.unroute(detailPattern, deny)
    await customerPage.getByTestId("portal-knowledge-article-error").getByRole("button").first().click()
    await customerPage.getByTestId("portal-knowledge-article").waitFor({ state: "visible" })
    return { articleErrorObserved: true, retrySucceeded: true }
  })
} finally {
  await managerContext.close()
  await customerContext.close()
  await browser.close()
}

await writeFile(path.join(outputDirectory, "knowledge-base-flow-evidence.json"), JSON.stringify(report, null, 2) + "\n")
const failures = report.results.filter((result) => result.status !== "passed")
if (report.results.length !== 9 || failures.length > 0) {
  console.error(JSON.stringify({ expected: 9, actual: report.results.length, failures }, null, 2))
  process.exitCode = 1
}
