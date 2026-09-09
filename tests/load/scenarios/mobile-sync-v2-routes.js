/**
 * S6 morning login/sync storm for exact-cohort routes v2 devices.
 *
 * This is deliberately separate from the v1 Mars smoke: every VU takes one
 * staging-only fixture with a distinct tenant, agent, device and token, so it
 * exercises the real tenant/user/device guards instead of one hot identity.
 */

import http from "k6/http"
import { SharedArray } from "k6/data"
import { check, sleep } from "k6"
import { Counter, Trend } from "k6/metrics"
import {
  assertMobileSyncV2FixturePool,
  baseUrl,
  loadMobileSyncV2FixturePool,
  mobileSyncV2BootstrapMatchesFixture,
} from "../config.js"

const bootstrapLatency = new Trend("mobile_sync_v2_bootstrap_latency", true)
const routeSyncLatency = new Trend("mobile_sync_v2_routes_latency", true)
const routeSyncPages = new Counter("mobile_sync_v2_routes_pages")
const routeSyncFailures = new Counter("mobile_sync_v2_routes_failures")

function integerEnv(name, fallback, min, max) {
  const parsed = Number(__ENV[name]) // eslint-disable-line no-undef
  if (!Number.isSafeInteger(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function requiredEnv(name) {
  const value = __ENV[name] // eslint-disable-line no-undef
  if (typeof value !== "string" || value.length < 1) throw new Error(`${name} is required`)
  return value
}

const TARGET_USERS = integerEnv("MOBILE_SYNC_V2_TARGET_USERS", 5_000, 1, 5_000)
const TARGET_TENANTS = integerEnv("MOBILE_SYNC_V2_TARGET_TENANTS", 100, 1, 100)
const PAGE_SIZE = integerEnv("MOBILE_SYNC_V2_PAGE_SIZE", 200, 1, 500)
const MAX_PAGES = integerEnv("MOBILE_SYNC_V2_MAX_PAGES", 100, 1, 500)
const MAX_RETRIES = integerEnv("MOBILE_SYNC_V2_RETRY_ATTEMPTS", 1, 0, 2)
const LOGIN_JITTER_SECONDS = integerEnv("MOBILE_SYNC_V2_LOGIN_JITTER_SECONDS", 120, 0, 300)
const ALLOW_SMALL_POOL = __ENV.MOBILE_SYNC_V2_ALLOW_SMALL_POOL === "1" // eslint-disable-line no-undef

if (__ENV.LOAD_TEST_ENVIRONMENT !== "staging") { // eslint-disable-line no-undef
  throw new Error("mobile sync v2 S6 scenario requires LOAD_TEST_ENVIRONMENT=staging")
}
if ((TARGET_USERS < 5_000 || TARGET_TENANTS < 100) && !ALLOW_SMALL_POOL) {
  throw new Error("S6 requires 100 tenants / 5000 users; set MOBILE_SYNC_V2_ALLOW_SMALL_POOL=1 only for a labeled staging smoke")
}
const BASE_URL = baseUrl()

const fixturePool = new SharedArray("mobile-sync-v2-routes-fixtures", () => {
  const fixtures = loadMobileSyncV2FixturePool(requiredEnv("MOBILE_SYNC_V2_FIXTURE_POOL_FILE"))
  assertMobileSyncV2FixturePool(fixtures, {
    requiredUsers: TARGET_USERS,
    requiredTenants: TARGET_TENANTS,
  })
  return fixtures
})

export const options = {
  scenarios: {
    morning_login_sync_storm: {
      executor: "per-vu-iterations",
      vus: TARGET_USERS,
      iterations: 1,
      maxDuration: "15m",
      gracefulStop: "30s",
    },
  },
  thresholds: {
    http_req_failed: [{ threshold: "rate<0.01", abortOnFail: false }],
    mobile_sync_v2_bootstrap_latency: [{ threshold: "p(95)<500", abortOnFail: false }],
    mobile_sync_v2_routes_latency: [{ threshold: "p(95)<500", abortOnFail: false }],
    mobile_sync_v2_routes_failures: [{ threshold: "count==0", abortOnFail: false }],
  },
}

function retryAfterSeconds(response) {
  const raw = response.headers["Retry-After"] ?? response.headers["retry-after"]
  const value = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isFinite(value) ? Math.max(1, Math.min(60, Math.ceil(value))) : 1
}

function requestPage(url, headers) {
  let response
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    response = http.get(url, {
      headers,
      tags: { name: "mobile_sync_v2_routes" },
    })
    routeSyncLatency.add(response.timings.duration)
    if ((response.status !== 429 && response.status !== 503) || attempt === MAX_RETRIES) return response
    // Retry the identical opaque cursor after server guidance plus local
    // jitter. No new snapshot, mutation or second device identity is created.
    sleep(retryAfterSeconds(response) + Math.random())
  }
  return response
}

function parsePage(response) {
  try {
    const body = JSON.parse(response.body)
    if (!body || body.success !== true || body.protocolVersion !== 2 || body.stream !== "routes") return null
    if (!Array.isArray(body.items) || !Array.isArray(body.tombstones) || typeof body.complete !== "boolean") return null
    return body
  } catch {
    return null
  }
}

function verifyFixtureBootstrap({ base, headers, fixture }) {
  const response = http.get(`${base}/api/v1/mtm/mobile/bootstrap`, {
    headers,
    tags: { name: "mobile_sync_v2_bootstrap" },
  })
  bootstrapLatency.add(response.timings.duration)
  let body = null
  try {
    body = JSON.parse(response.body)
  } catch {
    // The check below reports a bounded scenario failure without logging an
    // untrusted bootstrap body, token or tenant identifier.
  }
  const bootstrapOk = check(response, {
    "routes v2 bootstrap: status 200": (result) => result.status === 200,
    "routes v2 bootstrap: fixture tenant and exact cohort": () => mobileSyncV2BootstrapMatchesFixture(body, fixture),
  })
  if (!bootstrapOk) routeSyncFailures.add(1)
  return bootstrapOk
}

function pullToCompletion({ base, headers, initialCursor }) {
  let cursor = initialCursor
  let committedCursor = null
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const query = cursor ? `?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}` : `?limit=${PAGE_SIZE}`
    const response = requestPage(`${base}/api/v2/mtm/mobile/sync/routes${query}`, headers)
    const page = parsePage(response)
    const pageOk = check(response, {
      "routes v2: status 200": (result) => result.status === 200,
      "routes v2: complete, valid envelope": () => page !== null,
    })
    if (!pageOk || !page) {
      routeSyncFailures.add(1)
      return null
    }
    routeSyncPages.add(1)
    if (page.complete) {
      if (typeof page.nextCursor !== "string" || page.nextCursor.length < 1) {
        routeSyncFailures.add(1)
        return null
      }
      committedCursor = page.nextCursor
      break
    }
    const continuation = typeof page.nextPage === "string" && page.nextPage.length > 0
      ? page.nextPage
      : typeof page.nextCursor === "string" && page.nextCursor.length > 0
        ? page.nextCursor
        : null
    if (!continuation) {
      routeSyncFailures.add(1)
      return null
    }
    cursor = continuation
  }
  if (!committedCursor) routeSyncFailures.add(1)
  return committedCursor
}

export default function mobileSyncV2RoutesScenario() {
  const fixture = fixturePool[(__VU - 1) % TARGET_USERS] // eslint-disable-line no-undef
  const headers = {
    Authorization: `Bearer ${fixture.accessToken}`,
    "x-field-device-id": fixture.deviceId,
    "x-field-device-platform": "android",
    "x-field-apk-version": fixture.apkVersion,
  }

  // Spreads the morning reconnect burst without collapsing it into a single
  // tenant/device identity. Full S6 covers the configured two-minute window.
  if (LOGIN_JITTER_SECONDS > 0) sleep(Math.random() * LOGIN_JITTER_SECONDS)

  // Fixture values are not authority. Bootstrap proves that this JWT/device
  // pair is actually in the declared tenant and routes v2 cohort before the
  // load result can count it toward the 100-tenant / 5,000-user assertion.
  if (!verifyFixtureBootstrap({ base: BASE_URL, headers, fixture })) return

  const cursor = pullToCompletion({ base: BASE_URL, headers, initialCursor: null })
  if (!cursor) return

  // A cursor obtained only after the full snapshot must work on an immediate
  // delta pull. This exercises opaque cursor binding without recording it.
  pullToCompletion({ base: BASE_URL, headers, initialCursor: cursor })
}
