import { afterEach, describe, expect, it, vi } from "vitest"
import {
  recordMtmMobileApkObservation,
  recordMtmMobileSyncPullTelemetry,
  recordMtmMobileV1SyncActivity,
} from "@/lib/mtm/mobile-sync-telemetry"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("MTM mobile sync pull telemetry", () => {
  it("records required dimensions without leaking tenant, cursor or payload content", () => {
    vi.stubEnv("MOBILE_SYNC_TELEMETRY_SUCCESS_SAMPLE_RATE", "1")
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)

    recordMtmMobileSyncPullTelemetry({
      organizationId: "tenant-private-id",
      stream: "routes",
      endpoint: "GET /api/v2/mtm/mobile/sync/routes",
      contractVersion: 2,
      apkVersion: "2.0.1+42",
      result: "ok",
      durationMs: 14.3,
      response: {
        items: [{ id: "route-1", customerName: "must-not-log" }],
        tombstones: [],
        cursor: "must-not-log",
      },
    })

    expect(info).toHaveBeenCalledTimes(1)
    const serialized = String(info.mock.calls[0][1])
    expect(serialized).toContain('"stream":"routes"')
    expect(serialized).toContain('"contractVersion":2')
    expect(serialized).toContain('"rowCount":1')
    expect(serialized).toContain('"payloadBytes":')
    expect(serialized).not.toContain("tenant-private-id")
    expect(serialized).not.toContain("must-not-log")
  })

  it("retains failure telemetry even when successful pulls are sampled out", () => {
    vi.stubEnv("MOBILE_SYNC_TELEMETRY_SUCCESS_SAMPLE_RATE", "0")
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)

    recordMtmMobileSyncPullTelemetry({
      organizationId: "org-1",
      stream: "routes",
      endpoint: "GET /api/v2/mtm/mobile/sync/routes",
      contractVersion: 2,
      apkVersion: "unsafe user@example.test",
      result: "unavailable",
      durationMs: 5,
      response: { code: "MOBILE_SYNC_V2_UNAVAILABLE" },
    })

    expect(info).toHaveBeenCalledTimes(1)
    expect(String(info.mock.calls[0][1])).toContain('"apkVersion":"unknown"')
    expect(String(info.mock.calls[0][1])).toContain('"result":"unavailable"')
  })

  it("records a privacy-safe bootstrap APK census without turning it into a v1 gate", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)

    recordMtmMobileApkObservation({
      organizationId: "tenant-private-id",
      agentId: "agent-private-id",
      apkVersion: "2.3.1+101",
      protocolPreferred: 2,
      cohorts: { routes: true, visits: false, tasks: false, workforce: true, gps: false, media: true },
    })

    expect(info).toHaveBeenCalledTimes(1)
    const serialized = String(info.mock.calls[0][1])
    expect(serialized).toContain('"event":"mobile_apk_observed"')
    expect(serialized).toContain('"apkVersion":"2.3.1+101"')
    expect(serialized).toContain('"protocolPreferred":2')
    expect(JSON.parse(serialized).cohorts).toEqual({
      routes: true,
      visits: false,
      tasks: false,
      workforce: true,
      gps: false,
      media: true,
    })
    expect(serialized).not.toContain("tenant-private-id")
    expect(serialized).not.toContain("agent-private-id")
  })

  it("records unsampled v1 activity without cursor, device, payload or raw principal data", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)

    recordMtmMobileV1SyncActivity({
      organizationId: "tenant-private-id",
      agentId: "agent-private-id",
      apkVersion: "2.3.1+101",
      endpoint: "POST /api/v1/mtm/mobile/sync/push",
    })

    expect(info).toHaveBeenCalledTimes(1)
    const serialized = String(info.mock.calls[0][1])
    expect(serialized).toContain('"event":"mobile_sync_v1_activity"')
    expect(serialized).toContain('"protocolVersion":1')
    expect(serialized).toContain('"apkVersion":"2.3.1+101"')
    expect(serialized).not.toContain("tenant-private-id")
    expect(serialized).not.toContain("agent-private-id")
    expect(serialized).not.toContain("cursor")
    expect(serialized).not.toContain("operationId")
  })

  it("maps an arbitrary APK header claim to unknown", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)

    recordMtmMobileV1SyncActivity({
      organizationId: "org-1",
      agentId: "agent-1",
      apkVersion: "field-device-42",
      endpoint: "GET /api/v1/mtm/mobile/sync/pull",
    })

    expect(String(info.mock.calls[0][1])).toContain('"apkVersion":"unknown"')
  })

  it("maps a bare numeric APK header claim to unknown", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)

    recordMtmMobileV1SyncActivity({
      organizationId: "org-1",
      agentId: "agent-1",
      apkVersion: "1234567890",
      endpoint: "GET /api/v1/mtm/mobile/sync/pull",
    })

    expect(String(info.mock.calls[0][1])).toContain('"apkVersion":"unknown"')
  })

  it("maps an overlong but syntactically release-like APK header claim to unknown", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)

    recordMtmMobileV1SyncActivity({
      organizationId: "org-1",
      agentId: "agent-1",
      apkVersion: `1.0.0+${"a".repeat(64)}`,
      endpoint: "GET /api/v1/mtm/mobile/sync/pull",
    })

    expect(String(info.mock.calls[0][1])).toContain('"apkVersion":"unknown"')
  })
})
