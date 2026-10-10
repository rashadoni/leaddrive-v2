import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createNativeZoomContext, proveNative200Zoom } from "../../scripts/workforce-native-browser-zoom.mjs"

const nativeLauncher = vi.hoisted(() => vi.fn())
vi.mock("playwright", () => ({ chromium: { launchPersistentContext: nativeLauncher } }))

// Exercise refusal before clients, SQL, app navigation or Chromium launch.
// All supplied URLs are unreachable loopback fixtures, never production.
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "development", WF_EXCEPTION_REPORT_BROWSER: "1",
  WF_EXCEPTION_REPORT_BROWSER_BASE_URL: "http://127.0.0.1:9/",
  ADMIN_DATABASE_URL: "postgresql://postgres:fixture@127.0.0.1:9/workforce_manager_today_browser",
  EVENT_PLATFORM_TEST_DATABASE_URL: "postgresql://postgres:fixture@127.0.0.1:9/workforce_manager_today_browser",
  DATABASE_URL: "postgresql://wf_manager_today_browser:fixture@127.0.0.1:9/workforce_manager_today_browser",
  WF_EXCEPTION_REPORT_BROWSER_HEAD_SHA: "a".repeat(40), GITHUB_SHA: "b".repeat(40),
}
const rejected = [
  ["non-hosted runtime", { GITHUB_ACTIONS: "false" }, "Hosted Actions required"],
  ["missing opt-in", { WF_EXCEPTION_REPORT_BROWSER: "0" }, "Fixture opt-in required"],
  ["production runtime", { NODE_ENV: "production" }, "Production is excluded"],
  ["remote application", { WF_EXCEPTION_REPORT_BROWSER_BASE_URL: "http://example.invalid/" }, "Loopback application required"],
  ["remote database", { ADMIN_DATABASE_URL: "postgresql://postgres:fixture@example.invalid/workforce_manager_today_browser" }, "Loopback fixture database required"],
  ["wrong database", { ADMIN_DATABASE_URL: "postgresql://postgres:fixture@127.0.0.1:9/unrelated_database" }, "Dedicated report fixture database required"],
  ["owner app role", { DATABASE_URL: "postgresql://postgres:fixture@127.0.0.1:9/workforce_manager_today_browser" }, "Exact fixture database role required"],
  ["mismatched fence", { EVENT_PLATFORM_TEST_DATABASE_URL: "postgresql://postgres:fixture@127.0.0.1:10/workforce_manager_today_browser" }, "Disposable RLS client fence must match"],
  ["inexact candidate", { WF_EXCEPTION_REPORT_BROWSER_HEAD_SHA: "a".repeat(12) }, "Candidate HEAD must be exact full SHA"],
] as const

