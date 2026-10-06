import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { workforceLogFailures } from "./fixtures/workforce-log-failures"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceRlsAuth: vi.fn((_action, handler) => handler),
  withWorkforceSessionAuth: vi.fn((_action, handler) => handler),
}))
vi.mock("@/lib/workforce/actor", () => ({ resolveWorkforceActor: vi.fn() }))
vi.mock("@/lib/mtm-settings", () => ({ getMtmSettings: vi.fn() }))
vi.mock("@/lib/workforce/self-request", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workforce/self-request")>("@/lib/workforce/self-request")
  return { ...actual, submitWorkforceSelfRequest: vi.fn(), cancelWorkforceSelfRequest: vi.fn() }
})
vi.mock("@/lib/workforce/request-decision", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workforce/request-decision")>("@/lib/workforce/request-decision")
  return { ...actual, decideWorkforceRequest: vi.fn() }
})

import { POST as submit } from "@/app/api/v1/workforce/requests/route"
import { POST as decide } from "@/app/api/v1/workforce/requests/[id]/decision/route"
import { POST as cancel } from "@/app/api/v1/workforce/requests/[id]/cancel/route"
import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import { resolveWorkforceActor } from "@/lib/workforce/actor"
import { submitWorkforceSelfRequest, cancelWorkforceSelfRequest } from "@/lib/workforce/self-request"
import { decideWorkforceRequest } from "@/lib/workforce/request-decision"

const auth = { orgId: "synthetic-org", userId: "synthetic-user", role: "sales" }
type Context = { params: Promise<{ id: string }> }
type Handler = (req: NextRequest, authContext: typeof auth, context: Context) => Promise<Response>
const invokeSubmit = submit as unknown as Handler
const invokeDecide = decide as unknown as Handler
const invokeCancel = cancel as unknown as Handler
const context = (id = "request-synthetic") => ({ params: Promise.resolve({ id }) })
const input = {
  clientRequestId: "synthetic-client-key", type: "LEAVE",
  startDate: "2026-10-06", endDate: "2026-10-06", reason: "Synthetic private request reason",
}
const decisionData = { id: "request-synthetic", status: "APPROVED" }

function request(body: unknown) {
  return new NextRequest("http://localhost/api/v1/workforce/requests", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  })
}
function logs() {
  return {
    error: vi.spyOn(console, "error").mockImplementation(() => undefined),
    warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveWorkforceActor).mockResolvedValue({ agentId: "synthetic-agent", role: "AGENT", scopedAgentIds: ["synthetic-agent"] })
  vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "starter", addons: [], features: [], modules: [] } as never)
  vi.mocked(decideWorkforceRequest).mockResolvedValue({ kind: "success", data: decisionData, conflicts: [], idempotent: true } as never)
})
afterEach(() => vi.restoreAllMocks())

describe("Request route failure privacy with actual handlers and shared logger", () => {
  it.each(workforceLogFailures)("submit discards $kind and preserves generic500", async ({ make }) => {
    vi.mocked(submitWorkforceSelfRequest).mockRejectedValueOnce(make())
    const captured = logs()
    const response = await invokeSubmit(request(input), auth, context())
    expect(response.status).toBe(500)
    expect(response.headers.get("cache-control")).toBeNull()
    await expect(response.json()).resolves.toEqual({ error: "Failed to submit Workforce request" })
    expect(captured.error.mock.calls).toEqual([["[workforce/privacy] sensitive operation failed", { operation: "submit-self-request" }]])
    expect(captured.warn).not.toHaveBeenCalled()
    expect(submitWorkforceSelfRequest).toHaveBeenCalledTimes(1)
    expect(cancelWorkforceSelfRequest).not.toHaveBeenCalled()
    expect(decideWorkforceRequest).not.toHaveBeenCalled()
  })

  it.each(workforceLogFailures)("decision discards $kind and preserves generic500", async ({ make }) => {
    vi.mocked(decideWorkforceRequest).mockRejectedValueOnce(make())
    const captured = logs()
    const response = await invokeDecide(request({ decision: "APPROVED" }), auth, context())
    expect(response.status).toBe(500)
    expect(response.headers.get("cache-control")).toBeNull()
    await expect(response.json()).resolves.toEqual({ error: "Failed to save Workforce decision" })
    expect(captured.error.mock.calls).toEqual([["[workforce/privacy] sensitive operation failed", { operation: "decide-request" }]])
    expect(captured.warn).not.toHaveBeenCalled()
    expect(decideWorkforceRequest).toHaveBeenCalledTimes(1)
    expect(submitWorkforceSelfRequest).not.toHaveBeenCalled()
    expect(cancelWorkforceSelfRequest).not.toHaveBeenCalled()
  })

  it.each(workforceLogFailures)("cancel discards $kind and preserves generic500", async ({ make }) => {
    vi.mocked(cancelWorkforceSelfRequest).mockRejectedValueOnce(make())
    const captured = logs()
    const response = await invokeCancel(request({}), auth, context())
    expect(response.status).toBe(500)
    expect(response.headers.get("cache-control")).toBeNull()
    await expect(response.json()).resolves.toEqual({ error: "Failed to cancel Workforce request" })
    expect(captured.error.mock.calls).toEqual([["[workforce/privacy] sensitive operation failed", { operation: "cancel-self-request" }]])
    expect(captured.warn).not.toHaveBeenCalled()
    expect(cancelWorkforceSelfRequest).toHaveBeenCalledTimes(1)
    expect(submitWorkforceSelfRequest).not.toHaveBeenCalled()
    expect(decideWorkforceRequest).not.toHaveBeenCalled()
  })

  it.each(workforceLogFailures)("entitlement discards $kind, keeps warn and permits HRM decision without Route enrichment", async ({ make }) => {
    vi.mocked(prisma.organization.findUnique).mockRejectedValueOnce(make())
    const captured = logs()
    const req = request({ decision: "APPROVED" })
    const response = await invokeDecide(req, auth, context())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, data: decisionData, conflicts: [], idempotent: true })
    expect(captured.warn.mock.calls).toEqual([["[workforce/privacy] sensitive operation unavailable", { operation: "request-route-entitlement" }]])
    expect(captured.error).not.toHaveBeenCalled()
    expect(decideWorkforceRequest).toHaveBeenCalledTimes(1)
    expect(decideWorkforceRequest).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: auth.orgId, userId: auth.userId, requestId: "request-synthetic", req,
      includeRouteConflicts: false, input: { decision: "APPROVED" },
    }))
    expect(prisma.mtmRoute.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.update).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("does not submit when settings resolution fails before the service", async () => {
    vi.mocked(getMtmSettings).mockRejectedValueOnce(workforceLogFailures[0].make())
    const captured = logs()
    expect((await invokeSubmit(request(input), auth, context())).status).toBe(500)
    expect(submitWorkforceSelfRequest).not.toHaveBeenCalled()
    expect(captured.error.mock.calls).toEqual([["[workforce/privacy] sensitive operation failed", { operation: "submit-self-request" }]])
  })
})

