import { createHmac } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  observeSupportUxOperation,
  supportUxObservationTenantKey,
  type SupportUxObservationEvent,
  type SupportUxObservationMode,
  type SupportUxObservationOperation,
  type SupportUxObservationOptions,
} from "@/lib/support-ux-observation"

const { defaultInfo } = vi.hoisted(() => ({ defaultInfo: vi.fn() }))
vi.mock("@/lib/logger", () => ({ default: { info: defaultInfo } }))
vi.mock("@/generated/build-sha", () => ({ DEPLOY_SHA: "a".repeat(40) }))

const SHA = "b".repeat(40)
const SECRET = "observation-test-only-secret"
const UTC = "2026-10-03T22:00:00.123Z"
const CONTEXT = { orgId: "private-org", operation: "CATEGORY_CREATE" as const }

function testOptions(overrides: SupportUxObservationOptions = {}) {
  const info = vi.fn()
  const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(112.4)
  const options: SupportUxObservationOptions = {
    artifactSha: () => SHA, secret: () => SECRET, now,
    observedAtUtc: () => UTC, sink: { info }, ...overrides,
  }
  return { options, info }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe("Support UX authenticated handler observation", () => {
  it.each([
    [200, "success"], [201, "success"], [204, "success"], [299, "success"],
    [400, "client_rejection"], [403, "client_rejection"], [409, "client_rejection"],
    [429, "client_rejection"], [499, "client_rejection"],
    [500, "server_error"], [503, "server_error"], [599, "server_error"],
  ] as const)("records exactly one unsampled event for HTTP %i and preserves the response", async (status, outcome) => {
    const response = new Response(null, { status })
    const { options, info } = testOptions()
    const handler = vi.fn(async (setMode: (mode: SupportUxObservationMode) => void) => {
      setMode("database")
      return response
    })

    expect(await observeSupportUxOperation(CONTEXT, handler, options)).toBe(response)
    expect(handler).toHaveBeenCalledOnce()
    expect(info).toHaveBeenCalledExactlyOnceWith({
      event: "support_ux_observation", schema_version: 1, observed_at_utc: UTC,
      artifact_sha: SHA, tenant_key: supportUxObservationTenantKey(CONTEXT.orgId, SECRET),
      operation: "CATEGORY_CREATE", mode: "database", http_status: status,
      outcome, duration_ms: 12,
    }, "support ux observation")
  })

  it.each(["CATEGORY_LIST", "CATEGORY_CREATE", "CATEGORY_RENAME", "CATEGORY_DELETE"] as const)(
    "allows the fixed operation %s with explicit unverified mode", async (operation) => {
      const { options, info } = testOptions()
      await observeSupportUxOperation({ orgId: CONTEXT.orgId, operation }, async () => new Response(), options)
      expect(info.mock.calls[0][0]).toMatchObject({ operation, mode: "unverified" })
    },
  )

  it("keeps the last verified mode and closes the setter after completion", async () => {
    const { options, info } = testOptions()
    let retainedSetter: ((mode: SupportUxObservationMode) => void) | undefined
    await observeSupportUxOperation(CONTEXT, async (setMode) => {
      retainedSetter = setMode
      setMode("database")
      setMode("browser")
      return new Response()
    }, options)
    retainedSetter?.("database")
    expect(info).toHaveBeenCalledOnce()
    expect(info.mock.calls[0][0]).toMatchObject({ mode: "browser" })
  })

  it.each([new Error("private error text"), { token: "private thrown value" }, undefined])(
    "preserves the original thrown value without logging it", async (original) => {
      const { options, info } = testOptions()
      let caught: unknown = "not caught"
      try {
        await observeSupportUxOperation(CONTEXT, async (setMode) => {
          setMode("database")
          throw original
        }, options)
      } catch (error) {
        caught = error
      }
      expect(caught).toBe(original)
      expect(info).toHaveBeenCalledOnce()
      expect(info.mock.calls[0][0]).toMatchObject({ outcome: "thrown", http_status: null, mode: "database" })
      expect(JSON.stringify(info.mock.calls)).not.toContain("private")
    },
  )

  it("keeps logger failures from changing a response or thrown value", async () => {
    const sink = { info: vi.fn(() => { throw new Error("private sink error") }) }
    const response = new Response()
    expect(await observeSupportUxOperation(CONTEXT, async () => response, testOptions({ sink }).options)).toBe(response)
    const original = new Error("original handler error")
    await expect(observeSupportUxOperation(CONTEXT, async () => { throw original }, testOptions({ sink }).options))
      .rejects.toBe(original)
    expect(sink.info).toHaveBeenCalledTimes(2)
  })

  it("projects only fixed fields without request, category, principal, payload or secret values", async () => {
    const context = {
      ...CONTEXT, userId: "private-user", categoryName: "private-category", query: "private-query",
      request: { headers: { authorization: "private-token" } }, error: "private-diagnostic",
    }
    const response = Response.json({ data: "private-body", name: "private-customer" })
    const { options, info } = testOptions()
    await observeSupportUxOperation(context, async () => response, options)
    const event = info.mock.calls[0][0] as SupportUxObservationEvent
    expect(Object.keys(event).sort()).toEqual([
      "event", "schema_version", "observed_at_utc", "artifact_sha", "tenant_key",
      "operation", "mode", "http_status", "outcome", "duration_ms",
    ].sort())
    const serialized = JSON.stringify(info.mock.calls)
    for (const value of [CONTEXT.orgId, SECRET, "private-user", "private-category", "private-query", "private-token", "private-diagnostic", "private-body", "private-customer"]) {
      expect(serialized).not.toContain(value)
    }
    expect(await response.json()).toEqual({ data: "private-body", name: "private-customer" })
  })

  it("uses exact domain-separated HMAC bytes and changes keys across tenant or secret rotation", () => {
    const key = supportUxObservationTenantKey("tenant-one", SECRET)
    expect(key).toBe(createHmac("sha256", SECRET).update("support-ux-observation-v1:tenant-one", "utf8").digest("hex"))
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(supportUxObservationTenantKey("tenant-one", SECRET)).toBe(key)
    expect(supportUxObservationTenantKey("tenant-two", SECRET)).not.toBe(key)
    expect(supportUxObservationTenantKey("tenant-one", "rotated-test-key")).not.toBe(key)
    expect(() => supportUxObservationTenantKey("", SECRET)).toThrow("SUPPORT_UX_OBSERVATION_KEY_UNAVAILABLE")
    expect(() => supportUxObservationTenantKey("tenant-one", "")).toThrow("SUPPORT_UX_OBSERVATION_KEY_UNAVAILABLE")
  })

  it("defaults to compiled SHA and validated NEXTAUTH_SECRET, ignoring environment SHA and alternate auth keys", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", SECRET)
    vi.stubEnv("DEPLOY_SHA", "c".repeat(40))
    vi.stubEnv("AUTH_SECRET", "alternate-test-only-key")
    const { options, info } = testOptions()
    delete options.artifactSha
    delete options.secret
    await observeSupportUxOperation(CONTEXT, async () => new Response(), options)
    expect(info.mock.calls[0][0]).toMatchObject({
      artifact_sha: "a".repeat(40), tenant_key: supportUxObservationTenantKey(CONTEXT.orgId, SECRET),
    })
    vi.stubEnv("NEXTAUTH_SECRET", "")
    const second = testOptions()
    delete second.options.secret
    await observeSupportUxOperation(CONTEXT, async () => new Response(), second.options)
    expect(second.info.mock.calls[0][0]).toEqual({
      event: "support_ux_observation_unavailable", schema_version: 1, reason: "TENANT_KEY_UNAVAILABLE",
    })
  })

  it("uses the existing Pino sink by default", async () => {
    const { options } = testOptions()
    delete options.sink
    await observeSupportUxOperation(CONTEXT, async () => new Response(), options)
    expect(defaultInfo).toHaveBeenCalledOnce()
    expect(defaultInfo.mock.calls[0][0]).toMatchObject({ event: "support_ux_observation" })
  })

  it.each(["", "a".repeat(39), "A".repeat(40), "private-invalid-sha"])(
    "fails closed on invalid compiled/source SHA without echoing it", async (artifactSha) => {
      const { options, info } = testOptions({ artifactSha: () => artifactSha })
      const response = new Response()
      expect(await observeSupportUxOperation(CONTEXT, async () => response, options)).toBe(response)
      expect(info).toHaveBeenCalledExactlyOnceWith({
        event: "support_ux_observation_unavailable", schema_version: 1, reason: "ARTIFACT_UNAVAILABLE",
      }, "support ux observation")
    },
  )

  it.each([
    { orgId: "", operation: "CATEGORY_CREATE" },
    { orgId: "я".repeat(129), operation: "CATEGORY_CREATE" },
    { orgId: CONTEXT.orgId, operation: "private-invalid-operation" },
    null,
  ])("keeps invalid context unavailable while calling the handler once", async (context) => {
    const { options, info } = testOptions()
    const handler = vi.fn(async () => new Response())
    await observeSupportUxOperation(context as unknown as typeof CONTEXT, handler, options)
    expect(handler).toHaveBeenCalledOnce()
    expect(info).toHaveBeenCalledExactlyOnceWith({
      event: "support_ux_observation_unavailable", schema_version: 1, reason: "INVALID_CONTEXT",
    }, "support ux observation")
  })

  it("does not reread mutable context or invoke unrelated private getters", async () => {
    const context = { ...CONTEXT, operation: "CATEGORY_CREATE" as SupportUxObservationOperation }
    Object.defineProperty(context, "body", { get: () => { throw new Error("private-body") } })
    const { options, info } = testOptions()
    await observeSupportUxOperation(context, async () => {
      context.orgId = "different-private-org"
      context.operation = "CATEGORY_DELETE"
      return new Response()
    }, options)
    expect(info.mock.calls[0][0]).toMatchObject({
      operation: "CATEGORY_CREATE", tenant_key: supportUxObservationTenantKey(CONTEXT.orgId, SECRET),
    })
  })

  it("handles a throwing context getter without affecting the handler or leaking its exception", async () => {
    const context = { ...CONTEXT }
    Object.defineProperty(context, "orgId", { get: () => { throw new Error("private-context") } })
    const { options, info } = testOptions()
    const response = new Response()
    expect(await observeSupportUxOperation(context, async () => response, options)).toBe(response)
    expect(info.mock.calls[0][0]).toEqual({ event: "support_ux_observation_unavailable", schema_version: 1, reason: "INVALID_CONTEXT" })
  })

  it.each(["artifactSha", "secret", "now", "observedAtUtc"] as const)(
    "handles throwing %s providers without leaking errors or replacing handler results", async (key) => {
      const { options, info } = testOptions({ [key]: () => { throw new Error("private-provider-diagnostic") } })
      const response = new Response()
      expect(await observeSupportUxOperation(CONTEXT, async () => response, options)).toBe(response)
      expect(info).toHaveBeenCalledOnce()
      expect(info.mock.calls[0][0].event).toBe("support_ux_observation_unavailable")
      expect(JSON.stringify(info.mock.calls)).not.toContain("private-provider-diagnostic")
    },
  )

  it.each([[NaN, 1], [Infinity, 1], [-1, 1], [10, NaN], [10, Infinity], [10, 9], [0, 600_001]])(
    "rejects invalid or out-of-range monotonic times without clipping latency", async (start, end) => {
      const now = vi.fn().mockReturnValueOnce(start).mockReturnValueOnce(end)
      const { options, info } = testOptions({ now })
      await observeSupportUxOperation(CONTEXT, async () => new Response(), options)
      expect(info.mock.calls[0][0]).toEqual({ event: "support_ux_observation_unavailable", schema_version: 1, reason: "CLOCK_UNAVAILABLE" })
    },
  )

  it.each([0, 600_000])("admits the exact duration boundary %i", async (duration) => {
    const { options, info } = testOptions({ now: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(duration) })
    await observeSupportUxOperation(CONTEXT, async () => new Response(), options)
    expect(info.mock.calls[0][0]).toMatchObject({ duration_ms: duration })
  })

  it.each(["invalid", "2026-02-30T00:00:00.000Z", "2026-10-03T22:00:00+04:00", "2026-10-03T22:00:00Z"])(
    "rejects noncanonical completion UTC", async (utc) => {
      const { options, info } = testOptions({ observedAtUtc: () => utc })
      await observeSupportUxOperation(CONTEXT, async () => new Response(), options)
      expect(info.mock.calls[0][0]).toEqual({ event: "support_ux_observation_unavailable", schema_version: 1, reason: "CLOCK_UNAVAILABLE" })
    },
  )

  it("does not recover an invalid mode into a fabricated valid observation", async () => {
    const { options, info } = testOptions()
    await observeSupportUxOperation(CONTEXT, async (setMode) => {
      setMode("private-invalid-mode" as SupportUxObservationMode)
      setMode("database")
      return new Response()
    }, options)
    expect(info.mock.calls[0][0]).toEqual({ event: "support_ux_observation_unavailable", schema_version: 1, reason: "MODE_INVALID" })
  })

  it("preserves an unsupported HTTP response without inventing an outcome", async () => {
    const response = new Response(null, { status: 302 })
    const { options, info } = testOptions()
    expect(await observeSupportUxOperation(CONTEXT, async () => response, options)).toBe(response)
    expect(info.mock.calls[0][0]).toEqual({ event: "support_ux_observation_unavailable", schema_version: 1, reason: "RESPONSE_UNAVAILABLE" })
  })
})
