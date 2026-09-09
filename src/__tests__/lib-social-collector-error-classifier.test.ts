import { describe, expect, it } from "vitest"
import {
  classifyCollectorError,
  computeCircuitCooldownSeconds,
  deterministicJitterFraction,
} from "@/lib/social/collector-error-classifier"

describe("classifyCollectorError — text patterns", () => {
  it("classifies auth/token failures as AUTH and quarantines", () => {
    for (const raw of ["unauthorized", "invalid_token", "token expired", "403 forbidden", "OAuth reconnect required"]) {
      const c = classifyCollectorError(raw)
      expect(c.class, raw).toBe("AUTH")
      expect(c.quarantine).toBe(true)
      expect(c.retryable).toBe(false)
    }
  })

  it("classifies rate/quota errors as RATE_LIMIT and keeps them retryable", () => {
    for (const raw of ["rate limit exceeded", "429 Too Many Requests", "quota exceeded", "throttled"]) {
      const c = classifyCollectorError(raw)
      expect(c.class, raw).toBe("RATE_LIMIT")
      expect(c.retryable).toBe(true)
      expect(c.quarantine).toBe(false)
    }
  })

  it("classifies budget exhaustion as BUDGET (blocking, not quarantine)", () => {
    for (const raw of ["tenant budget exhausted", "maxTotalCharge exceeded", "insufficient_funds", "apify_start_402", "payment required"]) {
      const c = classifyCollectorError(raw)
      expect(c.class, raw).toBe("BUDGET")
      expect(c.retryable).toBe(false)
      expect(c.quarantine).toBe(false)
    }
  })

  it("classifies capability/policy denials as POLICY and quarantines", () => {
    for (const raw of ["capability_proof_invalid", "capability_proof_missing", "blocked by policy", "route_has_no_adapter", "research_only"]) {
      const c = classifyCollectorError(raw)
      expect(c.class, raw).toBe("POLICY")
      expect(c.quarantine).toBe(true)
    }
  })

  it("classifies schema/not-found/malformed as PERMANENT and quarantines with a long cooldown", () => {
    for (const raw of ["SCHEMA_DRIFT", "404 not found", "malformed response", "resource gone (410)"]) {
      const c = classifyCollectorError(raw)
      expect(c.class, raw).toBe("PERMANENT")
      expect(c.quarantine).toBe(true)
      expect(c.cooldownSeconds).toBeGreaterThanOrEqual(3600)
    }
  })

  it("classifies network/5xx/timeout as TRANSIENT", () => {
    for (const raw of ["ETIMEDOUT", "socket hang up", "fetch failed", "provider_outage", "apify_provider_blocked", "502 bad gateway", "service unavailable"]) {
      const c = classifyCollectorError(raw)
      expect(c.class, raw).toBe("TRANSIENT")
      expect(c.retryable).toBe(true)
    }
  })

  it("keeps Bright Data dead_page/proxy retryable — dead_page is a proven false negative on live FB pages (2026-07-21), quarantine would silently stop monitoring them", () => {
    for (const raw of ["bright_data_provider_dead_page", "bright_data_provider_proxy"]) {
      const c = classifyCollectorError(raw)
      expect(c.class, raw).toBe("TRANSIENT")
      expect(c.quarantine, raw).toBe(false)
      expect(c.retryable, raw).toBe(true)
    }
  })

  it("falls back to UNKNOWN (retryable, inspectable) for unrecognized text", () => {
    const c = classifyCollectorError("something weird happened")
    expect(c.class).toBe("UNKNOWN")
    expect(c.retryable).toBe(true)
    expect(c.operatorAction).toMatch(/логи/)
  })

  it("carries a bounded reasonCode and never throws on empty input", () => {
    expect(classifyCollectorError(null).class).toBe("UNKNOWN")
    expect(classifyCollectorError(undefined).reasonCode).toBe("unknown")
    const long = "x".repeat(500)
    expect(classifyCollectorError(long).reasonCode.length).toBeLessThanOrEqual(120)
  })
})

describe("classifyCollectorError — HTTP status precedence", () => {
  it("maps status codes to classes even without matching text", () => {
    expect(classifyCollectorError("", { httpStatus: 401 }).class).toBe("AUTH")
    expect(classifyCollectorError("", { httpStatus: 402 }).class).toBe("BUDGET")
    expect(classifyCollectorError("", { httpStatus: 429 }).class).toBe("RATE_LIMIT")
    expect(classifyCollectorError("", { httpStatus: 404 }).class).toBe("PERMANENT")
    expect(classifyCollectorError("", { httpStatus: 503 }).class).toBe("TRANSIENT")
    expect(classifyCollectorError("", { httpStatus: 400 }).class).toBe("POLICY")
  })
})

describe("circuit backoff + jitter", () => {
  it("produces a stable jitter fraction per seed within [0,1)", () => {
    const a = deterministicJitterFraction("route-1")
    expect(a).toBe(deterministicJitterFraction("route-1"))
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(1)
    expect(deterministicJitterFraction("route-2")).not.toBe(a)
  })

  it("grows the cooldown exponentially with attempts and stays within the jitter band", () => {
    const base = 900
    const a1 = computeCircuitCooldownSeconds(base, 1, 0.5)
    const a2 = computeCircuitCooldownSeconds(base, 2, 0.5)
    expect(a2).toBeGreaterThan(a1)
    // jitter band is [0.75, 1.25) of the grown value
    expect(computeCircuitCooldownSeconds(base, 1, 0)).toBe(Math.round(base * 0.75))
    expect(computeCircuitCooldownSeconds(base, 1, 0.998)).toBeLessThan(Math.round(base * 1.25) + 1)
  })

  it("caps the cooldown at six hours", () => {
    expect(computeCircuitCooldownSeconds(900, 20, 0.999)).toBeLessThanOrEqual(Math.round(21600 * 1.25))
    expect(computeCircuitCooldownSeconds(900, 20, 0)).toBe(Math.round(21600 * 0.75))
  })
})
