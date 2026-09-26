import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionExceptionQueueAuth: vi.fn((handler) => handler),
}))

import { GET } from "@/app/api/v1/workforce/exceptions/route"
import { prisma } from "@/lib/prisma"
import { readWorkforceExceptionActionToken } from "@/lib/workforce/exception-workbench-token"

const AUTH = { orgId: "org-workforce", userId: "manager-1", role: "admin", principalType: "session" as const }
const callGet = GET as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>

function candidate(id = "case-00000001", agentId = "agent-1") {
  return {
    id,
    agentId,
    workdayEvent: { occurredAt: new Date("2026-08-30T09:00:00.000Z") },
    workday: { startedAt: new Date("2026-08-30T09:00:00.000Z") },
    segment: { siteId: "site-1" },
  }
}

function detail(id = "case-00000001", overrides: Record<string, unknown> = {}) {
  return {
    id,
    agentId: "agent-1",
    kind: "NO_SHOW",
    createdAt: new Date("2026-08-30T09:00:00.000Z"),
    evidenceId: "evidence-1",
    workdayId: "workday-1",
    agent: { name: "Aysel Aliyeva" },
    decisions: [],
    employeeResponses: [],
    correctionRequests: [],
    ...overrides,
  }
}

const grantRow = {
  id: "grant-1",
  organizationId: AUTH.orgId,
  principalUserId: AUTH.userId,
  role: "TEAM_MANAGER",
  scopeKind: "TEAM",
  scopeTeamId: "team-1",
  scopeSiteId: null,
  scopeAgentId: null,
  effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
  effectiveUntil: null,
  revocation: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ features: ["workforce-hrm"] } as never)
})

