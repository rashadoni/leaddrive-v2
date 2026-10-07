import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

// Verify refusal before SQL clients, owner seeding, app navigation or Chromium.
// Every valid baseline URL points at an unreachable disposable loopback port.
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "development",
  WF_EXCEPTION_CLASSIFICATION_BROWSER: "1",
  WF_EXCEPTION_CLASSIFICATION_BROWSER_BASE_URL: "http://127.0.0.1:9/",
  ADMIN_DATABASE_URL: "postgresql://postgres:fixture@127.0.0.1:9/workforce_manager_today_browser",
  EVENT_PLATFORM_TEST_DATABASE_URL: "postgresql://postgres:fixture@127.0.0.1:9/workforce_manager_today_browser",
  DATABASE_URL: "postgresql://wf_manager_today_browser:fixture@127.0.0.1:9/workforce_manager_today_browser",
  REDIS_URL: "redis://127.0.0.1:9/0",
  WF_EXCEPTION_CLASSIFICATION_BROWSER_HEAD_SHA: "a".repeat(40), GITHUB_SHA: "b".repeat(40),
}
const rejected = [
  ["non-hosted runtime", { GITHUB_ACTIONS: "false" }, "Hosted Actions required"],
  ["missing opt-in", { WF_EXCEPTION_CLASSIFICATION_BROWSER: "0" }, "Fixture opt-in required"],
  ["production runtime", { NODE_ENV: "production" }, "Production excluded"],
  ["remote application", { WF_EXCEPTION_CLASSIFICATION_BROWSER_BASE_URL: "http://example.invalid/" }, "Loopback application required"],
  ["remote database", { ADMIN_DATABASE_URL: "postgresql://postgres:fixture@example.invalid/workforce_manager_today_browser" }, "Loopback fixture database required"],
  ["wrong database", { ADMIN_DATABASE_URL: "postgresql://postgres:fixture@127.0.0.1:9/unrelated_database" }, "workforce_manager_today_browser"],
  ["owner application role", { DATABASE_URL: "postgresql://postgres:fixture@127.0.0.1:9/workforce_manager_today_browser" }, "wf_manager_today_browser"],
  ["mismatched fence", { EVENT_PLATFORM_TEST_DATABASE_URL: "postgresql://postgres:fixture@127.0.0.1:10/workforce_manager_today_browser" }, "AssertionError"],
  ["remote Redis", { REDIS_URL: "redis://example.invalid:6379/0" }, "Real disposable loopback Redis required"],
  ["inexact candidate", { WF_EXCEPTION_CLASSIFICATION_BROWSER_HEAD_SHA: "a".repeat(12) }, "AssertionError"],
] as const

describe("real classification browser write harness environment refusal", () => {
  it.each(rejected)("rejects %s before fixture/browser execution", (_name, overrides, message) => {
    const result = spawnSync(process.execPath, [resolve("scripts/workforce-exception-classification-browser-evidence.mjs")], {
      env: { ...environment, ...overrides }, encoding: "utf8", timeout: 3000,
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
    expect(result.stderr).not.toMatch(/PrismaClientInitializationError|browserType\.launch|ECONNREFUSED/)
  })
})
