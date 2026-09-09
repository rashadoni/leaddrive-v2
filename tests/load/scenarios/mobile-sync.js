/**
 * Mobile sync + ping load scenario — k6
 *
 * Simulates initial data sync and periodic heartbeat.
 * Endpoints:
 *   GET /api/v1/mtm/mobile/sync/pull → { success, timestamp, changes: { customers: { updated, deleted } } }
 *   GET /api/v1/mtm/mobile/ping       → { success: true, data: {} }
 *   GET /api/v1/mtm/mobile/profile    → { success: true, data: { agent: { id, ... }, todaySummary } }
 *
 * SLO:
 *   - Ping P95 < 50 ms
 *   - Sync pull P95 < 1 000 ms
 *   - Profile P95 < 200 ms
 */

import http from "k6/http"
import { sleep, check, group } from "k6"
import { Trend, Counter } from "k6/metrics"
import {
  RAMP_STAGES,
  SHARED_THRESHOLDS,
  authHeaders,
  baseUrl,
} from "../config.js"

const pingLatency = new Trend("mobile_ping_latency", true)
const syncLatency = new Trend("mobile_sync_latency", true)
const profileLatency = new Trend("mobile_profile_latency", true)
const syncErrors = new Counter("mobile_sync_errors")

export const options = {
  stages: RAMP_STAGES,
  thresholds: {
    ...SHARED_THRESHOLDS,
    mobile_ping_latency: [
      { threshold: "p(95)<50", abortOnFail: false },
      { threshold: "p(99)<100", abortOnFail: false },
    ],
    mobile_sync_latency: [
      { threshold: "p(95)<1000", abortOnFail: false },
      { threshold: "p(99)<3000", abortOnFail: false },
    ],
    mobile_profile_latency: [
      { threshold: "p(95)<200", abortOnFail: false },
    ],
  },
}

export default function mobileSyncScenario() {
  const headers = authHeaders()
  const base = baseUrl()

  // ── Session start: profile + sync pull ───────────────────────────────────
  group("session_start", () => {
    // 1. Fetch agent profile
    // Response: { success: true, data: { agent: { id, name, ... }, todaySummary } }
    const profileRes = http.get(`${base}/api/v1/mtm/mobile/profile`, { headers })
    profileLatency.add(profileRes.timings.duration)
    const profileOk = check(profileRes, {
      "profile: status 200": (r) => r.status === 200,
      "profile: data.agent.id present": (r) => {
        try { return typeof JSON.parse(r.body)?.data?.agent?.id === "string" } catch { return false }
      },
    })
    if (!profileOk) syncErrors.add(1)

    sleep(0.5)

    // 2. Full data sync
    // Response: { success: true, timestamp, changes: { customers: { updated, deleted }, ... } }
    const syncRes = http.get(`${base}/api/v1/mtm/mobile/sync/pull`, { headers })
    syncLatency.add(syncRes.timings.duration)
    const syncOk = check(syncRes, {
      "sync: status 200": (r) => r.status === 200,
      "sync: changes object present": (r) => {
        try { return JSON.parse(r.body)?.changes !== undefined } catch { return false }
      },
    })
    if (!syncOk) syncErrors.add(1)
  })

  sleep(2 + Math.random() * 2)

  // ── Periodic ping ────────────────────────────────────────────────────────
  // Response: { success: true, data: {} } — keeps the legacy container but
  // exposes no metadata and makes no DB call.
  group("heartbeat", () => {
    const pingRes = http.get(`${base}/api/v1/mtm/mobile/ping`, { headers })
    pingLatency.add(pingRes.timings.duration)
    check(pingRes, {
      "ping: status 200": (r) => r.status === 200,
      "ping: success=true": (r) => {
        try { return JSON.parse(r.body)?.success === true } catch { return false }
      },
    })
  })

  sleep(180 + Math.random() * 120)  // sync ~2× per shift, compressed to 3–5 min
}
