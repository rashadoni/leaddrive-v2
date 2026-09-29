import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { requireScreenshotTarget } from "./screenshot-auth-config.mjs"
import { assertDemoTenant, requireDemoTenant } from "./screenshot-safety.mjs"
import { captureSupportEvidenceScreenshot } from "./support-ux-screenshot.mjs"

if (process.env.SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral") {
  throw new Error("Support navigation flow evidence is restricted to the ephemeral target")
}

const { baseUrl, hostname } = requireScreenshotTarget()
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
  throw new Error("Support navigation flow evidence refuses a non-local host")
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
  if (values.length !== 1 || !allowed.has(values[0])) throw new Error(`${name} must select exactly one supported value for navigation evidence`)
  return values[0]
}

const locale = singleSelection("SUPPORT_EVIDENCE_LOCALES", "az", new Set(["az", "ru", "en"]))
const theme = singleSelection("SUPPORT_EVIDENCE_THEMES", "light", new Set(["light", "dark"]))
const outputDirectory = process.env.SUPPORT_EVIDENCE_OUTPUT_DIR || path.join("artifacts", "support-ux", new Date().toISOString().slice(0, 10))
const credentials = {
  support: { email: requiredEnv("SUPPORT_EVIDENCE_AGENT_EMAIL"), password: requiredEnv("SUPPORT_EVIDENCE_AGENT_PASSWORD") },
  manager: { email: requiredEnv("SUPPORT_EVIDENCE_MANAGER_EMAIL"), password: requiredEnv("SUPPORT_EVIDENCE_MANAGER_PASSWORD") },
  admin: { email: requiredEnv("SUPPORT_EVIDENCE_ADMIN_EMAIL"), password: requiredEnv("SUPPORT_EVIDENCE_ADMIN_PASSWORD") },
}
const activationEvidence = []

async function waitUntilEnabled(locator) {
  await locator.waitFor({ state: "visible", timeout: 30_000 })
  await locator.evaluate(async (element) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (!element.matches(":disabled, [aria-disabled='true']")) return
      await new Promise((resolve) => window.setTimeout(resolve, 50))
    }
    throw new Error("support_navigation_target_remained_disabled")
  })
}

async function activateWithKeyboard(locator, keyboardKey = "Enter") {
  await waitUntilEnabled(locator)
  await locator.press(keyboardKey)
  const detail = { inputModality: "keyboard", hitTarget: true, keyboardKey }
  activationEvidence.push(detail)
  return detail
}

async function activateWithTouch(page, locator) {
  await waitUntilEnabled(locator)
  await locator.scrollIntoViewIfNeeded()
  await locator.evaluate((element) => element.scrollIntoView({ block: "center", inline: "center" }))
  await page.waitForTimeout(50)
  const target = await locator.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    const hit = document.elementFromPoint(point.x, point.y)
    return {
      x: point.x,
      y: point.y,
      width: box.width,
      height: box.height,
      hitTarget: Boolean(hit && (element === hit || element.contains(hit))),
    }
  })
  if (target.width < 44 || target.height < 44) {
    throw new Error(`support_navigation_touch_target_too_small_${Math.round(target.width)}x${Math.round(target.height)}`)
  }
  if (!target.hitTarget) throw new Error("support_navigation_touch_hit_test_failed")
  await page.touchscreen.tap(target.x, target.y)
  const detail = {
    inputModality: "playwright-touchscreen",
    hitTarget: true,
    targetSize: { width: Math.round(target.width), height: Math.round(target.height) },
  }
  activationEvidence.push(detail)
  return detail
}

async function authenticate(context, role) {
  const csrfResponse = await context.request.get("/api/auth/csrf")
  const csrf = await csrfResponse.json()
  const response = await context.request.post("/api/auth/callback/credentials", {
    form: { csrfToken: csrf.csrfToken, email: credentials[role].email, password: credentials[role].password, callbackUrl: `${baseUrl}/tickets`, json: "true" },
  })
  if (!response.ok()) throw new Error(`support_navigation_${role}_authentication_failed`)
}

async function dismissTour(page) {
  const overlay = page.getByTestId("tour-overlay")
  if (await overlay.waitFor({ state: "visible", timeout: 1_000 }).then(() => true).catch(() => false)) await page.keyboard.press("Escape")
}

