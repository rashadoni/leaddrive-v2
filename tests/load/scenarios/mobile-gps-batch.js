/**
 * Bounded staging smoke for the server-first GPS batch cohort.
 *
 * This is intentionally one device / one active workday, not the 5,000-user
 * S6 run. A realistic scale run needs a provisioned pool of isolated staging
 * tenants, agents, tokens, devices and exact GPS cohort rows; reusing one
 * device would only exercise its protective 429 limit.
 */

import http from "k6/http"
import { check, sleep } from "k6"
import { Counter, Trend } from "k6/metrics"
import { authHeaders, baseUrl } from "../config.js"

const gpsBatchLatency = new Trend("mobile_gps_batch_latency", true)
const gpsBatchErrors = new Counter("mobile_gps_batch_errors")

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

const ITERATIONS = boundedInteger(__ENV.GPS_BATCH_SMOKE_ITERATIONS, 3, 1, 6) // eslint-disable-line no-undef
const POINTS_PER_BATCH = boundedInteger(__ENV.GPS_BATCH_POINTS, 20, 1, 50) // eslint-disable-line no-undef

export const options = {
  vus: 1,
  iterations: ITERATIONS,
  thresholds: {
    http_req_failed: [{ threshold: "rate<0.01", abortOnFail: false }],
    mobile_gps_batch_latency: [{ threshold: "p(95)<500", abortOnFail: false }],
  },
}

function requiredEnv(name) {
  const value = __ENV[name] // eslint-disable-line no-undef
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required`)
  return value
}

function buildBatch(workdayId) {
  const capturedAt = new Date().toISOString()
  const uniquePrefix = `gps-s6-${__VU}-${__ITER}-${Date.now()}` // eslint-disable-line no-undef
  return {
    workdayId,
    points: Array.from({ length: POINTS_PER_BATCH }, (_, index) => ({
      clientLocationId: `${uniquePrefix}-${index}`,
      latitude: Number((40.4000 + index * 0.00001).toFixed(6)),
      longitude: Number((49.8000 + index * 0.00001).toFixed(6)),
      accuracy: 8,
      speed: index % 2 === 0 ? 2 : 0,
      heading: null,
      altitude: null,
      battery: 80,
      recordedAt: capturedAt,
    })),
  }
}

function responseCoversBatch(response, expectedCount, requireReplay) {
  try {
    const data = JSON.parse(response.body)?.data
    const applied = Array.isArray(data?.appliedClientLocationIds) ? data.appliedClientLocationIds : []
    const replayed = Array.isArray(data?.replayedClientLocationIds) ? data.replayedClientLocationIds : []
    return applied.length + replayed.length === expectedCount && (!requireReplay || replayed.length === expectedCount)
  } catch {
    return false
  }
}

export default function mobileGpsBatchScenario() {
  const deviceId = requiredEnv("FIELD_DEVICE_ID")
  const workdayId = requiredEnv("MOBILE_GPS_WORKDAY_ID")
  const headers = {
    ...authHeaders(),
    "x-field-device-id": deviceId,
    "x-field-device-platform": "android",
  }
  const payload = JSON.stringify(buildBatch(workdayId))
  const url = `${baseUrl()}/api/v2/mtm/mobile/location/batch`

  const first = http.post(url, payload, { headers })
  gpsBatchLatency.add(first.timings.duration)
  const firstOk = check(first, {
    "gps batch: created": (response) => response.status === 201,
    "gps batch: complete acknowledgement": (response) => responseCoversBatch(response, POINTS_PER_BATCH, false),
  })
  if (!firstOk) gpsBatchErrors.add(1)

  // Explicit exact replay validates the server idempotency path without
  // generating a second authoritative point. Keep the default off so the
  // bounded smoke remains below the device's 6 batches/minute guard.
  if (__ENV.GPS_BATCH_REPLAY === "1") { // eslint-disable-line no-undef
    const replay = http.post(url, payload, { headers })
    gpsBatchLatency.add(replay.timings.duration)
    const replayOk = check(replay, {
      "gps batch replay: status 200": (response) => response.status === 200,
      "gps batch replay: every point replayed": (response) => responseCoversBatch(response, POINTS_PER_BATCH, true),
    })
    if (!replayOk) gpsBatchErrors.add(1)
  }

  sleep(12)
}
