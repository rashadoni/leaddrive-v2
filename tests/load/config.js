/**
 * Shared k6 configuration for Mars Overseas load tests.
 *
 * Target: 351 concurrent users (national rollout)
 *
 * SLO targets (Acceptance: "351 users work simultaneously without UX degradation"):
 *   - P95 latency ≤ 500 ms for all field-agent endpoints
 *   - P99 latency ≤ 2 000 ms for photo-upload (multipart, larger payload)
 *   - Error rate < 1% (HTTP 5xx)
 *
 * Usage:
 *   k6 run --env BASE_URL=https://mars.leaddrivecrm.org \
 *          --env AGENT_TOKEN=<mobile-jwt> \
 *          tests/load/mars-overseas-full.js
 *
 * Or run a single scenario:
 *   k6 run --env BASE_URL=... tests/load/scenarios/location.js
 */

/** Target concurrency matching the national-rollout headcount */
export const TARGET_VUS = 351

/** Load profile — ramp to full concurrency, hold, ramp down */
export const RAMP_STAGES = [
  { duration: "2m", target: Math.round(TARGET_VUS * 0.5) }, // warm up to 50%
  { duration: "1m", target: TARGET_VUS },                    // ramp to full
  { duration: "10m", target: TARGET_VUS },                   // hold at peak
  { duration: "2m", target: 0 },                             // ramp down
]

/** Smoke test — verify each scenario works at minimal load before full run */
export const SMOKE_STAGES = [
  { duration: "30s", target: 5 },
  { duration: "30s", target: 5 },
  { duration: "10s", target: 0 },
]

/** Shared SLO thresholds — import in every scenario script */
export const SHARED_THRESHOLDS = {
  // HTTP error rate < 1%
  http_req_failed: [{ threshold: "rate<0.01", abortOnFail: false }],
  // P95 of all requests ≤ 500 ms
  http_req_duration: [
    { threshold: "p(95)<500", abortOnFail: false },
    { threshold: "p(99)<2000", abortOnFail: false },
  ],
}

/** Helper: build auth headers from env */
export function authHeaders() {
  const token = __ENV.AGENT_TOKEN  // eslint-disable-line no-undef
  if (!token) throw new Error("AGENT_TOKEN env var required")
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  }
}

/** Helper: base URL from env (no trailing slash) */
export function baseUrl() {
  const raw = __ENV.BASE_URL ?? "http://localhost:3001"  // eslint-disable-line no-undef
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error("BASE_URL must be an absolute http(s) URL")
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("BASE_URL must be an http(s) URL without embedded credentials")
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
  if (!localHosts.has(url.hostname)) {
    if (url.protocol !== 'https:') throw new Error("Remote load-test targets must use HTTPS")
    if (__ENV.LOAD_TEST_ENVIRONMENT !== 'staging') { // eslint-disable-line no-undef
      throw new Error("Remote load tests require LOAD_TEST_ENVIRONMENT=staging")
    }
    if (__ENV.CONFIRM_REMOTE_LOAD_TEST !== url.hostname) { // eslint-disable-line no-undef
      throw new Error("Set CONFIRM_REMOTE_LOAD_TEST to the exact staging hostname")
    }
  }
  return url.toString().replace(/\/$/, "")
}

function requiredFixtureString(value, field, index, maxLength) {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    throw new Error(`mobile sync v2 fixture ${index} requires a valid ${field}`)
  }
  return value
}

/**
 * Read the S6 pool from an external staging-only JSON file. The file is never
 * committed: it contains temporary mobile tokens and exact cohort device IDs.
 * `open` is a k6 init-context global, so this function must be called while a
 * scenario module is loading, not inside a VU iteration.
 */