async function openSupport(page, route = "/tickets") {
  const response = await page.goto(route, { waitUntil: "domcontentloaded", timeout: 60_000 })
  if (!response || response.status() >= 400) throw new Error(`support_navigation_page_http_${response?.status() || 0}`)
  await page.getByTestId("sidebar").waitFor({ state: "visible", timeout: 30_000 })
  await dismissTour(page)
  assertDemoTenant(await page.locator("body").innerText(), demoOrganization, "Support navigation")
}

async function makeContext(role, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ baseURL: baseUrl, viewport, locale, colorScheme: theme, reducedMotion: "reduce", hasTouch: viewport.width < 1024 })
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, domain: hostname, path: "/" }])
  await context.addInitScript((activeTheme) => localStorage.setItem("theme", activeTheme), theme)
  await authenticate(context, role)
  return context
}

await mkdir(outputDirectory, { recursive: true })
const report = { generatedAt: new Date().toISOString(), commit, targetHost: hostname, demoOrganization, locale, theme, coverageViewports: ["desktop", "mobile"], activations: activationEvidence, results: [] }
const browser = await chromium.launch({ headless: true })
const context = await makeContext("admin")
const page = await context.newPage()
const mobileContext = await makeContext("admin", { width: 375, height: 812 })
const mobilePage = await mobileContext.newPage()

