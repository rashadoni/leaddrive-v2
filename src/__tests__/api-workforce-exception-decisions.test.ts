import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionAuth: vi.fn((_action, handler) => handler),
  withWorkforceSessionExceptionDecisionAuth: vi.fn((handler) => handler),
}))
vi.mock("@/lib/workforce/attendance-route", () => ({
  requireWorkforceAttendanceSecurityMfa: vi.fn(),
}))
vi.mock("@/lib/workforce/exception-decision-rate-limit", () => ({
  requireWorkforceExceptionDecisionRateLimit: vi.fn(),
}))

import { POST } from "@/app/api/v1/workforce/exception-decisions/route"
import { POST as LEGACY_POST } from "@/app/api/v1/workforce/exceptions/[id]/decisions/route"
import { prisma } from "@/lib/prisma"
import { requireWorkforceAttendanceSecurityMfa } from "@/lib/workforce/attendance-route"
import { requireWorkforceExceptionDecisionRateLimit } from "@/lib/workforce/exception-decision-rate-limit"
import type { WorkforceExceptionWorkbenchDecision } from "@/lib/workforce/exception-workbench"
import { issueWorkforceExceptionActionToken } from "@/lib/workforce/exception-workbench-token"

const auth = { orgId: "org_1", userId: "user_1", role: "admin" }
type Handler = (req: NextRequest, auth: typeof auth) => Promise<Response>
const callPost = POST as unknown as Handler

function actionToken(
  decisionCount = 0,
  decisionCode: WorkforceExceptionWorkbenchDecision = "ACKNOWLEDGE",
) {
  return issueWorkforceExceptionActionToken({
    organizationId: auth.orgId,
    principalUserId: auth.userId,
    caseId: "case_1",
    decisionCode,
    decisionCount,
  })
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/v1/workforce/exception-decisions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const caseRow = {
  id: "case_1",
  agentId: "agent_1",
  kind: "LATE_START",
  workdayId: "workday_1",
  workdayEvent: { occurredAt: new Date("2026-08-29T09:00:00.000Z") },
  workday: { startedAt: new Date("2026-08-29T09:00:00.000Z") },
  segment: { siteId: "site_1" },
  employeeResponses: [],
  correctionRequests: [],
}

const grantRow = {
  id: "grant_1",
  organizationId: "org_1",
  principalUserId: "user_1",
  role: "TEAM_MANAGER",
  scopeKind: "TEAM",
  scopeTeamId: "team_1",
  scopeSiteId: null,
  scopeAgentId: null,
  effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
  effectiveUntil: null,
  revocation: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWorkforceAttendanceSecurityMfa).mockResolvedValue(null)
  vi.mocked(requireWorkforceExceptionDecisionRateLimit).mockResolvedValue(null)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({
    plan: "enterprise",
    addons: [],
    features: ["workforce-hrm", "workforce-granular-access-v1"],
    modules: { "workforce-hrm": true },
  } as never)
  vi.mocked(prisma.workforceExceptionCase.findFirst).mockResolvedValue(caseRow as never)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{
    id: "membership_1",
    teamId: "team_1",
    effectiveAt: new Date("2026-08-01T00:00:00.000Z"),
  }] as never)
  vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([grantRow] as never)
  vi.mocked(prisma.workforceExceptionDecision.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.workforceExceptionDecision.findMany).mockResolvedValue([])
  vi.mocked(prisma.workforceExceptionDecision.create).mockResolvedValue({ id: "decision_1" } as never)
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit_1" } as never)
})

