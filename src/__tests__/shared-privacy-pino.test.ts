import { describe, expect, it, vi } from "vitest"
import { createPrivacyLogger } from "@/lib/logger"
import { observeSupportUxOperation, supportUxObservationTenantKey } from "@/lib/support-ux-observation"
import { logMtmRouteObservability } from "@/lib/mtm/route-observability"

const CANARY = "PRIVATE_SYNTHETIC_person@example.invalid_Bearer_secret"
function destination() {
  const lines: string[] = []
  const logger = createPrivacyLogger({ write: line => { lines.push(line) } })
  return { logger, lines, events: () => lines.map(line => JSON.parse(line)) }
}

describe("shared Pino physical serialization boundary", () => {
  it("drops free messages, Error stacks/causes, arbitrary fields and inherited child identifiers", () => {
    const { logger, lines, events } = destination()
    const child = logger.child({ org_id: CANARY, user_id: CANARY, request_id: CANARY, module: "erp-provider", extra: CANARY }).child({ name: CANARY })
    child.error(new Error(CANARY, { cause: new Error(CANARY) }), CANARY)
    child.info({ event: CANARY, nested: { password: CANARY }, msg: CANARY }, CANARY)
    child.warn(CANARY)
    expect(events()).toHaveLength(3)
    for (const event of events()) expect(event).toEqual({ level: expect.any(Number), time: expect.any(Number), module: "erp-provider", event: "application_log", msg: "application log" })
    expect(lines.join("")).not.toContain(CANARY)
  })

  it("never invokes unknown getters, toJSON, coercion, cycles or hostile descriptors", () => {
    const { logger, lines } = destination()
    const effect = vi.fn(() => { throw new Error(CANARY) })
    const value = { get event() { return effect() }, toJSON: effect, toString: effect, self: null as unknown }
    value.self = value
    logger.info(value, CANARY)
    logger.info(new Proxy({}, { getOwnPropertyDescriptor: effect }), CANARY)
    logger.child({ get module() { return effect() }, toJSON: effect }).info(value)
    expect(effect).toHaveBeenCalledTimes(1) // descriptor trap caught; no getter/coercion/serialization
    expect(lines).toHaveLength(3)
    expect(lines.join("")).not.toContain(CANARY)
  })

  it.each(["CATEGORY_LIST", "CATEGORY_CREATE", "CATEGORY_RENAME", "CATEGORY_DELETE"] as const)("preserves actual unsampled Support %s observations", async operation => {
    const { logger, events, lines } = destination()
    for (const status of [200, 403, 500]) {
      const response = new Response(null, { status })
      expect(await observeSupportUxOperation({ orgId: CANARY, operation }, async setMode => { setMode("database"); return response }, {
        sink: logger, artifactSha: () => "a".repeat(40), secret: () => "synthetic-test-key", observedAtUtc: () => "2026-10-06T12:00:00.000Z", now: () => 10,
      })).toBe(response)
    }
    expect(events().map(({ level, time, msg, ...event }) => { expect([level, time, msg]).toEqual([30, expect.any(Number), "support ux observation"]); return event })).toEqual([200, 403, 500].map(http_status => ({ event: "support_ux_observation", schema_version: 1, observed_at_utc: "2026-10-06T12:00:00.000Z", artifact_sha: "a".repeat(40), tenant_key: supportUxObservationTenantKey(CANARY, "synthetic-test-key"), operation, mode: "database", http_status, outcome: http_status === 200 ? "success" : http_status === 403 ? "client_rejection" : "server_error", duration_ms: 0 })))
    expect(lines.join("")).not.toContain(CANARY)
  })

  it("preserves actual Routes dimensions, counters and outcomes without extra attributes", () => {
    const { logger, events } = destination()
    const event = logMtmRouteObservability({ operation: "ROUTE_NOTIFICATION_OUTBOX_DRAIN", outcome: "DELIVERED", provider: "google-routes", stream: "routes", durationMs: 1.9, rowCount: 8, payloadBytes: 8192, queueAgeMs: 120000, outbox: { claimed: 4, delivered: 1, suppressed: 1, deferred: 1, failed: 1 } }, logger)
    expect(events()).toEqual([{ ...event, level: 30, time: expect.any(Number), msg: "mtm route observability" }])
  })

  it("retains thrown Support identity and unavailable reason when the sink fails", async () => {
    const { logger, events } = destination()
    const thrown = new Error(CANARY)
    await expect(observeSupportUxOperation({ orgId: CANARY, operation: "CATEGORY_LIST" }, async () => { throw thrown }, { sink: logger, artifactSha: () => "a".repeat(40), secret: () => "synthetic", observedAtUtc: () => "2026-10-06T12:00:00.000Z", now: () => 0 })).rejects.toBe(thrown)
    expect(events()[0]).toMatchObject({ outcome: "thrown", http_status: null })
    const response = new Response(null, { status: 204 })
    await expect(observeSupportUxOperation({ orgId: CANARY, operation: "CATEGORY_LIST" }, async () => response, { sink: createPrivacyLogger({ write() { throw thrown } }) })).resolves.toBe(response)
    logger.info({ event: "support_ux_observation_unavailable", reason: "CLOCK_UNAVAILABLE", secret: CANARY })
    expect(events()[1]).toMatchObject({ event: "support_ux_observation_unavailable", reason: "CLOCK_UNAVAILABLE" })
  })
})
