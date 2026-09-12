import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import ExcelJS from "exceljs"
import { chromium } from "playwright"
import { requireScreenshotTarget } from "./screenshot-auth-config.mjs"
import { assertDemoTenant, requireDemoTenant } from "./screenshot-safety.mjs"
import { captureSupportEvidenceScreenshot } from "./support-ux-screenshot.mjs"

if (process.env.SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral") {
  throw new Error("Mutating Complaint flow evidence is restricted to the ephemeral target")
}

const { baseUrl, hostname } = requireScreenshotTarget()
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
  throw new Error("Mutating Complaint flow evidence refuses a non-local host")
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
const manager = {
  email: requiredEnv("SUPPORT_EVIDENCE_MANAGER_EMAIL"),
  password: requiredEnv("SUPPORT_EVIDENCE_MANAGER_PASSWORD"),
}
const referenceComplaintId = requiredEnv("SUPPORT_EVIDENCE_COMPLAINT_ID")

async function authenticate(context) {
  const csrfResponse = await context.request.get("/api/auth/csrf")
  const csrf = await csrfResponse.json()
  const response = await context.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email: manager.email,
      password: manager.password,
      callbackUrl: baseUrl + "/complaints",
      json: "true",
    },
  })
  if (!response.ok()) throw new Error("dashboard_authentication_failed")
}

async function openWorkspace(page, workspacePath, readySelector) {
  const response = await page.goto(workspacePath, { waitUntil: "domcontentloaded", timeout: 60_000 })
  if (!response || response.status() >= 400) throw new Error(`page_http_${response?.status() || 0}`)
  await page.locator("body").waitFor({ state: "visible" })
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined)
  await page.locator(readySelector).waitFor({ state: "visible", timeout: 30_000 })
  const tourOverlay = page.getByTestId("tour-overlay")
  if (await tourOverlay.waitFor({ state: "visible", timeout: 1_000 }).then(() => true).catch(() => false)) {
    await page.keyboard.press("Escape")
  }
  assertDemoTenant(await page.locator("body").innerText(), demoOrganization, workspacePath)
}

async function buildWorkbookBuffer() {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Complaints")
  sheet.addRow(["Sıra", "Müştərinin ad və soyadı", "Şikayət məzmunu", "Marka", "Status", "Önəmlilik dərəcəsi"])
  sheet.addRow([9001, "Evidence Customer", `Import evidence ${commit.slice(0, 8)}`, "Northstar Desk", "open", "orta riskli"])
  sheet.addRow([9002, "Retry Customer", `Retry evidence ${commit.slice(0, 8)}`, "Northstar Desk", "open", "aşağı riskli"])
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

await mkdir(outputDirectory, { recursive: true })
const report = {
  generatedAt: new Date().toISOString(),
  commit,
  targetHost: hostname,
  demoOrganization,
  role: "manager",
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
  acceptDownloads: true,
})
await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: hostname, path: "/" }])
await context.addInitScript((activeTheme) => localStorage.setItem("theme", activeTheme), theme)

