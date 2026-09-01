import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { findMany, organizationFindUnique } = vi.hoisted(() => ({
  findMany: vi.fn(),
  organizationFindUnique: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: {
  organization: { findUnique: organizationFindUnique },
  workforceExceptionCase: { findMany },
} }))
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionAuth: vi.fn((_action, handler) => handler),
}))
vi.mock("@/lib/workforce/actor", () => ({ resolveWorkforceActor: vi.fn() }))

import { GET } from "@/app/api/v1/workforce/exceptions/mine/route"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { resolveWorkforceActor } from "@/lib/workforce/actor"
import { WORKFORCE_EXCEPTION_RESPONSE_FLAG } from "@/lib/workforce/exception-response-rollout"

const AUTH = { orgId: "org-1", userId: "user-1", role: "sales" }
const callGet = GET as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>

function ownCase(overrides: Record<string, unknown> = {}) {
  return {
    id: "case-00000001",
    kind: "LATE_START",
    createdAt: new Date("2026-08-31T09:00:00.000Z"),
    expectedWorkDate: null,
    workday: { id: "workday-1", workDate: new Date("2026-08-30T00:00:00.000Z") },
    ...overrides,
  }
}

beforeEach(() => {
  findMany.mockReset()
  organizationFindUnique.mockReset()
  organizationFindUnique.mockResolvedValue({ features: [] })
  vi.mocked(resolveWorkforceActor).mockReset()
})

describe("Workforce personal exception discovery API", () => {
  it("uses a session-self boundary and projects only own generic correction links", async () => {
    vi.mocked(resolveWorkforceActor).mockResolvedValue({ agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] })
    findMany.mockResolvedValue([ownCase({
      rawLocation: "RAW_LOCATION_MUST_NOT_LEAK",
      qrPayload: "RAW_QR_MUST_NOT_LEAK",
      deviceProof: "RAW_DEVICE_MUST_NOT_LEAK",
      decisionReason: "RAW_REASON_MUST_NOT_LEAK",
    })])

    const response = await callGet(new NextRequest("http://localhost:3000/api/v1/workforce/exceptions/mine"), AUTH)

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      data: {
        disposition: "SELF_SERVICE_CORRECTION_ONLY",
        responseRecording: "MIGRATION_REQUIRED",
        cases: [{
          caseId: "case-00000001",
          displayReference: "WF-00000001",
          type: "LATE_START",
          workdayId: "workday-1",
          availableAction: "REQUEST_CORRECTION",
        }],
      },
    })
    expect(JSON.stringify(body)).not.toMatch(/RAW_LOCATION|RAW_QR|RAW_DEVICE|RAW_REASON/)
    expect(organizationFindUnique).toHaveBeenCalledWith({
      where: { id: "org-1" },
      select: { features: true },
    })
    expect(findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        agentId: "agent-1",
        OR: [
          { workdayId: { not: null } },
          { kind: "NO_SHOW", workdayId: null, expectedWorkDate: { not: null } },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 101,
      select: {
        id: true,
        kind: true,
        createdAt: true,
        expectedWorkDate: true,
        workday: { select: { id: true, workDate: true } },
      },
    })
    expect(withWorkforceSessionAuth).toHaveBeenCalledWith("read", expect.any(Function))
  })

  it("projects an own schedule-only no-show as view-only without inventing a workday or response path", async () => {
    vi.mocked(resolveWorkforceActor).mockResolvedValue({ agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] })
    organizationFindUnique.mockResolvedValue({ features: [WORKFORCE_EXCEPTION_RESPONSE_FLAG] })
    findMany.mockResolvedValue([ownCase({
      kind: "NO_SHOW",
      workday: null,
      expectedWorkDate: new Date("2026-08-31T00:00:00.000Z"),
      employeeResponses: [{ id: "response-must-not-change-no-show-boundary" }],
    })])

    const response = await callGet(new NextRequest("http://localhost:3000/api/v1/workforce/exceptions/mine"), AUTH)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      data: {
        responseRecording: "AVAILABLE",
        cases: [{
          caseId: "case-00000001",
          type: "NO_SHOW",
          workdayId: null,
          availableAction: "VIEW_ONLY_NO_SHOW",
          responseState: "UNAVAILABLE",
        }],
      },
    })
    expect(JSON.stringify(body)).not.toContain("response-must-not-change-no-show-boundary")
  })

  it("enables only a rehearsed tenant and still emits an identifier-minimized acknowledgement state", async () => {
    vi.mocked(resolveWorkforceActor).mockResolvedValue({ agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] })
    organizationFindUnique.mockResolvedValue({ features: [WORKFORCE_EXCEPTION_RESPONSE_FLAG] })
    findMany.mockResolvedValue([ownCase({
      employeeResponses: [{ id: "response-internal-only", correctionRequestId: "request-internal-only" }],
    })])

    const response = await callGet(new NextRequest("http://localhost:3000/api/v1/workforce/exceptions/mine"), AUTH)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      data: {
        responseRecording: "AVAILABLE",
        cases: [{ caseId: "case-00000001", responseState: "ACKNOWLEDGED" }],
      },
    })
    expect(JSON.stringify(body)).not.toContain("response-internal-only")
    expect(JSON.stringify(body)).not.toContain("request-internal-only")
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        employeeResponses: {
          take: 1,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        },
      }),
    }))
  })

  it("denies a non-employee before querying cases", async () => {
    vi.mocked(resolveWorkforceActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null })

    const response = await callGet(new NextRequest("http://localhost:3000/api/v1/workforce/exceptions/mine"), AUTH)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "Forbidden", code: "WORKFORCE_SCOPE_DENIED" })
    expect(findMany).not.toHaveBeenCalled()
  })

  it("fails closed rather than silently truncating a large personal queue", async () => {
    vi.mocked(resolveWorkforceActor).mockResolvedValue({ agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] })
    findMany.mockResolvedValue(Array.from({ length: 101 }, () => ownCase()))

    const response = await callGet(new NextRequest("http://localhost:3000/api/v1/workforce/exceptions/mine"), AUTH)

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      error: "Too many personal exception cases for one safe page; narrow the date range first",
      code: "WORKFORCE_SELF_EXCEPTION_LIMIT_EXCEEDED",
    })
  })
})
