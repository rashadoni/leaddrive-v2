import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler<C = unknown> = (req: NextRequest, auth: AuthContext, ctx: C) => Promise<Response>

const mockState = vi.hoisted(() => ({
  registrations: [] as Array<{ module: string | undefined; action: string | undefined }>,
  runSource: vi.fn(),
  fenceBlocked: false,
}))

vi.mock("@/lib/social/with-monitoring-mutation-fence", () => ({
  withSocialMonitoringMutationFence: (module: string | undefined, action: string | undefined, handler: RouteHandler) => {
    mockState.registrations.push({ module, action })
    return (req: NextRequest, ctx?: unknown) => {
      if (mockState.fenceBlocked) {
        return NextResponse.json(
          {
            error: "Social Monitoring is paused for a clean-slate reset",
            code: "social_monitoring_collection_blocked",
          },
          { status: 409 },
        )
      }
      return handler(
        req,
        { orgId: "org-1", userId: "user-1", role: "manager" },
        ctx,
      )
    }
  },
}))

vi.mock("@/lib/social/monitoring-source-run", () => ({
  runMonitoringSourceForActor: mockState.runSource,
}))

import { POST } from "@/app/api/v1/social/monitoring-sources/[id]/run/route"
import { runMonitoringSourceForActor } from "@/lib/social/monitoring-source-run"

function request(body?: unknown) {
  return new NextRequest("http://localhost/api/v1/social/monitoring-sources/src-1/run", {
    method: "POST",
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  })
}

function params(id = "src-1") {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockState.fenceBlocked = false
  mockState.runSource.mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      runId: "run-1",
      sourceId: "src-1",
      status: "success",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
    },
  })
})

describe("POST /api/v1/social/monitoring-sources/[id]/run", () => {
  it("does not read identities or enter collector preflight while clean-slate collection is blocked", async () => {
    mockState.fenceBlocked = true

    const res = await POST(request({
      onlyCapability: "DISCOVER_POSTS",
    }), params())

    expect(res.status).toBe(409)
    expect(runMonitoringSourceForActor).not.toHaveBeenCalled()
  })

  it("runs a tenant source through the social write gate", async () => {
    mockState.runSource.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        runId: "run-1",
        sourceId: "src-1",
        status: "skipped",
        foundCount: 0,
        newCount: 0,
        duplicateCount: 0,
        ignoredCount: 0,
        error: "collector_not_configured",
      },
    })

    const res = await POST(request(), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(runMonitoringSourceForActor).toHaveBeenCalledWith({
      organizationId: "org-1",
      sourceId: "src-1",
      expectedScope: "EXTERNAL",
      maxTotalChargeUsd: undefined,
      paidRunConfirmed: false,
      requestedByUserId: "user-1",
      onlyCapability: undefined,
    })
    expect(json.data).toMatchObject({ runId: "run-1", status: "skipped" })
  })

  it("validates and forwards an explicit one-shot USD cap", async () => {
    const res = await POST(request({ maxTotalChargeUsd: 0.5 }), params())

    expect(res.status).toBe(200)
    expect(runMonitoringSourceForActor).toHaveBeenCalledWith({
      organizationId: "org-1",
      sourceId: "src-1",
      expectedScope: "EXTERNAL",
      maxTotalChargeUsd: 0.5,
      paidRunConfirmed: true,
      requestedByUserId: "user-1",
      onlyCapability: undefined,
    })
  })

  it("forwards an explicit paid confirmation for quota-governed runs without a USD cap", async () => {
    const res = await POST(request({ paidConfirmed: true }), params())

    expect(res.status).toBe(200)
    expect(runMonitoringSourceForActor).toHaveBeenCalledWith({
      organizationId: "org-1",
      sourceId: "src-1",
      expectedScope: "EXTERNAL",
      maxTotalChargeUsd: undefined,
      paidRunConfirmed: true,
      requestedByUserId: "user-1",
      onlyCapability: undefined,
    })
  })

  it.each(["true", 1, null])("rejects invalid paid confirmation %s before collector execution", async (paidConfirmed) => {
    const res = await POST(request({ paidConfirmed }), params())

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("paidConfirmed")
    expect(runMonitoringSourceForActor).not.toHaveBeenCalled()
  })

  it("blocks an unscoped run for an official identity source", async () => {
    mockState.runSource.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: "official_identity_not_collectable",
    })

    const res = await POST(request(), params())
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toBe("official_identity_not_collectable")
  })

  // Удаление клиента стирает связи, но источник остаётся: раньше его можно
  // было запустить отсюда за деньги по несуществующему клиенту.
  it("отказывает в платном запуске источника без живого клиента", async () => {
    mockState.runSource.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: "no_active_linked_subject",
    })
    const res = await POST(request(), params())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("no_active_linked_subject")
  })

  it("отказывает, когда связей с клиентами не осталось вовсе", async () => {
    mockState.runSource.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: "no_active_linked_subject",
    })
    const res = await POST(request(), params())
    expect(res.status).toBe(409)
  })

  it("validates and forwards a capability-scoped one-shot run", async () => {
    const res = await POST(request({ maxTotalChargeUsd: 1, onlyCapability: "READ_EXTERNAL_COMMENTS" }), params())

    expect(res.status).toBe(200)
    expect(runMonitoringSourceForActor).toHaveBeenCalledWith({
      organizationId: "org-1",
      sourceId: "src-1",
      expectedScope: "EXTERNAL",
      maxTotalChargeUsd: 1,
      paidRunConfirmed: true,
      requestedByUserId: "user-1",
      onlyCapability: "READ_EXTERNAL_COMMENTS",
    })
  })

  it.each(["COMMENTS", "", 123, null])("rejects invalid scoped capability %s", async (onlyCapability) => {
    const res = await POST(request({ maxTotalChargeUsd: 1, onlyCapability }), params())
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toContain("onlyCapability")
    expect(runMonitoringSourceForActor).not.toHaveBeenCalled()
  })

  it.each([0, -1, 100.01, "0.5", null])("rejects invalid manual USD cap %s before collector execution", async (maxTotalChargeUsd) => {
    const res = await POST(request({ maxTotalChargeUsd }), params())
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toContain("maxTotalChargeUsd")
    expect(runMonitoringSourceForActor).not.toHaveBeenCalled()
  })
  it("maps missing sources to 404", async () => {
    mockState.runSource.mockResolvedValueOnce({
      ok: false,
      status: 404,
      error: "monitoring_source_not_found",
    })

    const res = await POST(request(), params("missing"))
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json.error).toBe("Not found")
  })

  it("maps an active collector lease to a retryable conflict", async () => {
    mockState.runSource.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: "collector_already_running",
      retryAfterSeconds: 90,
    })

    const res = await POST(request(), params())
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toBe("Collector is already running")
    expect(json.retryAfterSeconds).toBe(90)
  })

  it("registers the route on social write permission", () => {
    expect(mockState.registrations).toContainEqual({ module: "social", action: "write" })
  })
})
