import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const harness = fileURLToPath(new URL("../../scripts/workforce-manager-today-browser-evidence.mjs", import.meta.url))
const adminURL = "postgresql://postgres:fixture-dummy@127.0.0.1:1/workforce_manager_today_browser"
const appURL = "postgresql://wf_manager_today_browser:fixture-dummy@127.0.0.1:1/workforce_manager_today_browser"

// No production credentials, ambient environment, PostgreSQL or browser are
// admitted. Every subprocess must fail a preconnection guard before creating
// its output directory or constructing the disposable database clients.
const baseline: Record<string, string> = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "development",
  WF_MANAGER_TODAY_BROWSER: "1",
  WF_MANAGER_TODAY_BROWSER_BASE_URL: "http://localhost:1/",
  ADMIN_DATABASE_URL: adminURL,
  EVENT_PLATFORM_TEST_DATABASE_URL: adminURL,
  DATABASE_URL: appURL,
  WF_MANAGER_TODAY_BROWSER_HEAD_SHA: "a".repeat(40),
  GITHUB_SHA: "b".repeat(40),
}

const rejected: Array<{ name: string; patch: Record<string, string>; error: string }> = [
  { name: "non-hosted execution", patch: { GITHUB_ACTIONS: "false" }, error: "Hosted Actions required" },
  { name: "missing explicit CI", patch: { CI: "false" }, error: "Explicit CI required" },
  { name: "missing fixture opt-in", patch: { WF_MANAGER_TODAY_BROWSER: "0" }, error: "Fixture opt-in required" },
  { name: "production runtime", patch: { NODE_ENV: "production" }, error: "Production is excluded" },
  { name: "remote application URL", patch: { WF_MANAGER_TODAY_BROWSER_BASE_URL: "http://203.0.113.1:1/" }, error: "Loopback application required" },
  { name: "remote application database", patch: { DATABASE_URL: appURL.replace("127.0.0.1", "203.0.113.1") }, error: "Loopback fixture database required" },
  { name: "wrong database", patch: { DATABASE_URL: appURL.replace("workforce_manager_today_browser", "unrelated_fixture") }, error: "Dedicated Today fixture database required" },
  { name: "privileged application role", patch: { DATABASE_URL: appURL.replace("wf_manager_today_browser:", "postgres:") }, error: "Exact fixture database role required" },
  { name: "incorrect admin role", patch: { ADMIN_DATABASE_URL: adminURL.replace("postgres:", "other_fixture:") }, error: "Exact fixture database role required" },
  { name: "mismatched RLS target", patch: { EVENT_PLATFORM_TEST_DATABASE_URL: adminURL.replace(":1/", ":2/") }, error: "Disposable RLS client fence must match the admin fixture target" },
  { name: "malformed candidate HEAD", patch: { WF_MANAGER_TODAY_BROWSER_HEAD_SHA: "not-a-sha" }, error: "Candidate HEAD must be exact full SHA" },
  { name: "malformed checked CI SHA", patch: { GITHUB_SHA: "not-a-sha" }, error: "Checked CI SHA must be exact full SHA" },
]

describe("Manager Today hosted fixture preconnection guards", () => {
  it.each(rejected)("rejects $name before fixture activation", ({ patch, error }) => {
    const temporary = mkdtempSync(join(tmpdir(), "wf-today-guard-"))
    const output = join(temporary, "must-not-be-created")
    try {
      const result = spawnSync(process.execPath, [harness], {
        env: { ...baseline, ...patch, WF_MANAGER_TODAY_BROWSER_OUTPUT_DIR: output },
        encoding: "utf8", timeout: 10_000, maxBuffer: 65_536,
      })
      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain(error)
      expect(result.stderr).not.toMatch(/PrismaClientInitializationError|Can't reach database|browserType\.launch|Executable doesn't exist/)
      expect(existsSync(output)).toBe(false)
      expect(result.stdout).toBe("")
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  })
})
