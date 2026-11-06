import { describe, expect, it } from "vitest"
import {
  normalizeVitalsRoute,
  parseWebVitalsBeacon,
  webVitalsLogLine,
} from "@/lib/telemetry/web-vitals"
import {
  attachSlowQueryLog,
  slowQueryClientOptions,
  slowQueryLine,
  slowQueryThresholdMs,
} from "@/lib/telemetry/slow-db-query"

describe("web vitals beacon", () => {
  it("keeps the page, drops record ids, secret links and the query string", () => {
    expect(normalizeVitalsRoute("/deals/cmh1z2x3y4w5v6u7t8s9r0q1p?tab=notes")).toBe("/deals/:id")
    expect(normalizeVitalsRoute("/tickets/123/edit")).toBe("/tickets/:id/edit")
    expect(normalizeVitalsRoute("/contacts/0b9a7c1e-4f2d-4a8b-9c3e-1d2f3a4b5c6d")).toBe("/contacts/:id")
    expect(normalizeVitalsRoute("/share/location/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-")).toBe("/share/location/[redacted]")
    expect(normalizeVitalsRoute("/mtm/routes/plan")).toBe("/mtm/routes/plan")
    expect(normalizeVitalsRoute("https://evil.example/x")).toBe("/")
    expect(normalizeVitalsRoute(42)).toBe("/")
  })

  it("accepts only known metrics with sane values", () => {
    const beacon = parseWebVitalsBeacon(JSON.stringify({
      route: "/deals/123",
      metrics: { LCP: 1830.4, INP: 96.2, CLS: 0.01234, TTFB: -5, FID: 10, evil: "x", FCP: 9e9 },
      conn: "4g",
      mem: 4,
      cpu: 8,
    }))
    expect(beacon).toEqual({ route: "/deals/:id", metrics: { LCP: 1830, INP: 96, CLS: 0.012 }, conn: "4g", mem: 4, cpu: 8 })
    expect(JSON.parse(webVitalsLogLine(beacon!))).toEqual({
      evt: "web_vital", route: "/deals/:id", LCP: 1830, INP: 96, CLS: 0.012, conn: "4g", mem: 4, cpu: 8,
    })
  })

  it("rejects what is not a beacon", () => {
    expect(parseWebVitalsBeacon("")).toBeNull()
    expect(parseWebVitalsBeacon("not json")).toBeNull()
    expect(parseWebVitalsBeacon("[]")).toBeNull()
    expect(parseWebVitalsBeacon(JSON.stringify({ route: "/x", metrics: {} }))).toBeNull()
    expect(parseWebVitalsBeacon(JSON.stringify({ route: "/x", metrics: { LCP: 1 }, pad: "a".repeat(5000) }))).toBeNull()
    const odd = parseWebVitalsBeacon(JSON.stringify({ route: "/x", metrics: { LCP: 1 }, conn: "<script>", mem: 1e6, cpu: 1.5 }))
    expect(odd).toEqual({ route: "/x", metrics: { LCP: 1 } })
  })
})

describe("slow database statements", () => {
  it("is on by default in production, tunable, and off in tests", () => {
    expect(slowQueryThresholdMs({ NODE_ENV: "production" })).toBe(500)
    expect(slowQueryThresholdMs({ NODE_ENV: "production", DB_SLOW_QUERY_MS: "250" })).toBe(250)
    expect(slowQueryThresholdMs({ NODE_ENV: "production", DB_SLOW_QUERY_MS: "0" })).toBe(0)
    expect(slowQueryThresholdMs({ NODE_ENV: "production", DB_SLOW_QUERY_MS: "nope" })).toBe(0)
    expect(slowQueryThresholdMs({ NODE_ENV: "test" })).toBe(0)
    expect(slowQueryClientOptions(0)).toBeUndefined()
    expect(slowQueryClientOptions(500)).toEqual({ log: [{ emit: "event", level: "query" }] })
  })

  it("writes only statements at or over the threshold, without parameter values", () => {
    expect(slowQueryLine({ duration: 120, query: "SELECT 1" }, 500)).toBeNull()
    const line = slowQueryLine({ duration: 812, query: 'SELECT "id"\n  FROM "deals" WHERE "organizationId" = $1', target: "quaint" }, 500)
    expect(JSON.parse(line!)).toEqual({ evt: "slow_query", ms: 812, target: "quaint", sql: 'SELECT "id" FROM "deals" WHERE "organizationId" = $1' })
    const long = JSON.parse(slowQueryLine({ duration: 900, query: "x".repeat(2000) }, 500)!)
    expect(long.sql.length).toBe(601)
  })

  it("subscribes to the client's query events and never throws into the query path", () => {
    const listeners: Array<(e: unknown) => void> = []
    const client = { $on: (_: string, cb: (e: unknown) => void) => listeners.push(cb) }
    attachSlowQueryLog(client, 500)
    expect(listeners).toHaveLength(1)
    expect(() => listeners[0]({ duration: 10n ** 30n, query: { toString() { throw new Error("boom") } } })).not.toThrow()
    attachSlowQueryLog({}, 500)
    attachSlowQueryLog(client, 0)
    expect(listeners).toHaveLength(1)
  })
})
