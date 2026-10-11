import test from "node:test"
import assert from "node:assert/strict"
import { employeeCorrectionBrowserTarget } from "./workforce-employee-correction-browser-admission.mjs"

const fixture = () => ({
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "development",
  WF_EMPLOYEE_CORRECTION_BROWSER: "1", LEADDRIVE_DISABLE_SERVICE_WORKER: "1",
  WF_EMPLOYEE_CORRECTION_BROWSER_HEAD_SHA: "a".repeat(40), GITHUB_SHA: "b".repeat(40),
  WF_EMPLOYEE_CORRECTION_BROWSER_BASE_URL: "http://localhost:3005/",
  ADMIN_DATABASE_URL: "postgresql://postgres:synthetic-only@127.0.0.1:5433/workforce_manager_today_browser",
  DATABASE_URL: "postgresql://wf_manager_today_browser:synthetic-only@127.0.0.1:5433/workforce_manager_today_browser",
  EVENT_PLATFORM_TEST_DATABASE_URL: "postgresql://postgres:synthetic-only@127.0.0.1:5433/workforce_manager_today_browser",
  REDIS_URL: "redis://127.0.0.1:6380/0",
})

test("separate coherent disposable targets accepted, source and checked commit distinct", () => {
  const target = employeeCorrectionBrowserTarget(fixture())
  assert.equal(target.origin.origin, "http://localhost:3005")
  assert.equal(target.app.username, "wf_manager_today_browser")
  assert.equal(target.admin.host, target.app.host)
})

const refusals = [
  ["outside hosted workflow", { GITHUB_ACTIONS: "false" }],
  ["outside CI", { CI: "false" }],
  ["production mode", { NODE_ENV: "production" }],
  ["missing correction opt-in", { WF_EMPLOYEE_CORRECTION_BROWSER: undefined }],
  ["ACK profile present", { WF_EMPLOYEE_EXCEPTION_BROWSER: "1" }],
  ["service worker active", { LEADDRIVE_DISABLE_SERVICE_WORKER: "0" }],
  ["abbreviated source", { WF_EMPLOYEE_CORRECTION_BROWSER_HEAD_SHA: "aaaaaaa" }],
  ["abbreviated checked commit", { GITHUB_SHA: "bbbbbbb" }],
  ["production app target", { WF_EMPLOYEE_CORRECTION_BROWSER_BASE_URL: "https://app.leaddrivecrm.org/" }],
  ["remote app HTTP", { WF_EMPLOYEE_CORRECTION_BROWSER_BASE_URL: "http://example.test/" }],
  ["credential-bearing app", { WF_EMPLOYEE_CORRECTION_BROWSER_BASE_URL: "http://private-marker@localhost:3005/" }],
  ["app path", { WF_EMPLOYEE_CORRECTION_BROWSER_BASE_URL: "http://localhost:3005/workforce/" }],
  ["app query", { WF_EMPLOYEE_CORRECTION_BROWSER_BASE_URL: "http://localhost:3005/?fixture=1" }],
  ["app fragment", { WF_EMPLOYEE_CORRECTION_BROWSER_BASE_URL: "http://localhost:3005/#fixture" }],
  ["remote database", { DATABASE_URL: "postgresql://wf_manager_today_browser:private-marker@13.140.132.245/workforce_manager_today_browser" }],
  ["production database name", { DATABASE_URL: "postgresql://wf_manager_today_browser:private-marker@127.0.0.1:5433/leaddrive" }],
  ["privileged application role", { DATABASE_URL: "postgresql://postgres:private-marker@127.0.0.1:5433/workforce_manager_today_browser" }],
  ["different database port", { DATABASE_URL: "postgresql://wf_manager_today_browser:private-marker@127.0.0.1:5434/workforce_manager_today_browser" }],
  ["different admin fence", { EVENT_PLATFORM_TEST_DATABASE_URL: "postgresql://postgres:private-marker@127.0.0.1:5433/workforce_manager_today_browser" }],
  ["different app connection parameters", { DATABASE_URL: "postgresql://wf_manager_today_browser:private-marker@127.0.0.1:5433/workforce_manager_today_browser?sslmode=require" }],
  ["coherent extra database parameters", {
    ADMIN_DATABASE_URL: "postgresql://postgres:private-marker@127.0.0.1:5433/workforce_manager_today_browser?options=private-marker",
    DATABASE_URL: "postgresql://wf_manager_today_browser:private-marker@127.0.0.1:5433/workforce_manager_today_browser?options=private-marker",
    EVENT_PLATFORM_TEST_DATABASE_URL: "postgresql://postgres:private-marker@127.0.0.1:5433/workforce_manager_today_browser?options=private-marker",
  }],
  ["administrator-only extra parameters", { ADMIN_DATABASE_URL: "postgresql://postgres:private-marker@127.0.0.1:5433/workforce_manager_today_browser?application_name=private-marker" }],
  ["remote redis", { REDIS_URL: "redis://example.test:6380/0" }],
  ["different redis database", { REDIS_URL: "redis://127.0.0.1:6380/1" }],
  ["credential-bearing redis", { REDIS_URL: "redis://private-marker@127.0.0.1:6380/0" }],
]
for (const [name, overrides] of refusals) test(`refuse ${name} without disclosing supplied URLs`, () => {
  const env = { ...fixture(), ...overrides }
  assert.throws(() => employeeCorrectionBrowserTarget(env), error => {
    assert.ok(!String(error).includes("private-marker"))
    assert.ok(!String(error).includes("postgresql://"))
    return true
  })
})