describe("Request route authorization, validation and response boundaries", () => {
  it.each([
    { name: "submit", handler: invokeSubmit, body: input },
    { name: "decision", handler: invokeDecide, body: { decision: "APPROVED" } },
    { name: "cancel", handler: invokeCancel, body: {} },
  ])("denies a missing actor before $name service or logs", async ({ handler, body }) => {
    vi.mocked(resolveWorkforceActor).mockResolvedValue(null)
    const captured = logs()
    const response = await handler(request(body), auth, context())
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "Forbidden", code: "WORKFORCE_SCOPE_DENIED" })
    expect(submitWorkforceSelfRequest).not.toHaveBeenCalled()
    expect(decideWorkforceRequest).not.toHaveBeenCalled()
    expect(cancelWorkforceSelfRequest).not.toHaveBeenCalled()
    expect(prisma.organization.findUnique).not.toHaveBeenCalled()
    expect(captured.error).not.toHaveBeenCalled()
    expect(captured.warn).not.toHaveBeenCalled()
  })

  it("rejects a cancellation id before entering the service", async () => {
    const captured = logs()
    const response = await invokeCancel(request({}), auth, context("invalid/id"))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "Invalid Workforce request id", code: "WORKFORCE_SELF_REQUEST_ID_INVALID" })
    expect(cancelWorkforceSelfRequest).not.toHaveBeenCalled()
    expect(captured.error).not.toHaveBeenCalled()
  })

  it.each([false, true])("preserves submit create/replay status and private cache headers (idempotent=%s)", async idempotent => {
    const data = { id: "request-synthetic", status: "PENDING" }
    vi.mocked(submitWorkforceSelfRequest).mockResolvedValueOnce({ kind: "success", data, idempotent } as never)
    const response = await invokeSubmit(request(input), auth, context())
    expect(response.status).toBe(idempotent ? 200 : 201)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({ success: true, data, idempotent })
  })

  it.each([
    { result: { kind: "not_found" }, status: 404, body: { error: "Not found" } },
    { result: { kind: "forbidden" }, status: 403, body: { error: "Forbidden", code: "WORKFORCE_SCOPE_DENIED" } },
    { result: { kind: "already_decided", status: "REJECTED" }, status: 409, body: { error: "This request has already been decided", code: "WORKFORCE_REQUEST_ALREADY_DECIDED", status: "REJECTED" } },
    { result: { kind: "route_conflict", conflicts: [] }, status: 409, body: { error: "The employee has active routes during this absence", code: "WORKFORCE_ROUTE_CONFLICT", conflicts: [] } },
  ])("keeps mapped decision result $result.kind without failure logging", async ({ result, status, body }) => {
    vi.mocked(decideWorkforceRequest).mockResolvedValueOnce(result as never)
    const captured = logs()
    const response = await invokeDecide(request({ decision: "APPROVED" }), auth, context())
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual(body)
    expect(captured.error).not.toHaveBeenCalled()
    expect(captured.warn).not.toHaveBeenCalled()
  })
})