describe("real report browser harness environment refusal", () => {
  it.each(rejected)("rejects %s before any fixture/browser execution", (_name, overrides, message) => {
    const result = spawnSync(process.execPath, [resolve("scripts/workforce-exception-report-browser-evidence.mjs")], {
      env: { ...environment, ...overrides }, encoding: "utf8", timeout: 3000,
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
    expect(result.stderr).not.toMatch(/PrismaClientInitializationError|browserType\.launch|ECONNREFUSED/)
  })
})

// These mocks test admission before any real Chromium, database or zoom proof.
// Actual native 200% evidence still requires the hosted browser scenarios.
describe("native report fixture admission", () => {
  beforeEach(() => {
    nativeLauncher.mockReset()
    for (const [key, value] of Object.entries({
      GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "development",
      WF_CALENDAR_BROWSER: "1", WF_MANAGER_TODAY_BROWSER: "1", WF_EXCEPTION_REPORT_BROWSER: "1",
      LEADDRIVE_DISABLE_SERVICE_WORKER: "1",
    })) vi.stubEnv(key, value)
  })

  afterEach(() => vi.unstubAllEnvs())

  it.each([
    ["GITHUB_ACTIONS", "false"], ["CI", "false"], ["NODE_ENV", "production"],
    ["WF_EXCEPTION_REPORT_BROWSER", "0"], ["LEADDRIVE_DISABLE_SERVICE_WORKER", "0"],
  ])("refuses %s=%s before launching the report fixture", async (key, value) => {
    vi.stubEnv(key, value)
    await expect(createNativeZoomContext("http://127.0.0.1:9/", "exception-report")).rejects.toThrow()
    expect(nativeLauncher).not.toHaveBeenCalled()
  })

  it.each([
    "https://127.0.0.1:9/", "http://example.invalid/", "http://127.0.0.1:9/workforce/exceptions/report",
    "http://fixture@127.0.0.1:9/", "http://127.0.0.1:9/?fixture=report", "http://127.0.0.1:9/#report",
  ])("refuses untrusted base URL %s before launching", async baseURL => {
    await expect(createNativeZoomContext(baseURL, "exception-report")).rejects.toThrow()
    expect(nativeLauncher).not.toHaveBeenCalled()
  })

  it.each(["", "exceptions", "exception-classification", "constructor"])("refuses unknown fixture %s", async fixture => {
    await expect(createNativeZoomContext("http://127.0.0.1:9/", fixture)).rejects.toThrow("Exact native fixture required")
    expect(nativeLauncher).not.toHaveBeenCalled()
  })

  it.each([
    ["calendar", "WF_CALENDAR_BROWSER", "/workforce/calendar"],
    ["manager-today", "WF_MANAGER_TODAY_BROWSER", "/workforce"],
    ["exception-report", "WF_EXCEPTION_REPORT_BROWSER", "/workforce/exceptions/report"],
  ])("keeps the %s opt-in and exact native page boundary", async (fixture, optIn, route) => {
    vi.stubEnv(optIn, "0")
    await expect(createNativeZoomContext("http://127.0.0.1:9/", fixture)).rejects.toThrow()
    expect(nativeLauncher).not.toHaveBeenCalled()
    vi.stubEnv(optIn, "1")

    const proofBoundary = new Error("NATIVE_ZOOM_EXECUTION_NOT_RUN_BY_UNIT_TEST")
    const worker = { url: () => "chrome-extension://synthetic-admission-worker/background.js", evaluate: vi.fn().mockRejectedValue(proofBoundary) }
    const context = { serviceWorkers: () => [worker], close: vi.fn().mockResolvedValue(undefined) }
    nativeLauncher.mockResolvedValue(context)
    const view = await createNativeZoomContext("http://127.0.0.1:9/", fixture)
    try {
      expect(nativeLauncher).toHaveBeenCalledOnce()
      expect(nativeLauncher.mock.calls[0][1]).toMatchObject({ baseURL: "http://127.0.0.1:9/", channel: "chromium", headless: true, viewport: null })
      const page = { context: () => context, url: () => `http://127.0.0.1:9${route}` }
      // A valid exact route reaches the first zoom API boundary, never a mocked PASS.
      await expect(proveNative200Zoom({ ...view, page }, "/tmp/unused-native-admission", "en", vi.fn())).rejects.toBe(proofBoundary)
      expect(worker.evaluate).toHaveBeenCalledOnce()
      worker.evaluate.mockClear()
      for (const url of ["http://127.0.0.1:9/workforce/exception-reports", "http://127.0.0.1:9/workforce/exceptions", `http://localhost:9${route}`, `http://127.0.0.1:9${route}?fixture=report`]) {
        await expect(proveNative200Zoom({ ...view, page: { ...page, url: () => url } }, "/tmp/unused-native-admission", "en", vi.fn())).rejects.toThrow()
      }
      expect(worker.evaluate).not.toHaveBeenCalled()
    } finally {
      await view.dispose()
    }
    expect(context.close).toHaveBeenCalledOnce()
  })
})