describe("Workforce scoped exception queue API", () => {
  it("preserves the legacy admin queue as two-phase and read-only", async () => {
    vi.mocked(prisma.workforceExceptionCase.findMany)
      .mockResolvedValueOnce([candidate()] as never)
      .mockResolvedValueOnce([detail("case-00000001", {
        rawLocation: "RAW_LOCATION_MUST_NOT_LEAK",
        decisionReason: "RAW_REASON_MUST_NOT_LEAK",
      })] as never)

    const response = await callGet(new NextRequest("http://localhost/api/v1/workforce/exceptions"), AUTH)

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      data: {
        disposition: "READ_ONLY_HUMAN_REVIEW_REQUIRED",
        cases: [{
          displayReference: "WF-00000001",
          employeeDisplayName: "Aysel Aliyeva",
          stage: "OPEN",
          decisionContext: { actions: [] },
        }],
      },
    })
    expect(JSON.stringify(body)).not.toMatch(/case-00000001|evidence-1|RAW_LOCATION|RAW_REASON/)
    const [metadataCall, detailCall] = vi.mocked(prisma.workforceExceptionCase.findMany).mock.calls
    expect(metadataCall?.[0]).toMatchObject({
      take: 1001,
      select: {
        id: true,
        agentId: true,
        workdayEvent: { select: { occurredAt: true } },
        workday: { select: { startedAt: true } },
        segment: { select: { siteId: true } },
      },
    })
    expect(metadataCall?.[0]?.select).not.toHaveProperty("agent")
    expect(metadataCall?.[0]?.select).not.toHaveProperty("decisions")
    expect(detailCall?.[0]).toMatchObject({ where: { organizationId: AUTH.orgId, id: { in: ["case-00000001"] } } })
  })

  it("filters by historical team before details and issues one exact action token", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      features: ["workforce-hrm", "workforce-granular-access-v1"],
    } as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([grantRow] as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { requestId: "case-allowed-01", teamId: "team-1" },
      { requestId: "case-denied-02", teamId: "team-2" },
    ] as never)
    vi.mocked(prisma.workforceExceptionCase.findMany)
      .mockResolvedValueOnce([
        candidate("case-allowed-01", "agent-1"),
        candidate("case-denied-02", "agent-2"),
      ] as never)
      .mockResolvedValueOnce([detail("case-allowed-01")] as never)

    const response = await callGet(new NextRequest("http://localhost/api/v1/workforce/exceptions"), AUTH)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.disposition).toBe("SCOPED_HUMAN_REVIEW")
    expect(body.data.cases).toHaveLength(1)
    expect(body.data.cases[0].decisionContext.actions).toHaveLength(1)
    expect(body.data.cases[0].decisionContext.actions[0].decisionCode).toBe("ACKNOWLEDGE")
    expect(readWorkforceExceptionActionToken({
      token: body.data.cases[0].decisionContext.actions[0].actionToken,
      organizationId: AUTH.orgId,
      principalUserId: AUTH.userId,
    })).toMatchObject({
      caseId: "case-allowed-01",
      decisionCode: "ACKNOWLEDGE",
      decisionCount: 0,
    })
    expect(JSON.stringify(body)).not.toMatch(/case-allowed-01|case-denied-02|agent-2/)
    expect(vi.mocked(prisma.workforceExceptionCase.findMany).mock.calls[1]?.[0]).toMatchObject({
      where: { organizationId: AUTH.orgId, id: { in: ["case-allowed-01"] } },
    })
  })

  it("denies a cut-over tenant without an exception-read grant before scanning cases", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      features: ["workforce-hrm", "workforce-granular-access-v1"],
    } as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([])

    const response = await callGet(new NextRequest("http://localhost/api/v1/workforce/exceptions"), AUTH)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_GRANULAR_ACCESS_REQUIRED" })
    expect(prisma.workforceExceptionCase.findMany).not.toHaveBeenCalled()
  })

  it("denies a revoked exception-read grant before the metadata scan", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      features: ["workforce-hrm", "workforce-granular-access-v1"],
    } as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([{
      ...grantRow,
      revocation: { revokedAt: new Date("2026-01-01T00:00:00.000Z") },
    }] as never)

    const response = await callGet(new NextRequest("http://localhost/api/v1/workforce/exceptions"), AUTH)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_GRANULAR_ACCESS_REQUIRED" })
    expect(prisma.workforceExceptionCase.findMany).not.toHaveBeenCalled()
  })

  it("projects only an employee response from the current request or reopen cycle", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      features: ["workforce-hrm", "workforce-granular-access-v1"],
    } as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([grantRow] as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ requestId: "case-00000001", teamId: "team-1" }] as never)
    vi.mocked(prisma.workforceExceptionCase.findMany)
      .mockResolvedValueOnce([candidate()] as never)
      .mockResolvedValueOnce([detail("case-00000001", {
        decisions: [
          { decisionCode: "ACKNOWLEDGE", createdAt: new Date("2026-09-26T09:00:00.000Z") },
          { decisionCode: "REQUEST_EMPLOYEE_RESPONSE", createdAt: new Date("2026-09-26T11:00:00.000Z") },
        ],
        employeeResponses: [{ createdAt: new Date("2026-09-26T10:00:00.000Z") }],
      })] as never)

    const response = await callGet(new NextRequest("http://localhost/api/v1/workforce/exceptions"), AUTH)
    const body = await response.json()

    expect(body.data.cases[0]).toMatchObject({
      stage: "AWAITING_EMPLOYEE_RESPONSE",
      employeeResponse: "PENDING",
      nextAction: "WAIT_FOR_EMPLOYEE_RESPONSE",
      decisionContext: { employeeVisibility: "NOT_RECORDED", actions: [] },
    })
  })

  it("does not issue an action token at the 64-decision storage bound", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      features: ["workforce-hrm", "workforce-granular-access-v1"],
    } as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([grantRow] as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ requestId: "case-00000001", teamId: "team-1" }] as never)
    vi.mocked(prisma.workforceExceptionCase.findMany)
      .mockResolvedValueOnce([candidate()] as never)
      .mockResolvedValueOnce([detail("case-00000001", {
        decisions: Array.from({ length: 64 }, (_, index) => ({
          decisionCode: "ACKNOWLEDGE",
          createdAt: new Date(1_700_000_000_000 + index),
        })),
      })] as never)

    const response = await callGet(new NextRequest("http://localhost/api/v1/workforce/exceptions"), AUTH)
    const body = await response.json()

    expect(body.data.cases[0]).toMatchObject({
      stage: "HR_REVIEW",
      decisionContext: { actions: [] },
    })
  })

  it("routes truncated decision history to integrity review with no token", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      features: ["workforce-hrm", "workforce-granular-access-v1"],
    } as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([grantRow] as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ requestId: "case-00000001", teamId: "team-1" }] as never)
    vi.mocked(prisma.workforceExceptionCase.findMany)
      .mockResolvedValueOnce([candidate()] as never)
      .mockResolvedValueOnce([detail("case-00000001", {
        decisions: Array.from({ length: 65 }, (_, index) => ({
          decisionCode: index === 0 ? "ACKNOWLEDGE" : "ESCALATE_TO_HR",
          createdAt: new Date(1_700_000_000_000 + index),
        })),
      })] as never)

    const response = await callGet(new NextRequest("http://localhost/api/v1/workforce/exceptions"), AUTH)
    const body = await response.json()
    expect(body.data.cases[0]).toMatchObject({
      stage: "DATA_INTEGRITY_REVIEW",
      decisionContext: { actions: [] },
    })
  })

  it("fails closed instead of truncating an oversized metadata scan", async () => {
    vi.mocked(prisma.workforceExceptionCase.findMany).mockResolvedValueOnce(
      Array.from({ length: 1_001 }, (_, index) => candidate(`case-${index}`, `agent-${index}`)) as never,
    )

    const response = await callGet(new NextRequest("http://localhost/api/v1/workforce/exceptions"), AUTH)
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_EXCEPTION_SCOPE_LIMIT_EXCEEDED" })
  })
})
