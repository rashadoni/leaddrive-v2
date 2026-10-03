import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

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
