import assert from "node:assert/strict"

const loopback = new Set(["127.0.0.1", "localhost", "[::1]"])
const fixtureURL = value => {
  try { return new URL(value) } catch { throw new Error("Fixture URL invalid") }
}

/** Prove the separate hosted request fixture before opening a connection. */
export function employeeCorrectionBrowserTarget(env) {
  assert.ok(env.GITHUB_ACTIONS === "true" && env.CI === "true", "Hosted CI required")
  assert.ok(env.NODE_ENV !== "production", "Production excluded")
  assert.ok(env.WF_EMPLOYEE_CORRECTION_BROWSER === "1", "Correction fixture opt-in required")
  assert.ok(env.WF_EMPLOYEE_EXCEPTION_BROWSER === undefined, "Acknowledgement fixture excluded")
  assert.ok(env.LEADDRIVE_DISABLE_SERVICE_WORKER === "1", "Service worker must be disabled")
  assert.ok(/^[a-f0-9]{40}$/.test(env.WF_EMPLOYEE_CORRECTION_BROWSER_HEAD_SHA || ""), "Full source SHA required")
  assert.ok(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || ""), "Full checked SHA required")
  const origin = fixtureURL(env.WF_EMPLOYEE_CORRECTION_BROWSER_BASE_URL)
  assert.ok(origin.protocol === "http:" && loopback.has(origin.hostname), "Loopback HTTP required")
  assert.ok(origin.pathname === "/" && !origin.username && !origin.password && !origin.search && !origin.hash, "Bare fixture origin required")
  const database = (value, role) => {
    const url = fixtureURL(value)
    assert.ok(["postgres:", "postgresql:"].includes(url.protocol) && loopback.has(url.hostname), "Loopback PostgreSQL required")
    assert.ok(url.pathname === "/workforce_manager_today_browser" && url.username === role && !url.search && !url.hash, "Bare disposable database and role required")
    return url
  }
  const admin = database(env.ADMIN_DATABASE_URL, "postgres")
  const app = database(env.DATABASE_URL, "wf_manager_today_browser")
  const fence = database(env.EVENT_PLATFORM_TEST_DATABASE_URL, "postgres")
  // Compare booleans so assertion errors cannot include credential-bearing URLs.
  assert.ok(admin.host === app.host && admin.protocol === app.protocol && admin.search === app.search, "Database target mismatch")
  assert.ok(admin.href === fence.href, "Administrator target fence mismatch")
  const redis = fixtureURL(env.REDIS_URL)
  assert.ok(redis.protocol === "redis:" && loopback.has(redis.hostname)
    && redis.pathname === "/0" && !redis.username && !redis.password && !redis.search && !redis.hash, "Disposable loopback Redis required")
  return { origin, admin, app }
}
