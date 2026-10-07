import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { recordMtmMobileGpsTelemetry as gps } from "@/lib/mtm/mobile-gps-telemetry"
import { recordMtmMobileMediaTelemetry as media } from "@/lib/mtm/mobile-media-telemetry"
import { recordMtmMobileSyncPullTelemetry as pull, recordMtmMobileApkObservation as census, recordMtmMobileV1SyncActivity as activity } from "@/lib/mtm/mobile-sync-telemetry"
const privateValue = "PRIVATE_location_reason_employee_token"
const results = ["ok", "invalid_request", "forbidden", "conflict", "rate_limited", "unavailable", "failed"] as const
beforeEach(() => vi.stubEnv("NEXTAUTH_SECRET", "synthetic-aux-telemetry-fixture-only"))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe("actual GPS/media telemetry to a synthetic destination", () => {
  it.each(results)("retains the finite %s result while minimizing extra/private fields", result => {
    const sink = vi.spyOn(console, "info").mockImplementation(() => undefined)
    gps({ organizationId: privateValue, endpoint: "location_batch", apkVersion: "1.2.3+456", result, pointCount: 4, durationMs: 17.4, coordinates: privateValue, note: privateValue } as never)
    media({ organizationId: privateValue, endpoint: "photos", contractVersion: 2, apkVersion: "1.2.3+456", result, durationMs: 17.4, bytes: 1200, filename: privateValue, storageKey: privateValue } as never)
    expect(sink).toHaveBeenCalledTimes(2)
    for (const [, serialized] of sink.mock.calls) {
      expect(serialized).not.toContain(privateValue)
      expect(JSON.parse(String(serialized))).toMatchObject({ apkVersion: "1.2.3+456", result, durationMs: 17, tenant: expect.stringMatching(/^[a-f0-9]{16}$/) })
    }
    expect(JSON.parse(String(sink.mock.calls[1][1]))).toMatchObject({ endpoint: "photos", contractVersion: 2, byteBucket: "lt_64k" })
  })
  it("collapses500 invalid categorical tuples, including private-looking version strings", () => {
    const sink = vi.spyOn(console, "info").mockImplementation(() => undefined)
    for (let i = 0; i < 500; i++) {
      const bad = `${privateValue}${i}`
      gps({ organizationId: privateValue, endpoint: bad, apkVersion: bad, result: bad, pointCount: Number.NaN, durationMs: Infinity } as never)
      media({ organizationId: privateValue, endpoint: bad, apkVersion: bad, result: bad, contractVersion: i + 3, bytes: Number.NaN, durationMs: Infinity } as never)
    }
    expect(sink).toHaveBeenCalledTimes(1000)
    const tuples = new Set(sink.mock.calls.map(([, serialized]) => {
      expect(serialized).not.toContain(privateValue)
      const record = JSON.parse(String(serialized))
      delete record.tenant
      return JSON.stringify(record)
    }))
    expect(tuples.size).toBe(2)
    for (const tuple of tuples) expect(JSON.parse(tuple)).toMatchObject({ endpoint: "unknown", apkVersion: "unknown", result: "failed", durationMs: 0 })
  })
  it("bounds numeric inputs without promoting counts or durations to labels", () => {
    const sink = vi.spyOn(console, "info").mockImplementation(() => undefined)
    gps({ organizationId: privateValue, endpoint: "location_batch", apkVersion: null, result: "ok", pointCount: 10000, durationMs: 1e12 })
    media({ organizationId: privateValue, endpoint: "documents", contractVersion: 1, apkVersion: null, result: "ok", bytes: 1e12, durationMs: -4 })
    expect(JSON.parse(String(sink.mock.calls[0][1]))).toMatchObject({ pointCount: 50, durationMs: 300000 })
    expect(JSON.parse(String(sink.mock.calls[1][1]))).toMatchObject({ byteBucket: "gte_10m", durationMs: 0 })
  })
  it("contains destination failures for both emitters", () => {
    vi.spyOn(console, "info").mockImplementation(() => { throw new Error("SYNTHETIC-SINK-UNAVAILABLE") })
    expect(() => gps({ organizationId: privateValue, endpoint: "location_batch", apkVersion: null, result: "failed", pointCount: 0, durationMs: 0 })).not.toThrow()
    expect(() => media({ organizationId: privateValue, endpoint: "photos", contractVersion: 2, apkVersion: null, result: "failed", bytes: null, durationMs: 0 })).not.toThrow()
  })
  it.each(["coercible", "toJSON", "symbol"])("never serializes or coerces a %s object as a version/build label", kind => {
    const sink = vi.spyOn(console, "info").mockImplementation(() => undefined)
    const toString = vi.fn(() => "1.2.3")
    const toJSON = vi.fn(() => privateValue)
    const value: unknown = kind === "symbol" ? Symbol(privateValue) : kind === "toJSON" ? { toJSON } : { toString, privateReason: privateValue }
    const common = { organizationId: privateValue, apkVersion: value }
    gps({ ...common, endpoint: "location_batch", result: "failed", pointCount: 1, durationMs: 1 } as never)
    media({ ...common, endpoint: "photos", contractVersion: 2, result: "failed", bytes: 1, durationMs: 1 } as never)
    pull({ ...common, stream: "workforce", endpoint: "GET /api/v2/mtm/mobile/sync/workforce", contractVersion: 2, result: "unavailable", durationMs: 1, response: {} } as never)
    activity({ ...common, agentId: "synthetic-agent", endpoint: "POST /api/v1/mtm/mobile/sync/push", diagnostics: { buildSha: { toString: () => "a".repeat(40), toJSON }, platform: "android", deviceClass: "phone" } } as never)
    expect(sink).toHaveBeenCalledTimes(4)
    for (const [, serialized] of sink.mock.calls) {
      expect(serialized).not.toContain(privateValue)
      expect(JSON.parse(String(serialized))).toMatchObject({ apkVersion: "unknown" })
    }
    expect(JSON.parse(String(sink.mock.calls[3][1]))).toMatchObject({ diagnostics: { buildSha: "unknown" } })
    expect(toString).not.toHaveBeenCalled()
    expect(toJSON).not.toHaveBeenCalled()
  })
  it("normalizes invalid census/v1 categorical fields without echoing objects", () => {
    const sink = vi.spyOn(console, "info").mockImplementation(() => undefined)
    const bad = { privateValue }
    census({ organizationId: privateValue, agentId: "synthetic-agent", apkVersion: "1.2.3", protocolPreferred: bad,
      cohorts: { routes: bad, visits: bad, tasks: bad, workforce: bad, gps: bad, media: bad } } as never)
    activity({ organizationId: privateValue, agentId: "synthetic-agent", apkVersion: "1.2.3", endpoint: bad } as never)
    expect(sink).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(sink.mock.calls[0][1]))).toMatchObject({ protocolPreferred: 0, cohorts: { routes: "unknown", visits: "unknown", tasks: "unknown", workforce: "unknown", gps: "unknown", media: "unknown" } })
    expect(JSON.parse(String(sink.mock.calls[1][1]))).toMatchObject({ endpoint: "unknown" })
    expect(JSON.stringify(sink.mock.calls)).not.toContain(privateValue)
  })
})
