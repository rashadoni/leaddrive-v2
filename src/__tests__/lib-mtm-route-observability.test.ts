import { describe, expect, it, vi } from "vitest"
import {
  buildMtmRouteObservabilityEvent,
  logMtmRouteObservability,
  mtmRoutePayloadSizeBucket,
  mtmRouteQueueAgeBucket,
  type MtmRouteObservabilityInput,
} from "@/lib/mtm/route-observability"

describe("MTM route observability", () => {
  it("buckets payload and queue sizes without emitting their exact values", () => {
    expect(mtmRoutePayloadSizeBucket(0)).toBe("0")
    expect(mtmRoutePayloadSizeBucket(4 * 1024)).toBe("1_4kb")
    expect(mtmRoutePayloadSizeBucket(4 * 1024 + 1)).toBe("4_16kb")
    expect(mtmRoutePayloadSizeBucket(65 * 1024)).toBe("64kb_plus")
    expect(mtmRouteQueueAgeBucket(null)).toBe("none")
    expect(mtmRouteQueueAgeBucket(59_999)).toBe("under_1m")
    expect(mtmRouteQueueAgeBucket(15 * 60_000)).toBe("15_60m")
    expect(mtmRouteQueueAgeBucket(60 * 60_000)).toBe("over_60m")
  })

  it("uses a fixed allowlist and drops identifiers, cursor, coordinates, body, key, and raw error text", () => {
    const untrusted = {
      operation: "TRAVEL_PREVIEW",
      outcome: "PROVIDER_UNAVAILABLE",
      provider: "google-routes",
      durationMs: 18.9,
      rowCount: 2,
      payloadBytes: 5_000,
      queueAgeMs: null,
      organizationId: "org-secret",
      userId: "user-secret",
      routeId: "route-secret",
      deviceId: "device-secret",
      cursor: "cursor-secret",
      coordinates: [40.4, 49.8],
      body: { address: "secret street" },
      apiKey: "secret-key",
      error: "upstream secret diagnostics",
    } as unknown as MtmRouteObservabilityInput

    const event = buildMtmRouteObservabilityEvent(untrusted)

    expect(event).toEqual({
      event: "mtm_route_observability",
      module: "route-field",
      operation: "TRAVEL_PREVIEW",
      outcome: "PROVIDER_UNAVAILABLE",
      provider: "google-routes",
      duration_ms: 18,
      row_count: 2,
      payload_size_bucket: "4_16kb",
      queue_age_bucket: "none",
    })
    const serialized = JSON.stringify(event)
    for (const secret of ["org-secret", "user-secret", "route-secret", "device-secret", "cursor-secret", "secret street", "secret-key", "upstream secret diagnostics"]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it("allowlists the v2 pull operation and structured recovery outcomes", () => {
    expect(buildMtmRouteObservabilityEvent({
      operation: "MOBILE_SYNC_V2_PULL",
      outcome: "RESNAPSHOT_REQUIRED",
      stream: "routePoints",
      durationMs: 12,
      rowCount: 4,
    })).toMatchObject({
      operation: "MOBILE_SYNC_V2_PULL",
      outcome: "RESNAPSHOT_REQUIRED",
      stream: "routePoints",
      duration_ms: 12,
      row_count: 4,
    })
  })

  it("keeps logging best effort and writes only the projected event", () => {
    const info = vi.fn()
    const event = logMtmRouteObservability({
      operation: "ROUTE_NOTIFICATION_OUTBOX_DRAIN",
      outcome: "DELIVERED",
      durationMs: 42,
      rowCount: 3,
      queueAgeMs: 61_000,
      outbox: { claimed: 3, delivered: 3, suppressed: 0, deferred: 0, failed: 0 },
    }, { info })

    expect(info).toHaveBeenCalledWith(event, "mtm route observability")
    expect(event).toMatchObject({ queue_age_bucket: "1_5m", outbox: { delivered: 3 } })
    expect(() => logMtmRouteObservability({ operation: "TRAVEL_PREVIEW", outcome: "SUCCESS" }, {
      info: () => { throw new Error("log sink unavailable") },
    })).not.toThrow()
  })
})