describe("Workforce action-token exception-decision API", () => {
  it("writes only the exact token-bound action through a live scoped grant", async () => {
    const response = await callPost(request({
      actionToken: actionToken(),
      operationId: "decision-op-1",
      reason: "Review started by the manager.",
    }), auth)

    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    const body = await response.json()
    expect(body).toEqual({
      success: true,
      idempotent: false,
      data: { decisionCode: "ACKNOWLEDGE" },
    })
    expect(prisma.workforceAccessGrant.findMany).toHaveBeenCalledTimes(2)
    expect(prisma.organization.findUnique).toHaveBeenCalledTimes(2)
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "ReadCommitted" },
    )
    expect(prisma.workforceExceptionDecision.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        caseId: "case_1",
        actorUserId: "user_1",
        decisionCode: "ACKNOWLEDGE",
        caseRevision: 1,
      }),
    }))
    expect(JSON.stringify(body)).not.toContain("case_1")
  })

  it("rejects a stale stream revision before appending another decision", async () => {
    vi.mocked(prisma.workforceExceptionDecision.findMany).mockResolvedValueOnce([{
      decisionCode: "ACKNOWLEDGE",
      createdAt: new Date("2026-08-30T09:00:00.000Z"),
      caseRevision: 1,
    }] as never)

    const response = await callPost(request({
      actionToken: actionToken(0),
      operationId: "decision-op-stale",
      reason: "This preview is stale.",
    }), auth)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_EXCEPTION_ACTION_TOKEN_STALE" })
    expect(prisma.workforceExceptionDecision.create).not.toHaveBeenCalled()
  })

  it("rejects a previously issued token after granular-access rollback", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValueOnce({
      plan: "enterprise",
      addons: [],
      features: ["workforce-hrm"],
      modules: { "workforce-hrm": true },
    } as never)

    const response = await callPost(request({
      actionToken: actionToken(),
      operationId: "decision-op-rollback",
      reason: "This token was issued before rollback.",
    }), auth)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_EXCEPTION_DECISION_UNAVAILABLE" })
    expect(prisma.workforceExceptionCase.findFirst).not.toHaveBeenCalled()
    expect(prisma.workforceExceptionDecision.create).not.toHaveBeenCalled()
  })

  it("rejects a response-request token before case lookup when its rollout is absent", async () => {
    const response = await callPost(request({
      actionToken: actionToken(1, "REQUEST_EMPLOYEE_RESPONSE"),
      operationId: "decision-op-response-disabled",
      reason: "Request the employee response.",
    }), auth)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      code: "WORKFORCE_EXCEPTION_DECISION_UNAVAILABLE",
    })
    expect(prisma.workforceExceptionCase.findFirst).not.toHaveBeenCalled()
    expect(prisma.workforceExceptionDecision.create).not.toHaveBeenCalled()
  })

  it("records a response request only when its rollout remains active", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: [
        "workforce-hrm",
        "workforce-granular-access-v1",
        "workforce-exception-response-v1",
      ],
      modules: { "workforce-hrm": true },
    } as never)
    vi.mocked(prisma.workforceExceptionDecision.findMany).mockResolvedValueOnce([{
      decisionCode: "ACKNOWLEDGE",
      createdAt: new Date("2026-08-30T09:00:00.000Z"),
      caseRevision: 1,
    }] as never)

    const response = await callPost(request({
      actionToken: actionToken(1, "REQUEST_EMPLOYEE_RESPONSE"),
      operationId: "decision-op-response-enabled",
      reason: "Request the employee response.",
    }), auth)

    expect(response.status).toBe(201)
    expect(prisma.organization.findUnique).toHaveBeenCalledTimes(2)
    expect(prisma.workforceExceptionDecision.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        decisionCode: "REQUEST_EMPLOYEE_RESPONSE",
        caseRevision: 2,
      }),
    }))
  })

  it("fails closed when the response rollout is removed while the case lock is pending", async () => {
    vi.mocked(prisma.organization.findUnique)
      .mockResolvedValueOnce({
        plan: "enterprise",
        addons: [],
        features: [
          "workforce-hrm",
          "workforce-granular-access-v1",
          "workforce-exception-response-v1",
        ],
        modules: { "workforce-hrm": true },
      } as never)
      .mockResolvedValueOnce({
        plan: "enterprise",
        addons: [],
        features: ["workforce-hrm", "workforce-granular-access-v1"],
        modules: { "workforce-hrm": true },
      } as never)
    vi.mocked(prisma.workforceExceptionDecision.findMany).mockResolvedValueOnce([{
      decisionCode: "ACKNOWLEDGE",
      createdAt: new Date("2026-08-30T09:00:00.000Z"),
      caseRevision: 1,
    }] as never)

    const response = await callPost(request({
      actionToken: actionToken(1, "REQUEST_EMPLOYEE_RESPONSE"),
      operationId: "decision-op-response-post-lock-rollback",
      reason: "Request the employee response.",
    }), auth)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: "WORKFORCE_EXCEPTION_DECISION_CONTEXT_INVALID",
    })
    expect(vi.mocked(prisma.$executeRaw).mock.calls.map((call: unknown[]) => call[1])).toEqual([
      "workforce-exception-decision:org_1:case_1",
      "workforce-exception-decision-operation:org_1:decision-op-response-post-lock-rollback",
    ])
    expect(prisma.workforceExceptionDecision.create).not.toHaveBeenCalled()
  })

  it("rechecks tenant capability after the case lock before appending", async () => {
    vi.mocked(prisma.organization.findUnique)
      .mockResolvedValueOnce({
        plan: "enterprise",
        addons: [],
        features: ["workforce-hrm", "workforce-granular-access-v1"],
        modules: { "workforce-hrm": true },
      } as never)
      .mockResolvedValueOnce({
        plan: "enterprise",
        addons: [],
        features: ["workforce-granular-access-v1"],
        modules: { "workforce-hrm": false },
      } as never)

    const response = await callPost(request({
      actionToken: actionToken(),
      operationId: "decision-op-post-lock-rollback",
      reason: "Capability changed while the writer waited.",
    }), auth)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: "WORKFORCE_EXCEPTION_DECISION_CONTEXT_INVALID",
    })
    expect(vi.mocked(prisma.$executeRaw).mock.calls.map((call: unknown[]) => call[1])).toEqual([
      "workforce-exception-decision:org_1:case_1",
      "workforce-exception-decision-operation:org_1:decision-op-post-lock-rollback",
    ])
    expect(prisma.workforceExceptionDecision.create).not.toHaveBeenCalled()
  })

  it("rebuilds historical scope after the case lock before rechecking the grant", async () => {
    vi.mocked(prisma.workforceExceptionCase.findFirst)
      .mockResolvedValueOnce(caseRow as never)
      .mockResolvedValueOnce({
        ...caseRow,
        workdayEvent: null,
        workday: { startedAt: new Date("2026-09-02T09:00:00.000Z") },
      } as never)
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{
        id: "membership_1",
        teamId: "team_1",
        effectiveAt: new Date("2026-08-01T00:00:00.000Z"),
      }] as never)
      .mockResolvedValueOnce([{
        id: "membership_2",
        teamId: "team_2",
        effectiveAt: new Date("2026-09-01T00:00:00.000Z"),
      }] as never)
    vi.mocked(prisma.workforceAccessGrant.findMany)
      .mockResolvedValueOnce([grantRow] as never)
      .mockResolvedValueOnce([grantRow] as never)

    const response = await callPost(request({
      actionToken: actionToken(),
      operationId: "decision-op-post-lock-resource-change",
      reason: "The workday scope changed while the writer waited.",
    }), auth)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: "WORKFORCE_EXCEPTION_DECISION_CONTEXT_INVALID",
    })
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
    expect(prisma.workforceAccessGrant.findMany).toHaveBeenCalledTimes(2)
    expect(prisma.workforceExceptionDecision.create).not.toHaveBeenCalled()
  })

  it("keeps an exact completed replay idempotent even after its token revision becomes stale", async () => {
    vi.mocked(prisma.workforceExceptionDecision.findFirst).mockResolvedValueOnce({
      id: "decision_1",
      organizationId: "org_1",
      caseId: "case_1",
      operationId: "decision-op-replay",
      decisionCode: "ACKNOWLEDGE",
      reason: "Review started by the manager.",
      actorUserId: "user_1",
    } as never)

    const response = await callPost(request({
      actionToken: actionToken(0),
      operationId: "decision-op-replay",
      reason: "Review started by the manager.",
    }), auth)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ success: true, idempotent: true })
    expect(prisma.workforceExceptionDecision.findMany).not.toHaveBeenCalled()
    expect(prisma.workforceExceptionDecision.create).not.toHaveBeenCalled()
  })

  it("does not expose terminal resolution before linked writers share the case lock", async () => {
    vi.mocked(prisma.workforceExceptionDecision.findMany).mockResolvedValueOnce([{
      decisionCode: "ACKNOWLEDGE",
      createdAt: new Date("2026-08-30T09:00:00.000Z"),
      caseRevision: 1,
    }] as never)

    const response = await callPost(request({
      actionToken: actionToken(1, "RESOLVE_NO_CHANGE"),
      operationId: "decision-op-terminal",
      reason: "Attempted terminal decision.",
    }), auth)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_EXCEPTION_DECISION_CONTEXT_INVALID" })
    expect(prisma.workforceExceptionDecision.create).not.toHaveBeenCalled()
  })

  it("rejects malformed, cross-principal and caller-selected decision input before lookup", async () => {
    const foreignToken = issueWorkforceExceptionActionToken({
      organizationId: auth.orgId,
      principalUserId: "other_user",
      caseId: "case_1",
      decisionCode: "ACKNOWLEDGE",
      decisionCount: 0,
    })
    const foreign = await callPost(request({
      actionToken: foreignToken,
      operationId: "decision-op-foreign",
      reason: "Must not open.",
    }), auth)
    expect(foreign.status).toBe(404)

    const callerSelected = await callPost(request({
      actionToken: actionToken(),
      decisionCode: "RESOLVE_NO_CHANGE",
      operationId: "decision-op-extra",
      reason: "Must not override token.",
    }), auth)
    expect(callerSelected.status).toBe(400)
    expect(prisma.workforceExceptionCase.findFirst).not.toHaveBeenCalled()
    expect(requireWorkforceExceptionDecisionRateLimit).not.toHaveBeenCalled()
  })

  it("stops before token or database work when mandatory MFA is denied", async () => {
    vi.mocked(requireWorkforceAttendanceSecurityMfa).mockResolvedValueOnce(new Response(null, { status: 403 }) as never)
    const response = await callPost(request({
      actionToken: actionToken(),
      operationId: "decision-op-mfa-denied",
      reason: "Review requires active MFA.",
    }), auth)
    expect(response.status).toBe(403)
    expect(requireWorkforceExceptionDecisionRateLimit).not.toHaveBeenCalled()
    expect(prisma.workforceExceptionCase.findFirst).not.toHaveBeenCalled()
  })

  it("leaves the legacy database-id endpoint as a non-oracular tombstone", async () => {
    const legacy = LEGACY_POST as unknown as (
      req: NextRequest,
      auth: typeof auth,
      context: { params: Promise<{ id: string }> },
    ) => Promise<Response>
    const response = await legacy(request({}), auth, { params: Promise.resolve({ id: "case_1" }) })
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      code: "WORKFORCE_EXCEPTION_DECISION_ACTION_TOKEN_REQUIRED",
    })
    expect(prisma.workforceExceptionCase.findFirst).not.toHaveBeenCalled()
  })
})

