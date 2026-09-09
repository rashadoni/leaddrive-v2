/**
 * Location update load scenario — k6
 *
 * Simulates field agents sending GPS location updates every ~30 seconds.
 * Endpoint: POST /api/v1/mtm/mobile/location
 *
 * Hot path: 351 agents × 1 update / 30 s = ~11.7 req/s sustained
 *
 * Response shape: { success: true }
 * SLO: P95 < 200 ms (upsert on indexed agentId)
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

const locationLatency = new Trend("location_update_latency", true)
const locationErrors = new Counter("location_update_errors")

export const options = {
  stages: RAMP_STAGES,
  thresholds: {
    ...SHARED_THRESHOLDS,
    location_update_latency: [
      { threshold: "p(95)<200", abortOnFail: false },
      { threshold: "p(99)<500", abortOnFail: false },
    ],
  },
}

/** Baku city center bounding box — ±5 km jitter */
function randomBakuCoords() {
  const lat = 40.3936 + (Math.random() - 0.5) * 0.09
  const lon = 49.8671 + (Math.random() - 0.5) * 0.09
  return { lat: parseFloat(lat.toFixed(6)), lon: parseFloat(lon.toFixed(6)) }
}

export default function locationScenario() {
  const url = `${baseUrl()}/api/v1/mtm/mobile/location`
  const headers = authHeaders()
  const { lat, lon } = randomBakuCoords()

  const payload = JSON.stringify({
    latitude: lat,
    longitude: lon,
    accuracy: Math.floor(Math.random() * 15) + 3,   // 3–18 m
    speed: Math.random() < 0.7 ? 0 : Math.random() * 50,
    heading: Math.random() * 360,
    battery: Math.floor(Math.random() * 60) + 40,
  })

  const res = http.post(url, payload, { headers })
  locationLatency.add(res.timings.duration)

  // POST /mobile/location returns { success: true } on success (no id field)
  const ok = check(res, {
    "location: status 200": (r) => r.status === 200,
    "location: success=true": (r) => {
      try { return JSON.parse(r.body)?.success === true } catch { return false }
    },
  })
  if (!ok) locationErrors.add(1)

  sleep(30 + Math.random() * 5)  // 30–35 s jitter
}
