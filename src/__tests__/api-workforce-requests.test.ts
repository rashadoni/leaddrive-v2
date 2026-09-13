import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceRlsAuth: vi.fn((_action, handler) => handler),
  withWorkforceSessionAuth: vi.fn((_action, handler) => handler),
}))
vi.mock("@/lib/workforce/actor", () => ({ resolveWorkforceActor: vi.fn() }))
vi.mock("@/lib/workforce/self-request", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workforce/self-request")>("@/lib/workforce/self-request")
  return { ...actual, submitWorkforceSelfRequest: vi.fn() }
})
vi.mock("@/lib/mtm-settings", () => ({ getMtmSettings: vi.fn() }))

import { GET, POST } from "@/app/api/v1/workforce/requests/route"
import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import { resolveWorkforceActor } from "@/lib/workforce/actor"
import { submitWorkforceSelfRequest } from "@/lib/workforce/self-request"

const AUTH = { orgId: "org-workforce", userId: "employee-user", role: "user" }
const callGet = GET as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>
const callPost = POST as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>

function post(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/workforce/requests", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "vitest-workforce-requests" },
    body: JSON.stringify(body),
  })
}

function get(query = "") {
  return new NextRequest(`http://localhost:3000/api/v1/workforce/requests${query}`)
}

function activeGrant(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant-team-request-read",
    organizationId: AUTH.orgId,
    principalUserId: AUTH.userId,
    role: "TEAM_MANAGER",
    scopeKind: "TEAM",
    scopeTeamId: "team-historical",
    scopeSiteId: null,
    scopeAgentId: null,
    effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
    effectiveUntil: null,
    revocation: null,
    ...overrides,
  }
}

function requestMetadata(overrides: Record<string, unknown> = {}) {
  return {
    id: "request-1",
    agentId: "employee-agent",
    type: "LEAVE",
    submittedAt: new Date("2026-09-01T08:00:00.000Z"),
    correctionWorkday: null,
    ...overrides,
  }
}

function requestDetail(overrides: Record<string, unknown> = {}) {
  return {
    ...requestMetadata(),
    status: "PENDING",
    startDate: new Date("2026-09-04T00:00:00.000Z"),
    endDate: new Date("2026-09-04T00:00:00.000Z"),
    correctionWorkdayId: null,
    requestedStartAt: null,
    requestedEndAt: null,
    reason: "Medical appointment",
    decisionNote: null,
    decidedAt: null,
    cancelledAt: null,
    updatedAt: new Date("2026-09-01T08:00:00.000Z"),
    agent: { id: "employee-agent", name: "Employee", role: "AGENT" },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
  vi.mocked(resolveWorkforceActor).mockResolvedValue({
    role: "AGENT",
    agentId: "agent-1",
    scopedAgentIds: new Set(["agent-1"]),
  } as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ features: [] } as never)
})

describe("Workforce self-request API", () => {
  it("does not treat a missing workday as a successful submission", async () => {
    vi.mocked(submitWorkforceSelfRequest).mockResolvedValue({ kind: "not_found" })
    const response = await callPost(post({
      clientRequestId: "request-123",
      type: "LEAVE",
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      reason: "Scheduled leave",
    }), AUTH)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_SELF_REQUEST_WORKDAY_NOT_FOUND" })
  })
})

