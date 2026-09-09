/**
 * Visit check-in load scenario — k6
 *
 * Simulates field agents checking in at customer locations.
 * Endpoint: POST /api/v1/mtm/visits
 *
 * Response shape: { success: true, data: visit }
 * SLO: P95 < 300 ms (single INSERT + potential geofence validation)
 *
 * IMPORTANT — SETUP REQUIRED:
 *   The `customerId` field must be a real cuid from the DB.
 *   Use k6's setup() to pre-fetch customer IDs, or pre-populate
 *   CUSTOMER_CUID_LIST env var with comma-separated real IDs from:
 *     psql -h localhost leaddrive -c "SELECT id FROM mtm_customers LIMIT 25;"
 *   Without real IDs, the server returns 400 (cuid validation fails).
 *
 *   For smoke tests, set CUSTOMER_CUID_LIST to a single known cuid:
 *   --env CUSTOMER_CUID_LIST=clxxxxxxxxxxxxxxxxxxxxxx
 */

import http from "k6/http"
import { sleep, check } from "k6"
import { Trend, Counter } from "k6/metrics"
import {
  RAMP_STAGES,
  SHARED_THRESHOLDS,
  authHeaders,
  baseUrl,
} from "../config.js"

const visitLatency = new Trend("visit_checkin_latency", true)
const visitErrors = new Counter("visit_checkin_errors")

export const options = {
  stages: RAMP_STAGES,
  thresholds: {
    ...SHARED_THRESHOLDS,
    visit_checkin_latency: [
      { threshold: "p(95)<300", abortOnFail: false },
      { threshold: "p(99)<1000", abortOnFail: false },
    ],
  },
}

/**
 * Customer ID pool — MUST be real cuid values from the mars tenant DB.
 * Set CUSTOMER_CUID_LIST=id1,id2,... or falls back to empty (all 400s).
 */
function randomCustomerId() {
  const list = (__ENV.CUSTOMER_CUID_LIST ?? "").split(",").filter(Boolean)  // eslint-disable-line no-undef
  if (list.length === 0) {
    // Fallback warning: will cause 400 (cuid validation) — set env var for real test
    console.warn("CUSTOMER_CUID_LIST not set — visit check-ins will fail schema validation")
    return "placeholder-set-CUSTOMER_CUID_LIST"
  }
  return list[Math.floor(Math.random() * list.length)]
}

function randomBakuCoords() {
  return {
    lat: parseFloat((40.3936 + (Math.random() - 0.5) * 0.09).toFixed(6)),
    lon: parseFloat((49.8671 + (Math.random() - 0.5) * 0.09).toFixed(6)),
  }
}

export default function visitCheckinScenario() {
  const url = `${baseUrl()}/api/v1/mtm/visits`
  const headers = authHeaders()
  const { lat, lon } = randomBakuCoords()

  const payload = JSON.stringify({
    customerId: randomCustomerId(),
    latitude: lat,
    longitude: lon,
    // Force check-in field: schema uses `force` (not `forceCheckIn`)
    force: Math.random() < 0.05,  // 5% forced (supervisor-confirmed; requires SUPERVISOR role)
  })

  const res = http.post(url, payload, { headers })
  visitLatency.add(res.timings.duration)

  const ok = check(res, {
    // 200 OK = successful check-in; 422 = geofence violation (acceptable under test)
    "visit: status 200 or 422": (r) => r.status === 200 || r.status === 422,
    // 5xx = server error = failure
    "visit: no 5xx": (r) => r.status < 500,
    "visit: success response has data": (r) => {
      if (r.status !== 200) return true  // non-200 not checked for body shape
      try { return JSON.parse(r.body)?.data?.id !== undefined } catch { return false }
    },
  })
  if (!ok) visitErrors.add(1)

  sleep(45 + Math.random() * 15)  // 45–60 s between check-ins
}
