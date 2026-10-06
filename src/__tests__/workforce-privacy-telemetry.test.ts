import { afterEach, describe, expect, it, vi } from "vitest"
import { recordMtmMobileSyncPullTelemetry } from "@/lib/mtm/mobile-sync-telemetry"

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })
const results = ["ok", "forbidden", "cohort_disabled", "invalid_request", "invalid_cursor", "resnapshot_required", "payload_too_large", "rate_limited", "unavailable"] as const
const privateInput = "SYNTHETIC_PRIVATE tenant employee latitude longitude absence reason token"
const base = {
  organizationId: privateInput, stream: "workforce", endpoint: "GET /api/v2/mtm/mobile/sync/workforce",
  contractVersion: 2, apkVersion: "1.2.3+4", durationMs: 23.5,
  response: { items: [{ employee: privateInput, location: privateInput, reason: privateInput }], tombstones: [privateInput], cursor: privateInput },
}

describe("Workforce pull telemetry through actual serializer into a synthetic console destination", () => {
  it.each(results)("minimizes private payload for %s", result => {
    vi.stubEnv("MOBILE_SYNC_TELEMETRY_SUCCESS_SAMPLE_RATE", "1")
    const sink = vi.spyOn(console, "info").mockImplementation(() => undefined)
    recordMtmMobileSyncPullTelemetry({ ...base, result })
    expect(sink).toHaveBeenCalledTimes(1)
    const [prefix, serialized] = sink.mock.calls[0]
    expect(prefix).toBe("[mtm-mobile-sync-telemetry]")
    expect(serialized).not.toContain(privateInput)
    const received = JSON.parse(String(serialized))
    expect(Object.keys(received).sort()).toEqual(["event", "tenant", "stream", "endpoint", "contractVersion", "apkVersion", "result", "rowCount", "payloadBytes", "durationMs", "successSampleRate"].sort())
    expect(received).toMatchObject({ stream: "workforce", result, rowCount: 2, durationMs: 24, contractVersion: 2 })
    expect(received.tenant).toMatch(/^[a-f0-9]{16}$/)
    expect(received.payloadBytes).toBe(Buffer.byteLength(JSON.stringify(base.response), "utf8"))
  })
  it("collapses500 adversarial categorical label tuples before serialization", () => {
    const sink = vi.spyOn(console, "info").mockImplementation(() => undefined)
    for (let index = 0; index < 500; index++) recordMtmMobileSyncPullTelemetry({
      ...base, stream: `${privateInput}${index}`, endpoint: `${privateInput}${index}`,
      contractVersion: index + 3, result: `${privateInput}${index}` as never,
      apkVersion: `${privateInput}${index}`, durationMs: Number.NaN,
    })
    expect(sink).toHaveBeenCalledTimes(500)
    const tuples = new Set(sink.mock.calls.map(([, value]) => {
      expect(value).not.toContain(privateInput)
      const event = JSON.parse(String(value))
      return JSON.stringify([event.stream, event.endpoint, event.contractVersion, event.result, event.apkVersion, event.durationMs])
    }))
    expect([...tuples]).toEqual([JSON.stringify(["unknown", "unknown", 0, "unavailable", "unknown", 0])])
  })
  it("contains a synthetic destination failure without changing caller control flow", () => {
    vi.spyOn(console, "info").mockImplementation(() => { throw new Error("synthetic sink unavailable") })
    expect(() => recordMtmMobileSyncPullTelemetry({ ...base, result: "unavailable" })).not.toThrow()
  })
})
