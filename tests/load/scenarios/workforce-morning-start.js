/**
 * Workforce H6 morning-start load scenario — k6.
 *
 * This is intentionally fenced to localhost or an explicitly confirmed HTTPS
 * staging host by `baseUrl()`. Never run it against production. The token pool
 * belongs in an operator-controlled 0600 file, never in this repository, a
 * command line, test output or CI log.
 *
 * Full H6 acceptance: 5,000 distinct, staging-only employee tokens with a
 * randomized start jitter. Run a smaller count only as a preflight, then run
 * the exact 5,000-user profile before claiming the scale gate.
 */

import http from "k6/http"
import { check, sleep } from "k6"
import { Counter, Rate, Trend } from "k6/metrics"
import { baseUrl } from "../config.js"

function positiveInteger(name, fallback, maximum) {
  const raw = __ENV[name] // eslint-disable-line no-undef
  if (raw == null || raw === "") return fallback
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} must be an integer`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum}`)
  }
  return value
}

const TARGET_USERS = positiveInteger("WORKFORCE_LOAD_USERS", 5000, 5000)
const JITTER_SECONDS = positiveInteger("WORKFORCE_LOAD_JITTER_SECONDS", 300, 600)
const startLatency = new Trend("workforce_morning_start_latency", true)
const startFailures = new Rate("workforce_morning_start_failure_rate")
const startConflicts = new Counter("workforce_morning_start_conflicts")

function jwtAgentId(token) {
  const parts = token.split(".")
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null
  try {
    const encodedPayload = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=")
    const claims = JSON.parse(atob(encodedPayload)) // eslint-disable-line no-undef
    return typeof claims?.agentId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(claims.agentId)
      ? claims.agentId
      : null
  } catch {
    return null
  }
}

function readTokenPool() {
  const path = __ENV.WORKFORCE_LOAD_TOKEN_FILE // eslint-disable-line no-undef
  if (!path) throw new Error("WORKFORCE_LOAD_TOKEN_FILE is required")
  let parsed
  try {
    parsed = JSON.parse(open(path)) // eslint-disable-line no-undef
  } catch {
    throw new Error("WORKFORCE_LOAD_TOKEN_FILE must contain valid JSON")
  }
  if (!Array.isArray(parsed) || parsed.length < TARGET_USERS) {
    throw new Error("WORKFORCE_LOAD_TOKEN_FILE must contain one distinct staging token per target user")
  }
  const pool = parsed.slice(0, TARGET_USERS)
  const seenTokens = new Set()
  const seenAgentIds = new Set()
  const seenClientIds = new Set()
  for (const credential of pool) {
    if (!credential || typeof credential !== "object" || Array.isArray(credential)) {
      throw new Error("WORKFORCE_LOAD_TOKEN_FILE contains an invalid credential")
    }
    const token = credential.token
    const agentId = credential.agentId
    const clientId = credential.clientId
    if (
      typeof token !== "string" || token.length < 20 || token.length > 8192 || /[\r\n]/.test(token) ||
      typeof agentId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(agentId) ||
      typeof clientId !== "string" || !/^[A-Za-z0-9._:-]{1,100}$/.test(clientId) ||
      seenTokens.has(token) || seenAgentIds.has(agentId) || seenClientIds.has(clientId) ||
      jwtAgentId(token) !== agentId
    ) {
      throw new Error("WORKFORCE_LOAD_TOKEN_FILE contains an invalid or duplicate staging credential")
    }
    seenTokens.add(token)
    seenAgentIds.add(agentId)
    seenClientIds.add(clientId)
  }
  return pool
}

// `open()` runs in k6 init context, before any request. Nothing from this
// pool is ever logged or emitted as a metric tag.
const tokenPool = readTokenPool()

export const options = {
  scenarios: {
    morning_start: {
      executor: "per-vu-iterations",
      vus: TARGET_USERS,
      iterations: 1,
      maxDuration: `${JITTER_SECONDS + 120}s`,
      gracefulStop: "30s",
    },
  },
  thresholds: {
    http_req_failed: [{ threshold: "rate<0.01", abortOnFail: false }],
    workforce_morning_start_failure_rate: [{ threshold: "rate<0.01", abortOnFail: false }],
    workforce_morning_start_latency: [
      { threshold: "p(95)<10000", abortOnFail: false },
      { threshold: "p(99)<20000", abortOnFail: false },
    ],
    workforce_morning_start_conflicts: [{ threshold: "count==0", abortOnFail: false }],
  },
}

export function setup() {
  // `baseUrl()` rejects any remote target unless it is explicitly declared and
  // confirmed as staging. H5 trust is deliberately not part of this synthetic
  // scale test: per-device QR/Keystore proof has its own physical H6 matrix.
  if ((__ENV.WORKFORCE_LOAD_EXPECT_TRUST ?? "off") !== "off") { // eslint-disable-line no-undef
    throw new Error("The morning-start load tenant must keep QR/device trust off; test H5 proofs physically")
  }
  return {
    base: baseUrl(),
    runId: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000).toString(36)}`,
  }
}

export default function workforceMorningStart(data) {
  const credential = tokenPool[__VU - 1] // eslint-disable-line no-undef
  if (!credential) throw new Error("No credential allocated for this virtual user")

  // Spread the morning wave without a synchronized burst. Each virtual user
  // sends exactly one START for its own staging-only principal.
  sleep(Math.random() * JITTER_SECONDS)
  const occurredAt = new Date().toISOString()
  const operationId = `workforce-h6-start-${data.runId}-${__VU}` // eslint-disable-line no-undef
  const workdayId = `workforce-h6-workday-${data.runId}-${__VU}` // eslint-disable-line no-undef
  const response = http.post(
    `${data.base}/api/v1/mtm/mobile/sync/push`,
    JSON.stringify({
      clientId: credential.clientId,
      operations: [{
        operationId,
        op: "create",
        entity: "workdays",
        clientTimestamp: Date.now(),
        data: {
          id: workdayId,
          action: "START",
          occurredAt,
          latitude: null,
          longitude: null,
          accuracy: null,
          note: null,
        },
      }],
    }),
    {
      headers: {
        Authorization: `Bearer ${credential.token}`,
        "Content-Type": "application/json",
      },
      tags: { workload: "workforce_morning_start" },
    },
  )
  startLatency.add(response.timings.duration)
  const result = check(response, {
    "workforce start: HTTP 200": (item) => item.status === 200,
    "workforce start: operation applied": (item) => {
      try {
        return JSON.parse(item.body)?.results?.[0]?.status === "ok"
      } catch {
        return false
      }
    },
  })
  if (!result) {
    startFailures.add(1)
    try {
      if (JSON.parse(response.body)?.results?.[0]?.status === "conflict") startConflicts.add(1)
    } catch {
      // Response bodies must not be logged: they can contain tenant diagnostics.
    }
  } else {
    startFailures.add(0)
  }
}
