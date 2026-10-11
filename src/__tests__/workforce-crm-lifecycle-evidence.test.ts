import { describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"

// Admission tests deliberately never pass the pre-connection boundary.
// Successful database/browser acceptance belongs to hosted disposable jobs.
describe("Workforce CRM lifecycle evidence admission", () => {
  it.each([
    { profile: "unknown", env: {}, marker: "known fixture profile" },
    { profile: "calendar", env: { GITHUB_ACTIONS: "false" }, marker: "false" },
    { profile: "calendar", env: { CI: "false" }, marker: "false" },
    { profile: "calendar", env: { NODE_ENV: "production" as const }, marker: "development" },
    { profile: "calendar", env: { WF_CALENDAR_BROWSER_BASE_URL: "https://example.invalid" }, marker: "http:" },
  ])("refuses $profile outside the allowed disposable environment ($marker)", ({ profile, env, marker }) => {
    const result = spawnSync(process.execPath, ["scripts/workforce-crm-lifecycle-evidence.mjs", profile], {
      encoding: "utf8", timeout: 15_000,
      env: {
        PATH: process.env.PATH,
        GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "development", LEADDRIVE_DISABLE_SERVICE_WORKER: "1",
        ADMIN_DATABASE_URL: "must-not-connect-or-print-sentinel",
        DATABASE_URL: "must-not-connect-or-print-sentinel",
        ...env,
      },
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(marker)
    expect(result.stderr).not.toContain("must-not-connect-or-print-sentinel")
  })
})