async function recordStep(id, action, evidencePage = page) {
  console.log(`[support-navigation-flow] ${id}`)
  try {
    const detail = await action()
    const screenshot = `support-navigation-flow-${id}-${locale}-${theme}.png`
    await captureSupportEvidenceScreenshot(evidencePage, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" })
    report.results.push({ id, status: "passed", screenshot, ...detail })
  } catch (error) {
    const screenshot = `support-navigation-flow-${id}-failed-${locale}-${theme}.png`
    await captureSupportEvidenceScreenshot(evidencePage, { path: path.join(outputDirectory, screenshot), fullPage: true, animations: "disabled" }).catch(() => undefined)
    report.results.push({ id, status: "failed", screenshot, reason: error instanceof Error ? error.message : String(error) })
  }
}

try {
  await recordStep("three-task-groups-and-active-destination", async () => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openSupport(page)
    const sections = page.getByTestId("support-navigation-section")
    if (await sections.count() !== 3) throw new Error("support_navigation_section_count_mismatch")
    for (const section of ["work", "team", "rules"]) {
      await page.locator(`[data-testid='support-navigation-section'][data-section='${section}']`).waitFor({ state: "visible" })
    }
    const work = page.locator("[data-testid='support-navigation-section-toggle'][data-section='work']")
    if (await work.getAttribute("aria-expanded") !== "true") throw new Error("support_navigation_work_not_open_by_default")
    const active = page.locator("[data-testid='sidebar-nav-item'][data-nav-href='/tickets'][data-nav-active='true']")
    await active.waitFor({ state: "visible" })
    await activateWithKeyboard(work)
    if (await work.getAttribute("aria-expanded") !== "true") throw new Error("support_navigation_active_section_was_hidden")
    return { viewport: "desktop", sections: 3, workDefaultOpen: true, activeDestinationVisible: true }
  })

  await recordStep("persistent-section-state-and-active-route-recovery", async () => {
    for (const section of ["team", "rules"]) {
      const toggle = page.locator(`[data-testid='support-navigation-section-toggle'][data-section='${section}']`)
      if (await toggle.getAttribute("aria-expanded") !== "true") await activateWithKeyboard(toggle)
    }
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.getByTestId("support-navigation-sections").waitFor({ state: "visible" })
    for (const section of ["team", "rules"]) {
      const expanded = await page.locator(`[data-testid='support-navigation-section-toggle'][data-section='${section}']`).getAttribute("aria-expanded")
      if (expanded !== "true") throw new Error(`support_navigation_${section}_state_not_persisted`)
    }
    await page.evaluate(() => localStorage.setItem("support-nav-open-sections", "[]"))
    await openSupport(page, "/settings/macros")
    const rules = page.locator("[data-testid='support-navigation-section-toggle'][data-section='rules']")
    if (await rules.getAttribute("aria-expanded") !== "true") throw new Error("support_navigation_active_rules_route_hidden")
    await page.locator("[data-testid='sidebar-nav-item'][data-nav-href='/settings/macros'][data-nav-active='true']").waitFor({ state: "visible" })
    return { viewport: "desktop", persistence: true, activeRouteOverridesCollapsedPreference: true }
  })

  await recordStep("collapsed-section-search-and-keyboard", async () => {
    await openSupport(page)
    await page.evaluate(() => localStorage.setItem("support-nav-open-sections", JSON.stringify(["work", "rules"])))
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.getByTestId("support-navigation-sections").waitFor({ state: "visible" })
    const rules = page.locator("[data-testid='support-navigation-section-toggle'][data-section='rules']")
    if (await rules.getAttribute("aria-expanded") !== "true") throw new Error("support_navigation_rules_precondition_not_open")
    await activateWithKeyboard(rules)
    const query = (await rules.innerText()).trim()
    const search = page.getByTestId("sidebar-search")
    await search.pressSequentially(query)
    const results = page.getByTestId("sidebar-search-result")
    if (await results.count() !== 7) throw new Error("support_navigation_collapsed_rules_not_searchable")
    await search.press("Escape")
    if (await search.inputValue() !== "") throw new Error("support_navigation_escape_did_not_clear_search")
    return { viewport: "desktop", collapsedDestinationsSearchable: 7, keyboardClear: true }
  })

  await recordStep("labeled-mobile-navigation", async () => {
    await openSupport(mobilePage)
    const navigation = mobilePage.getByTestId("support-mobile-navigation")
    await navigation.waitFor({ state: "visible" })
    const select = mobilePage.getByTestId("support-mobile-destination")
    if (!await select.isVisible()) throw new Error("support_mobile_navigation_not_visible")
    if ((await select.locator("optgroup").count()) !== 3) throw new Error("support_mobile_navigation_group_count_mismatch")
    if ((await select.locator("option").count()) !== 15) throw new Error("support_mobile_navigation_destination_count_mismatch")
    const activation = await activateWithTouch(mobilePage, select)
    await select.selectOption("/support/calendar")
    await mobilePage.waitForURL(/\/support\/calendar$/)
    if (await select.inputValue() !== "/support/calendar") throw new Error("support_mobile_navigation_active_destination_not_updated")
    const overflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    if (overflow) throw new Error("support_mobile_navigation_horizontal_overflow")
    return { viewport: "mobile", labeledControl: true, sections: 3, destinations: 15, touchNavigation: true, horizontalOverflow: false, activation }
  }, mobilePage)

  await recordStep("role-feature-and-addon-visibility", async () => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const outcomes = {}
    for (const role of ["support", "manager", "admin"]) {
      const roleContext = role === "admin" ? context : await makeContext(role)
      const rolePage = role === "admin" ? page : await roleContext.newPage()
      try {
        await openSupport(rolePage)
        const aiCount = await rolePage.locator("[data-nav-href='/support/ai-settings']").count()
        outcomes[role] = { supportAiVisible: aiCount > 0 }
        if (role === "admin" && aiCount === 0) throw new Error("support_navigation_admin_ai_gate_missing")
        if (role !== "admin" && aiCount > 0) throw new Error(`support_navigation_${role}_ai_gate_weakened`)
        for (const href of ["/complaints", "/support/voip", "/tickets"]) {
          if (await rolePage.locator(`[data-nav-href='${href}']`).count() === 0) throw new Error(`support_navigation_${role}_${href}_expected_gate_missing`)
        }
      } finally {
        if (role !== "admin") await roleContext.close()
      }
    }
    return { viewport: "desktop", roles: outcomes, featureAndAddonDestinationsVisible: true, adminOnlyAiPreserved: true }
  })
} finally {
  await mobileContext.close()
  await context.close()
  await browser.close()
}

await writeFile(path.join(outputDirectory, "support-navigation-flow-evidence.json"), JSON.stringify(report, null, 2) + "\n")
const failures = report.results.filter((result) => result.status !== "passed")
if (report.results.length !== 5 || activationEvidence.length !== 5 || failures.length > 0) {
  console.error(JSON.stringify({ expected: 5, actual: report.results.length, expectedActivations: 5, actualActivations: activationEvidence.length, failures }, null, 2))
  process.exitCode = 1
}
