import { describe, expect, it } from "vitest"
import { summarizeWorkforceSyncTelemetry } from "../../scripts/workforce-sync-diagnostics.mjs"

const TENANT = "0123456789abcdef"

function event(overrides: Record<string, unknown> = {}) {
  return `[mtm-mobile-sync-telemetry] ${JSON.stringify({
    event: "mobile_sync_pull",
    tenant: TENANT,
    stream: "workforce",
    endpoint: "GET /api/v2/mtm/mobile/sync/workforce",
    contractVersion: 2,
    apkVersion: "2.4.0+101",
    result: "ok",
    rowCount: 1,
    payloadBytes: 320,
    durationMs: 20,
    successSampleRate: 1,
    ...overrides,
  })}`
}

describe("Workforce sync support diagnostics", () => {
  it("aggregates only allowlisted pseudonymous telemetry", () => {
    const report = summarizeWorkforceSyncTelemetry([
      event(),
      event({ result: "unavailable", durationMs: 80, rowCount: 0, payloadBytes: 90 }),
      event({ tenant: "fedcba9876543210" }),
      "unrelated log with employee-private-id and token-private-value",
    ], TENANT)

    expect(report).toMatchObject({
      schemaVersion: 1,
      inspectedLines: 4,
      acceptedEvents: 2,
      discardedLines: 2,
      truncated: false,
      byStream: {
        workforce: {
          events: 2,
          rows: 1,
          payloadBytes: 410,
          latencyMs: { p50: 20, p95: 80, p99: 80 },
          results: { ok: 1, unavailable: 1 },
        },
      },
      apkVersions: { "2.4.0+101": 2 },
      otherApkEvents: 0,
    })
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain(TENANT)
    expect(serialized).not.toContain("employee-private-id")
    expect(serialized).not.toContain("token-private-value")
  })

  it("discards malformed or high-cardinality dimensions instead of echoing them", () => {
    const report = summarizeWorkforceSyncTelemetry([
      event({ stream: "workforce/employee-private-id" }),
      event({ endpoint: "GET /api/v2/mtm/mobile/sync/workforce?token=private" }),
      event({ durationMs: 300_001 }),
      event({ payloadBytes: 2_000_001 }),
      event({ apkVersion: "user@example.test" }),
    ], TENANT)

    expect(report.acceptedEvents).toBe(0)
    expect(report.discardedLines).toBe(5)
    expect(JSON.stringify(report)).not.toContain("employee-private-id")
    expect(JSON.stringify(report)).not.toContain("private")
  })

  it("requires a telemetry pseudonym rather than a raw tenant identifier", () => {
    expect(() => summarizeWorkforceSyncTelemetry([], "tenant-raw-id"))
      .toThrow("tenant must be a 16-character telemetry pseudonym")
  })
})