const resolvedHistory = [
  { decisionCode: "ACKNOWLEDGE", caseRevision: 1 },
  { decisionCode: "RESOLVE_NO_CHANGE", caseRevision: 2 },
]

describe("Explicit HR outcome recording", () => {
  beforeEach(() => {
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([{ ...grantRow, role: "HR_ADMIN" }] as never)
    vi.mocked(prisma.workforceExceptionDecision.findMany).mockResolvedValue(resolvedHistory as never)
  })

  it.each(["CLASSIFY_FALSE_POSITIVE", "CLASSIFY_CONFIRMED_EXCEPTION", "APPEAL_FULLY_UPHELD", "APPEAL_PARTIALLY_UPHELD", "APPEAL_REJECTED"] as const)("records %s with accountable immutable audit", async (code) => {
    const response = await callPost(request({ actionToken: actionToken(2, code), operationId: "hr-outcome-1", reason: "Reviewed explicitly by HR." }), auth)
    expect(response.status).toBe(201)
    expect(prisma.workforceExceptionDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorUserId: auth.userId, decisionCode: code, caseRevision: 3, reason: "Reviewed explicitly by HR." }) })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ newData: expect.objectContaining({ decisionCode: code, caseRevision: 3, policyMode: "REVIEWED_V1" }) }) })
    const body = await response.json()
    expect(JSON.stringify(body)).not.toContain("Reviewed explicitly")
    expect(JSON.stringify(vi.mocked(prisma.mtmAuditLog.create).mock.calls)).not.toContain("Reviewed explicitly")
  })

  it.each(["TEAM_MANAGER", "TENANT_ADMIN", "AUDITOR"])("does not turn %s into HR authority", async (role) => {
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([{ ...grantRow, role }] as never)
    const response = await callPost(request({ actionToken: actionToken(2, "CLASSIFY_FALSE_POSITIVE"), operationId: "hr-outcome-1", reason: "Reviewed explicitly by HR." }), auth)
    expect(response.status).toBe(404)
    expect(prisma.workforceExceptionDecision.create).not.toHaveBeenCalled()
  })

  it("rechecks HR revocation after waiting for the case lock", async () => {
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValueOnce([{ ...grantRow, role: "HR_ADMIN" }] as never).mockResolvedValue([] as never)
    const response = await callPost(request({ actionToken: actionToken(2, "APPEAL_PARTIALLY_UPHELD"), operationId: "hr-outcome-1", reason: "Reviewed explicitly by HR." }), auth)
    expect(response.status).toBe(409)
    expect(prisma.workforceExceptionDecision.create).not.toHaveBeenCalled()
  })

  it("refuses unfinished and reopened cases", async () => {
    for (const history of [resolvedHistory.slice(0,1), [...resolvedHistory, { decisionCode: "REOPEN_FOR_REVIEW", caseRevision: 3 }]]) {
      vi.mocked(prisma.workforceExceptionDecision.findMany).mockResolvedValue(history as never)
      const response = await callPost(request({ actionToken: actionToken(history.length, "APPEAL_FULLY_UPHELD"), operationId: "hr-outcome-1", reason: "Reviewed explicitly by HR." }), auth)
      expect(response.status).toBe(409)
    }
    expect(prisma.workforceExceptionDecision.create).not.toHaveBeenCalled()
  })

  it("requires new classification after a reopen and prevents replacing an existing one", async () => {
    const history = [...resolvedHistory, { decisionCode: "CLASSIFY_FALSE_POSITIVE", caseRevision: 3 }]
    vi.mocked(prisma.workforceExceptionDecision.findMany).mockResolvedValue(history as never)
    const body = { actionToken: actionToken(3, "CLASSIFY_CONFIRMED_EXCEPTION"), operationId: "hr-outcome-1", reason: "Reviewed explicitly by HR." }
    expect((await callPost(request(body),auth)).status).toBe(409)
    vi.mocked(prisma.workforceExceptionDecision.findMany).mockResolvedValue([...history, { decisionCode: "REOPEN_FOR_REVIEW", caseRevision: 4 }, { decisionCode: "RESOLVE_NO_CHANGE", caseRevision: 5 }] as never)
    expect((await callPost(request({ ...body, actionToken: actionToken(5, "CLASSIFY_CONFIRMED_EXCEPTION") }),auth)).status).toBe(201)
  })
})
