import { describe, expect, it } from "vitest"
import {
  assertEmployeeExceptionCaptureAllowed,
  employeeExceptionBrowserTarget,
} from "../../scripts/workforce-employee-exception-browser-admission.mjs"

const head = "1".repeat(40)
const target = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "development",
  WF_EMPLOYEE_EXCEPTION_BROWSER: "1", LEADDRIVE_DISABLE_SERVICE_WORKER: "1",
  WF_EMPLOYEE_EXCEPTION_BROWSER_HEAD_SHA: head, GITHUB_SHA: head,
  WF_EMPLOYEE_EXCEPTION_BROWSER_BASE_URL: "http://localhost:3001/",
  ADMIN_DATABASE_URL: "postgresql://postgres:fixture@127.0.0.1:5433/workforce_manager_today_browser",
  DATABASE_URL: "postgresql://wf_manager_today_browser:fixture@127.0.0.1:5433/workforce_manager_today_browser",
  EVENT_PLATFORM_TEST_DATABASE_URL: "postgresql://postgres:fixture@127.0.0.1:5433/workforce_manager_today_browser",
  REDIS_URL: "redis://127.0.0.1:6380/0",
}

describe("hosted employee self-flow admission", () => {
  it("admits only the complete isolated target before connections", () => {
    const admitted = employeeExceptionBrowserTarget(target)
    expect(admitted.origin.origin).toBe("http://localhost:3001")
    expect(admitted.app.username).toBe("wf_manager_today_browser")
  })

  it.each([
    ["GITHUB_ACTIONS", "false"], ["CI", "false"], ["NODE_ENV", "production"],
    ["WF_EMPLOYEE_EXCEPTION_BROWSER", "0"], ["LEADDRIVE_DISABLE_SERVICE_WORKER", "0"],
    ["WF_EMPLOYEE_EXCEPTION_BROWSER_HEAD_SHA", "1".repeat(7)], ["GITHUB_SHA", "main"],
    ["WF_EMPLOYEE_EXCEPTION_BROWSER_BASE_URL", "https://localhost:3001/"],
    ["WF_EMPLOYEE_EXCEPTION_BROWSER_BASE_URL", "http://example.test/"],
    ["WF_EMPLOYEE_EXCEPTION_BROWSER_BASE_URL", "http://localhost:3001/workforce"],
    ["WF_EMPLOYEE_EXCEPTION_BROWSER_BASE_URL", "http://fixture:secret@localhost:3001/"],
    ["WF_EMPLOYEE_EXCEPTION_BROWSER_BASE_URL", "http://localhost:3001/?fixture=1"],
    ["ADMIN_DATABASE_URL", "postgresql://postgres:fixture@example.test/workforce_manager_today_browser"],
    ["DATABASE_URL", "postgresql://postgres:fixture@127.0.0.1:5433/workforce_manager_today_browser"],
    ["DATABASE_URL", "postgresql://wf_manager_today_browser:fixture@127.0.0.1:5433/production"],
    ["DATABASE_URL", "postgresql://wf_manager_today_browser:fixture@127.0.0.1:5434/workforce_manager_today_browser"],
    ["EVENT_PLATFORM_TEST_DATABASE_URL", "postgresql://postgres:another@127.0.0.1:5433/workforce_manager_today_browser"],
    ["REDIS_URL", "redis://example.test/0"],
    ["REDIS_URL", "redis://127.0.0.1:6380/1"],
  ])("refuses changed %s before any connection", (key, value) => {
    expect(() => employeeExceptionBrowserTarget({ ...target, [key]: value })).toThrow()
  })

  it("does not expose credential-bearing targets when the administrator fence differs", () => {
    let message = ""
    try {
      employeeExceptionBrowserTarget({ ...target, EVENT_PLATFORM_TEST_DATABASE_URL: target.EVENT_PLATFORM_TEST_DATABASE_URL.replace("fixture", "private-sentinel") })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain("Administrator target fence mismatch")
    expect(message).not.toContain("private-sentinel")
    expect(message).not.toContain("postgresql://")
  })

  it("refuses malformed URLs without attaching their private input", () => {
    let failure: unknown
    try {
      employeeExceptionBrowserTarget({ ...target, DATABASE_URL: "private-sentinel" })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe("Fixture URL invalid")
    expect(JSON.stringify(failure)).not.toContain("private-sentinel")
  })
})

describe("employee evidence privacy admission", () => {
  const blank = { freeTextValues: ["", ""], visibleText: "Generic own case", protectedMarkers: ["private HR reason"] }

  it("admits the existing generic self-only page with blank inputs", () => {
    expect(() => assertEmployeeExceptionCaptureAllowed(blank)).not.toThrow()
  })

  it.each(["p", "private HR reason", " ", "\n", "unlisted private text"])("refuses every partial or nonempty input", value => {
    expect(() => assertEmployeeExceptionCaptureAllowed({ ...blank, freeTextValues: ["", value] })).toThrow("Nonempty free-text input forbids capture")
  })

  it("refuses a protected subject appearing outside a form as well", () => {
    expect(() => assertEmployeeExceptionCaptureAllowed({ ...blank, visibleText: "Generic own case: private HR reason" })).toThrow("Protected fixture subject forbids capture")
  })

  it("requires the protected-subject inventory instead of silently omitting it", () => {
    expect(() => assertEmployeeExceptionCaptureAllowed({ ...blank, protectedMarkers: [] })).toThrow("Capture privacy facts required")
  })
})