async function recordStep(page, id, action) {
  console.log(`[complaint-flow] ${id}`)
  try {
    const detail = await action()
    const screenshot = `complaint-flow-${id}-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" })
    report.results.push({ id, status: "passed", screenshot, ...detail })
  } catch (error) {
    const screenshot = `complaint-flow-${id}-failed-${locale}-${theme}-${viewportName}.png`
    await captureSupportEvidenceScreenshot(page, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" }).catch(() => undefined)
    report.results.push({ id, status: "failed", screenshot, reason: error instanceof Error ? error.message : String(error) })
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined)
  }
}

const page = await context.newPage()
let createdComplaintId = ""
try {
  await authenticate(context)

  await recordStep(page, "registry-context-and-scroll-recovery", async () => {
    const complaintsPattern = "**/api/v1/complaints**"
    const inflateRows = async (route) => {
      const requestUrl = new URL(route.request().url())
      if (route.request().method() !== "GET" || requestUrl.pathname !== "/api/v1/complaints") return route.continue()
      const original = await route.fetch()
      const json = await original.json()
      const source = json?.data?.complaints?.[0]
      if (!source) throw new Error("reference_complaint_missing")
      const complaints = Array.from({ length: 36 }, (_, index) => index === 0 ? source : ({
        ...source,
        id: `visual-density-${index}`,
        ticketNumber: `CMP-${9100 + index}`,
        subject: `Synthetic complaint ${index}`,
      }))
      await route.fulfill({ response: original, json: { success: true, data: { ...json.data, complaints, total: complaints.length } } })
    }
    await page.route(complaintsPattern, inflateRows)
    await openWorkspace(page, "/complaints?q=Northstar", "[data-testid='complaints-workspace']")
    const maxScroll = await page.evaluate(() => {
      const scroller = document.querySelector("main")
      return scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0
    })
    const expectedScroll = Math.min(maxScroll, 420)
    if (expectedScroll < 200) throw new Error(`registry_scroll_range_too_small_${maxScroll}`)
    await page.evaluate((top) => document.querySelector("main")?.scrollTo({ top, behavior: "instant" }), expectedScroll)
    const row = page.locator("tbody tr[tabindex='0']").first()
    await row.focus()
    await Promise.all([
      page.waitForURL((url) => url.pathname === `/complaints/${referenceComplaintId}`),
      page.keyboard.press("Enter"),
    ])
    const returnTo = new URL(page.url()).searchParams.get("returnTo")
    if (!returnTo || new URL(returnTo, baseUrl).searchParams.get("q") !== "Northstar") throw new Error("registry_context_missing")
    await page.getByTestId("complaint-detail-back").click()
    await page.waitForURL((url) => url.pathname === "/complaints" && url.searchParams.get("q") === "Northstar")
    await page.getByTestId("complaints-workspace").waitFor({ state: "visible" })
    const restoredScroll = await page.evaluate(() => document.querySelector("main")?.scrollTop ?? 0)
    if (Math.abs(restoredScroll - expectedScroll) > 80) throw new Error(`registry_scroll_not_restored_${expectedScroll}_${restoredScroll}`)
    return { keyboardOpen: true, queryPreserved: true, expectedScroll, restoredScroll }
  })

  await recordStep(page, "registry-load-failure-and-recovery", async () => {
    const pattern = "**/api/v1/complaints**"
    const deny = async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() === "GET" && url.pathname === "/api/v1/complaints") {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic registry failure" }) })
      } else await route.continue()
    }
    await page.route(pattern, deny)
    await openWorkspace(page, "/complaints", "[data-testid='complaints-workspace']")
    await page.getByTestId("complaints-load-error").waitFor({ state: "visible" })
    await page.unroute(pattern, deny)
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/v1/complaints" && candidate.request().method() === "GET"),
      page.getByTestId("complaints-retry-load").click(),
    ])
    if (!response.ok()) throw new Error(`registry_retry_http_${response.status()}`)
    await page.getByTestId("complaints-results").waitFor({ state: "visible" })
    return { errorObserved: true, retrySucceeded: true }
  })

  await recordStep(page, "export-failure-and-recovery", async () => {
    await openWorkspace(page, "/complaints", "[data-testid='complaints-workspace']")
    const pattern = "**/api/v1/complaints/export-xlsx**"
    const deny = async (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic export failure" }) })
    await page.route(pattern, deny)
    await page.getByTestId("complaints-secondary-actions").click()
    await page.getByTestId("complaints-export").click()
    await page.getByTestId("complaints-export-error").waitFor({ state: "visible" })
    await page.unroute(pattern, deny)
    const [download, response] = await Promise.all([
      page.waitForEvent("download"),
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/v1/complaints/export-xlsx"),
      page.getByTestId("complaints-retry-export").click(),
    ])
    if (!response.ok()) throw new Error(`export_retry_http_${response.status()}`)
    if (!download.suggestedFilename().endsWith(".xlsx")) throw new Error("export_filename_invalid")
    await page.getByTestId("complaints-export-complete").waitFor({ state: "visible" })
    return { errorObserved: true, retrySucceeded: true, downloaded: download.suggestedFilename() }
  })

  await recordStep(page, "draft-navigation-create-failure-and-recovery", async () => {
    const returnTo = "/complaints?q=Northstar"
    await openWorkspace(page, `/complaints/new?returnTo=${encodeURIComponent(returnTo)}`, "[data-testid='complaint-new-workspace']")
    const content = `Disposable complaint ${commit.slice(0, 8)}`
    await page.getByTestId("complaint-new-customer").fill("Evidence Customer")
    await page.getByTestId("complaint-new-content").fill(content)
    await page.waitForTimeout(350)
    await page.getByTestId("complaint-new-cancel").focus()
    await page.getByTestId("complaint-new-cancel").press("Enter")
    const dialog = page.getByRole("dialog")
    await dialog.waitFor({ state: "visible" })
    await dialog.getByRole("button").last().focus()
    await dialog.getByRole("button").last().press("Enter")
    await page.waitForURL((url) => url.pathname === "/complaints" && url.searchParams.get("q") === "Northstar")
    await openWorkspace(page, `/complaints/new?returnTo=${encodeURIComponent(returnTo)}`, "[data-testid='complaint-new-workspace']")
    await page.getByTestId("complaint-new-draft-recovered").waitFor({ state: "visible" })
    if (await page.getByTestId("complaint-new-content").inputValue() !== content) throw new Error("create_draft_not_restored")
    const pattern = "**/api/v1/complaints"
    const deny = async (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic create failure" }) })
    await page.route(pattern, deny)
    const [failed] = await Promise.all([
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/v1/complaints" && candidate.request().method() === "POST"),
      page.getByTestId("complaint-new-submit").click(),
    ])
    if (failed.status() !== 503) throw new Error(`create_failure_intercept_missed_${failed.status()}`)
    await page.getByTestId("complaint-new-error").waitFor({ state: "visible" })
    if (await page.getByTestId("complaint-new-content").inputValue() !== content) throw new Error("create_failure_discarded_draft")
    await page.unroute(pattern, deny)
    await Promise.all([
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/v1/complaints" && candidate.request().method() === "POST" && candidate.ok()),
      page.getByTestId("complaint-new-submit").click(),
    ])
    await page.waitForURL((url) => /^\/complaints\/[^/]+$/.test(url.pathname))
    createdComplaintId = new URL(page.url()).pathname.split("/").pop() || ""
    if (!createdComplaintId) throw new Error("created_complaint_id_missing")
    return { leaveWarningObserved: true, draftRecovered: true, failedDraftPreserved: true, createdComplaintId }
  })

  await recordStep(page, "response-failure-and-recovery", async () => {
    if (!createdComplaintId) throw new Error("created_complaint_unavailable")
    await page.getByTestId("complaint-detail-workspace").waitFor({ state: "visible" })
    const content = `Complaint response ${commit.slice(0, 8)}`
    const composer = page.getByTestId("complaint-response-composer")
    await composer.fill(content)
    const pattern = "**/api/v1/tickets/*/comments"
    const deny = async (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic response failure" }) })
    await page.route(pattern, deny)
    const [failed] = await Promise.all([
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/v1/tickets/${createdComplaintId}/comments`),
      page.getByTestId("complaint-response-send").click(),
    ])
    if (failed.status() !== 503) throw new Error(`response_failure_intercept_missed_${failed.status()}`)
    await page.getByTestId("complaint-response-error").waitFor({ state: "visible" })
    if (await composer.inputValue() !== content) throw new Error("response_failure_discarded_draft")
    await page.unroute(pattern, deny)
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/v1/tickets/${createdComplaintId}/comments`),
      page.getByTestId("complaint-response-retry").click(),
    ])
    if (!response.ok()) throw new Error(`response_retry_http_${response.status()}`)
    await page.getByText(content, { exact: true }).waitFor({ state: "visible" })
    return { draftPreserved: true, retrySucceeded: true }
  })

  await recordStep(page, "status-permission-and-recovery", async () => {
    const pattern = "**/api/v1/complaints/*"
    const deny = async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic permission denial" }) })
      } else await route.continue()
    }
    await page.route(pattern, deny)
    const [denied] = await Promise.all([
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/v1/complaints/${createdComplaintId}` && candidate.request().method() === "PATCH"),
      page.getByTestId("complaint-status-resolved").click(),
    ])
    if (denied.status() !== 403) throw new Error(`status_permission_intercept_missed_${denied.status()}`)
    await page.getByTestId("complaint-detail-action-error").waitFor({ state: "visible" })
    await page.unroute(pattern, deny)
    await Promise.all([
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/v1/complaints/${createdComplaintId}` && candidate.request().method() === "PATCH" && candidate.ok()),
      page.getByTestId("complaint-status-resolved").click(),
    ])
    await page.getByTestId("complaint-status-open").waitFor({ state: "visible" })
    await page.getByTestId("complaint-status-open").click()
    await page.getByTestId("complaint-status-resolved").waitFor({ state: "visible" })
    return { permissionDeniedObserved: true, retrySucceeded: true, restoredOpen: true }
  })

  await recordStep(page, "assignment-failure-rollback-and-recovery", async () => {
    const select = page.getByTestId("complaint-assignee-select")
    const options = await select.locator("option").evaluateAll((items) => items.map((item) => item.value).filter(Boolean))
    if (options.length === 0) throw new Error("assignee_options_missing")
    const target = options[0]
    await select.selectOption(target)
    const pattern = "**/api/v1/complaints/*"
    const deny = async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic assignment failure" }) })
      } else await route.continue()
    }
    await page.route(pattern, deny)
    const [failed] = await Promise.all([
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/v1/complaints/${createdComplaintId}` && candidate.request().method() === "PATCH"),
      page.getByTestId("complaint-assignee-save").click(),
    ])
    if (failed.status() !== 503) throw new Error(`assignment_failure_intercept_missed_${failed.status()}`)
    await page.getByTestId("complaint-detail-action-error").waitFor({ state: "visible" })
    await page.waitForFunction(() => document.querySelector("[data-testid='complaint-assignee-select']")?.value === "")
      .catch(() => { throw new Error("assignment_failure_did_not_rollback") })
    await page.unroute(pattern, deny)
    await select.selectOption(target)
    const [saved] = await Promise.all([
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/v1/complaints/${createdComplaintId}` && candidate.request().method() === "PATCH"),
      page.getByTestId("complaint-assignee-save").click(),
    ])
    if (!saved.ok()) throw new Error(`assignment_retry_http_${saved.status()}`)
    await select.selectOption("")
    const [restored] = await Promise.all([
      page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/v1/complaints/${createdComplaintId}` && candidate.request().method() === "PATCH"),
      page.getByTestId("complaint-assignee-save").click(),
    ])
    if (!restored.ok()) throw new Error(`assignment_restore_http_${restored.status()}`)
    await page.waitForFunction(() => document.querySelector("[data-testid='complaint-assignee-select']")?.value === "")
    return { rollbackObserved: true, retrySucceeded: true, fixtureRestored: true }
  })

  await recordStep(page, "stale-detail-and-recovery", async () => {
    const pattern = "**/api/v1/complaints/*"
    const deny = async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic stale detail" }) })
      } else await route.continue()
    }
    await page.route(pattern, deny)
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
    await page.getByTestId("complaint-detail-stale").waitFor({ state: "visible", timeout: 10_000 })
    await page.unroute(pattern, deny)
    await page.getByTestId("complaint-detail-retry-stale").click()
    await page.getByTestId("complaint-detail-stale").waitFor({ state: "hidden" })
    return { staleDataPreserved: true, retrySucceeded: true }
  })

  await recordStep(page, "detail-permission-and-recovery", async () => {
    const pattern = "**/api/v1/complaints/*"
    const deny = async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ success: false, error: "Synthetic permission denial" }) })
      } else await route.continue()
    }
    await page.route(pattern, deny)
    await page.goto(`/complaints/${referenceComplaintId}`, { waitUntil: "domcontentloaded" })
    await page.getByTestId("complaint-detail-load-error").waitFor({ state: "visible" })
    assertDemoTenant(await page.locator("body").innerText(), demoOrganization, "complaint permission state")
    await page.unroute(pattern, deny)
    await page.getByTestId("complaint-detail-retry-load").click()
    await page.getByTestId("complaint-detail-workspace").waitFor({ state: "visible" })
    return { permissionDeniedObserved: true, retrySucceeded: true }
  })

  await recordStep(page, "import-validation-preview-partial-and-retry", async () => {
    await openWorkspace(page, "/complaints/import", "[data-testid='complaint-import-workspace']")
    const input = page.getByTestId("complaint-import-file")
    await input.setInputFiles({ name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from("invalid") })
    await page.getByTestId("complaint-import-error").waitFor({ state: "visible" })
    const workbook = await buildWorkbookBuffer()
    await input.setInputFiles({
      name: "complaint-evidence.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: workbook,
    })
    await page.getByTestId("complaint-import-preview").waitFor({ state: "visible", timeout: 20_000 })
    const pattern = "**/api/v1/complaints/import-xlsx"
    let importAttempt = 0
    const simulatedResult = async (route) => {
      const request = route.request()
      if (request.method() !== "POST") return route.continue()
      const body = request.postDataBuffer()?.toString("utf8") || ""
      if (body.includes('name="dryRun"')) return route.continue()
      importAttempt += 1
      const data = importAttempt === 1
        ? { totalParsed: 2, imported: 1, errors: [{ row: 3, error: "Synthetic row failure" }] }
        : { totalParsed: 1, imported: 1, errors: [], retriedRows: [3] }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data }) })
    }
    await page.route(pattern, simulatedResult)
    await page.getByTestId("complaint-import-run").click()
    await page.getByTestId("complaint-import-result").waitFor({ state: "visible" })
    const download = page.waitForEvent("download")
    await page.getByTestId("complaint-import-download-errors").click()
    if (!(await download).suggestedFilename().endsWith(".csv")) throw new Error("import_error_filename_invalid")
    await page.getByTestId("complaint-import-retry-rows").click()
    await page.getByTestId("complaint-import-retry-rows").waitFor({ state: "hidden" })
    if (importAttempt !== 2) throw new Error(`import_retry_count_${importAttempt}`)
    return { invalidFileRejected: true, mappingPreviewed: true, partialObserved: true, csvDownloaded: true, failedRowsRetried: true }
  })
} finally {
  await context.close()
  await browser.close()
}

await writeFile(path.join(outputDirectory, "complaint-flow-evidence.json"), JSON.stringify(report, null, 2) + "\n")
const failures = report.results.filter((result) => result.status !== "passed")
if (report.results.length !== 10 || failures.length > 0) {
  console.error(JSON.stringify({ expected: 10, actual: report.results.length, failures }, null, 2))
  process.exitCode = 1
}