export function loadMobileSyncV2FixturePool(filePath) {
  if (typeof filePath !== "string" || filePath.length < 1) {
    throw new Error("MOBILE_SYNC_V2_FIXTURE_POOL_FILE is required")
  }
  let decoded
  try {
    decoded = JSON.parse(open(filePath)) // eslint-disable-line no-undef
  } catch {
    throw new Error("MOBILE_SYNC_V2_FIXTURE_POOL_FILE must be readable JSON")
  }
  if (!Array.isArray(decoded)) throw new Error("mobile sync v2 fixture pool must be an array")
  return decoded.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`mobile sync v2 fixture ${index} must be an object`)
    }
    return {
      tenantId: requiredFixtureString(entry.tenantId, "tenantId", index, 128),
      agentId: requiredFixtureString(entry.agentId, "agentId", index, 128),
      deviceId: requiredFixtureString(entry.deviceId, "deviceId", index, 128),
      accessToken: requiredFixtureString(entry.accessToken, "accessToken", index, 8_192),
      apkVersion: requiredFixtureString(entry.apkVersion, "apkVersion", index, 64),
    }
  })
}

/**
 * A single token/device cannot model per-tenant and per-device guards. Refuse
 * a fixture pool that would make the S6 result look larger than it is. Errors
 * intentionally name only the invalid field/index, never a credential or ID.
 */
export function assertMobileSyncV2FixturePool(fixtures, { requiredUsers, requiredTenants }) {
  if (!Number.isSafeInteger(requiredUsers) || requiredUsers < 1) {
    throw new Error("mobile sync v2 requiredUsers must be a positive integer")
  }
  if (!Number.isSafeInteger(requiredTenants) || requiredTenants < 1) {
    throw new Error("mobile sync v2 requiredTenants must be a positive integer")
  }
  if (fixtures.length < requiredUsers) {
    throw new Error(`mobile sync v2 fixture pool needs at least ${requiredUsers} users`)
  }

  const tenantIds = new Set()
  const agentIds = new Set()
  const deviceIds = new Set()
  const accessTokens = new Set()
  for (const fixture of fixtures.slice(0, requiredUsers)) {
    if (agentIds.has(fixture.agentId)) throw new Error("mobile sync v2 fixture agents must be distinct")
    if (deviceIds.has(fixture.deviceId)) throw new Error("mobile sync v2 fixture devices must be distinct")
    // A reused JWT can silently collapse a nominal 5,000-user run into one
    // authenticated principal, bypassing the per-user guard that S6 is meant
    // to exercise. Do not include token values in the error or telemetry.
    if (accessTokens.has(fixture.accessToken)) throw new Error("mobile sync v2 fixture access tokens must be distinct")
    tenantIds.add(fixture.tenantId)
    agentIds.add(fixture.agentId)
    deviceIds.add(fixture.deviceId)
    accessTokens.add(fixture.accessToken)
  }
  if (tenantIds.size < requiredTenants) {
    throw new Error(`mobile sync v2 fixture pool needs at least ${requiredTenants} tenants`)
  }
}

/**
 * A fixture's declared tenant is only a staging assertion, never authority.
 * The S6 scenario calls bootstrap with the fixture JWT/device and accepts it
 * only if the server reports that same tenant and exact routes-v2 cohort.
 */
export function mobileSyncV2BootstrapMatchesFixture(body, fixture) {
  return Boolean(
    body &&
    body.success === true &&
    body.data &&
    body.data.tenant?.id === fixture.tenantId &&
    body.data.manifest?.syncV2?.routes === true,
  )
}

/**
 * Agent pool — k6 VU index maps to a simulated agent.
 * In production tests, replace FAKE-AGENT-{n} with real pre-seeded agent IDs
 * from the mars tenant seed (scripts/seeds/mars.mjs seeds 5 agents; expand
 * the seed before running a 351-VU test against staging).
 */
export function agentId() {
  // Use VU index modulo pool size so all 351 VUs cycle through available agents
  const poolSize = parseInt(__ENV.AGENT_POOL_SIZE ?? "5", 10)  // eslint-disable-line no-undef
  return `FAKE-AGENT-${(__VU % poolSize) + 1}`  // eslint-disable-line no-undef
}
