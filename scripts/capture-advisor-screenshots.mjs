#!/usr/bin/env node
/**
 * Capture Da Vinci Advisor Center screenshots for responsive QA and decks.
 *
 * Examples:
 *   BASE_URL=http://localhost:3000 ADVISOR_STORAGE_STATE=storageState.json node scripts/capture-advisor-screenshots.mjs
 *   BASE_URL=https://crm.example.com ADMIN_EMAIL=demo@example.com ADMIN_PASSWORD=... \
 *     CONFIRM_REMOTE_SCREENSHOT=crm.example.com node scripts/capture-advisor-screenshots.mjs
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { requireScreenshotTarget } from "./screenshot-auth-config.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { baseUrl: BASE_URL } = requireScreenshotTarget({
  baseUrl: process.env.BASE_URL || "http://localhost:3000",
})
const OUTPUT_DIR = process.env.ADVISOR_SCREENSHOT_DIR || path.join(__dirname, "..", "docs", "screenshots", "advisor")
const STORAGE_STATE = process.env.ADVISOR_STORAGE_STATE || process.env.STORAGE_STATE || ""
const EMAIL = process.env.ADMIN_EMAIL || process.env.ADVISOR_EMAIL || ""
const PASSWORD = process.env.ADMIN_PASSWORD || process.env.ADVISOR_PASSWORD || ""
const NAVIGATION_TIMEOUT_MS = Number(process.env.ADVISOR_NAV_TIMEOUT_MS || 120_000)
const qaResults = []

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 920 },
  { name: "laptop", width: 1180, height: 820 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
]

const TARGETS = [
  { name: "today-routes", path: "/ai/actions?tab=today&domain=routes" },
  { name: "detail-routes", path: "/ai/actions?tab=detail&domain=routes" },
  { name: "modules", path: "/ai/actions?tab=modules" },
  { name: "ask", path: "/ai/actions?tab=ask" },
  { name: "queue", path: "/ai/actions?tab=queue" },
  { name: "history", path: "/ai/actions?tab=history" },
]

const TARGET_EXPECTATIONS = {
  "today-routes": [/Da Vinci Advisor Center/i, /Today|Сегодня|Bugün|Open risks|Открытые риски|Açıq risklər|No active advisor signals|Нет активных сигналов/i, /Routes|Маршруты|Marşrut/i],
  "detail-routes": [/Da Vinci Advisor Center/i, /Detail|Детали|Detallar|Risk detail|Детали риска|Select a risk|Выберите риск/i],
  modules: [/Da Vinci Advisor Center/i, /Modules|Модули|Modullar|Advisor coverage by module|Покрытие Advisor|Coverage status|Статус покрытия/i],
  ask: [/Da Vinci Advisor Center/i, /Ask|Спросить|Soruş|Quick questions|Быстрые вопросы|Ask Advisor/i],
  queue: [/Da Vinci Advisor Center/i, /Approval Queue|Очередь согласования|Təsdiq növbəsi|No pending actions|Нет действий|Approve|Одобрить|Reject|Отклонить/i],
  history: [/Da Vinci Advisor Center/i, /History|История|Tarixçə|No reviewed actions|Истории согласований|Approved|Одобрено|Rejected|Отклонено/i],
}

const RUNTIME_ERROR_TEXT = [
  /Unhandled Runtime Error/i,
  /Application error/i,
  /Hydration failed/i,
  /ReferenceError:/i,
  /TypeError:/i,
  /Cannot read properties/i,
  /This page could not be found/i,
]

function absoluteUrl(relativePath) {
  return new URL(relativePath, BASE_URL).toString()
}

async function waitForSettledPage(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: NAVIGATION_TIMEOUT_MS })
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1200)
}

async function loginIfNeeded(context, page) {
  if (STORAGE_STATE) return
  if (!EMAIL || !PASSWORD) {
    throw new Error("Set ADVISOR_STORAGE_STATE or ADMIN_EMAIL/ADMIN_PASSWORD before running screenshot capture.")
  }

  await page.goto(absoluteUrl("/api/auth/csrf"), { waitUntil: "domcontentloaded", timeout: 30000 })
  const csrfText = await page.textContent("body")
  const csrfToken = JSON.parse(csrfText || "{}").csrfToken
  if (!csrfToken) throw new Error("Could not read NextAuth CSRF token.")

  const loginResponse = await context.request.post(absoluteUrl("/api/auth/callback/credentials"), {
    form: {
      email: EMAIL,
      password: PASSWORD,
      csrfToken,
      callbackUrl: BASE_URL,
      redirect: "false",
      json: "true",
    },
    maxRedirects: 0,
  })
  if (![200, 302].includes(loginResponse.status())) {
    throw new Error(`Advisor login failed with HTTP ${loginResponse.status()}: ${await loginResponse.text().catch(() => "")}`)
  }

  await context.addCookies([{
    name: "NEXT_LOCALE",
    value: "en",
    url: BASE_URL,
  }])
}

async function setEnglishLocale(context) {
  await context.addCookies([{
    name: "NEXT_LOCALE",
    value: "en",
    url: BASE_URL,
  }])
}

async function assertAuthenticatedAdvisor(page) {
  if (page.url().includes("/login")) {
    throw new Error(`Advisor route redirected to login: ${page.url()}`)
  }
  await page.waitForFunction(() => {
    return /Advisor|Da Vinci|Approval Queue|Today|Сегодня|Спросить|Модули|Очередь согласования/i.test(document.body?.innerText || "")
  }, null, { timeout: 30000 }).catch(() => undefined)
  const text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "")
  if (!/Advisor|Da Vinci|Approval Queue|Today/i.test(text)) {
    throw new Error(`Advisor page did not render recognizable Advisor content at ${page.url()}: ${text.replace(/\s+/g, " ").trim().slice(0, 300)}`)
  }
}

async function waitForAdvisorReady(page) {
  await page.waitForFunction(() => {
    return document.querySelector("[data-advisor-loaded]")?.getAttribute("data-advisor-loaded") === "true"
  }, null, { timeout: NAVIGATION_TIMEOUT_MS })
}

async function hideLocalDevOverlays(page) {
  await page.addStyleTag({
    content: `
      nextjs-portal,
      [data-nextjs-dev-overlay],
      [data-nextjs-toast],
      [data-nextjs-dev-tools],
      [data-nextjs-build-indicator],
      [aria-label="Next.js logo"] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `,
  }).catch(() => {})
}

async function assertTargetContent(page, target) {
  const text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "")
  const expectation = TARGET_EXPECTATIONS[target.name] || [/Da Vinci Advisor Center/i]
  const failed = expectation.filter((pattern) => !pattern.test(text))
  if (failed.length > 0) {
    throw new Error(`${target.name} did not render expected Advisor content: ${failed.map(String).join(", ")}`)
  }

  const runtimeError = RUNTIME_ERROR_TEXT.find((pattern) => pattern.test(text))
  if (runtimeError) {
    throw new Error(`${target.name} rendered runtime error text: ${runtimeError}`)
  }
}

async function collectResponsiveMetrics(page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    const clientWidth = Math.ceil(doc.clientWidth)
    const scrollWidth = Math.ceil(doc.scrollWidth)
    const offenders = Array.from(document.body.querySelectorAll("*"))
      .map((element) => {
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        if (rect.width <= 0 || rect.height <= 0 || style.visibility === "hidden" || style.display === "none") return null
        const overLeft = Math.max(0, Math.ceil(0 - rect.left))
        const overRight = Math.max(0, Math.ceil(rect.right - window.innerWidth))
        if (overLeft <= 2 && overRight <= 2) return null
        return {
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === "string" ? element.className.slice(0, 160) : "",
          text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          overLeft,
          overRight,
        }
      })
      .filter(Boolean)
      .slice(0, 10)

    return {
      clientWidth,
      scrollWidth,
      horizontalOverflow: Math.max(0, scrollWidth - clientWidth),
      offenders,
    }
  })
}

async function assertResponsiveLayout(page, target, viewport) {
  const metrics = await collectResponsiveMetrics(page)
  const result = {
    target: target.name,
    viewport: viewport.name,
    width: viewport.width,
    height: viewport.height,
    url: page.url(),
    ...metrics,
  }
  qaResults.push(result)

  if (metrics.horizontalOverflow > 2) {
    throw new Error(`${target.name}/${viewport.name} has horizontal overflow ${metrics.horizontalOverflow}px: ${JSON.stringify(metrics.offenders)}`)
  }
  if (metrics.offenders.length > 0) {
    throw new Error(`${target.name}/${viewport.name} has offscreen elements: ${JSON.stringify(metrics.offenders)}`)
  }
}

async function captureTarget(page, target, viewport) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(absoluteUrl(target.path), { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS })
      await waitForSettledPage(page)
      await assertAuthenticatedAdvisor(page)
      await waitForAdvisorReady(page)
      await assertTargetContent(page, target)
      await assertResponsiveLayout(page, target, viewport)
      lastError = null
      break
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      const retryableShell = /did not render recognizable Advisor content/i.test(message)
      if (!retryableShell || attempt === 3) break
      console.warn(`Retry ${target.name}/${viewport.name} after shell-only render (${attempt}/3)`)
      await page.waitForTimeout(1500)
    }
  }
  if (lastError) throw lastError

  await hideLocalDevOverlays(page)
  const filename = `${target.name}-${viewport.name}.png`
  const filePath = path.join(OUTPUT_DIR, filename)
  await page.screenshot({ path: filePath, type: "png", fullPage: true })
  console.log(`OK ${filename}`)
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: "chrome" })
  const context = await browser.newContext({
    ...(STORAGE_STATE ? { storageState: STORAGE_STATE } : {}),
    colorScheme: "light",
    locale: "en-US",
    deviceScaleFactor: 2,
  })
  const authPage = await context.newPage()

  try {
    await setEnglishLocale(context)
    await loginIfNeeded(context, authPage)
    await authPage.close()
    for (const target of TARGETS) {
      for (const viewport of VIEWPORTS) {
        const page = await context.newPage()
        await captureTarget(page, target, viewport)
        await page.close()
      }
    }
    fs.writeFileSync(path.join(OUTPUT_DIR, "responsive-qa-report.json"), `${JSON.stringify({
      baseUrl: BASE_URL,
      capturedAt: new Date().toISOString(),
      targets: TARGETS.map((target) => target.path),
      viewports: VIEWPORTS,
      results: qaResults,
    }, null, 2)}\n`)
    console.log(`Advisor screenshots saved to ${OUTPUT_DIR}`)
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