describe("Workforce granular request-list fence", () => {
  beforeEach(() => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      features: ["workforce-granular-access-v1"],
    } as never)
    vi.mocked(resolveWorkforceActor).mockResolvedValue({
      role: "TEAM_LEAD",
      agentId: null,
      scopedAgentIds: ["employee-agent"],
    } as never)
  })

  it("denies an ungranted manager before querying request content", async () => {
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([])
    const response = await callGet(get(), AUTH)
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_REQUEST_READ_ACCESS_REQUIRED" })
    expect(prisma.mtmHrmRequest.findMany).not.toHaveBeenCalled()
  })

  it("contains grant lookup failures without logging private identifiers", async () => {
    vi.mocked(prisma.workforceAccessGrant.findMany).mockRejectedValueOnce(
      new Error("employee-private grant-private"),
    )
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const response = await callGet(get(), AUTH)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      code: "WORKFORCE_REQUEST_READ_ACCESS_UNAVAILABLE",
    })
    expect(consoleError).toHaveBeenCalledWith(
      "[workforce/privacy] sensitive operation failed",
      { operation: "read-request-list" },
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("employee-private")
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("grant-private")
    consoleError.mockRestore()
  })

  it("loads a historical-team leave detail only after metadata authorization", async () => {
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([activeGrant()] as never)
    vi.mocked(prisma.mtmHrmRequest.findMany)
      .mockResolvedValueOnce([requestMetadata()] as never)
      .mockResolvedValueOnce([requestDetail()] as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { requestId: "request-1", teamId: "team-historical" },
    ] as never)

    const response = await callGet(get(), AUTH)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { scope: "GRANULAR", canDecide: true, requests: [{ id: "request-1", canDecide: true }] },
    })
    expect(prisma.mtmHrmRequest.findMany).toHaveBeenCalledTimes(2)
    expect(prisma.mtmHrmRequest.findMany.mock.calls[0]?.[0]).toMatchObject({
      select: expect.not.objectContaining({ reason: true, decisionNote: true }),
    })
  })

  it("accepts an explicit grant without requiring a legacy actor", async () => {
    vi.mocked(resolveWorkforceActor).mockResolvedValue(null)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([activeGrant()] as never)
    vi.mocked(prisma.mtmHrmRequest.findMany)
      .mockResolvedValueOnce([requestMetadata()] as never)
      .mockResolvedValueOnce([requestDetail()] as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { requestId: "request-1", teamId: "team-historical" },
    ] as never)

    const response = await callGet(get(), AUTH)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { scope: "GRANULAR", canSubmitSelf: false, requests: [{ id: "request-1", canDecide: true }] },
    })
  })

  it("does not let an employee actor suppress a separate review grant", async () => {
    vi.mocked(resolveWorkforceActor).mockResolvedValue({
      role: "AGENT", agentId: "manager-agent", scopedAgentIds: ["manager-agent"],
    } as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([activeGrant()] as never)
    vi.mocked(prisma.mtmHrmRequest.findMany)
      .mockResolvedValueOnce([requestMetadata()] as never)
      .mockResolvedValueOnce([requestDetail()] as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { requestId: "request-1", teamId: "team-historical" },
    ] as never)

    const response = await callGet(get(), AUTH)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { scope: "GRANULAR", canSubmitSelf: true, requests: [{ id: "request-1", canDecide: true }] },
    })
  })

  it("does not turn team-request access into correction review", async () => {
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([activeGrant()] as never)
    vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValue([
      requestMetadata({ id: "correction-1", type: "TIME_CORRECTION" }),
    ] as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { requestId: "correction-1", teamId: "team-historical" },
    ] as never)

    const response = await callGet(get(), AUTH)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { requests: [], canDecide: false } })
    expect(prisma.mtmHrmRequest.findMany).toHaveBeenCalledTimes(1)
  })

  it("makes an inaccessible cursor indistinguishable from an invalid cursor", async () => {
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([activeGrant()] as never)
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(requestMetadata({ id: "hidden-cursor" }) as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { requestId: "hidden-cursor", teamId: "another-historical-team" },
    ] as never)

    const response = await callGet(get("?cursor=hidden-cursor"), AUTH)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_REQUEST_CURSOR_INVALID" })
    expect(prisma.mtmHrmRequest.findMany).not.toHaveBeenCalled()
  })

  it("preserves exact self-history without a manager grant", async () => {
    vi.mocked(resolveWorkforceActor).mockResolvedValue({
      role: "AGENT", agentId: "employee-agent", scopedAgentIds: ["employee-agent"],
    } as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValue([requestDetail()] as never)

    const response = await callGet(get(), AUTH)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        scope: "SELF",
        canDecide: false,
        requests: [{ id: "request-1", canCancelSelf: true, canDecide: false }],
      },
    })
  })
})
