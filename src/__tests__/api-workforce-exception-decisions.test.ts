import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionAuth: vi.fn((_action, handler) => handler),
}))
vi.mock("@/lib/workforce/attendance-route", () => ({
  requireWorkforceAttendanceSecurityMfa: vi.fn(),
}))
vi.mock("@/lib/workforce/exception-decision-rate-limit", () => ({
  requireWorkforceExceptionDecisionRateLimit: vi.fn(),
}))

import { POST } from "@/app/api/v1/workforce/exceptions/[id]/decisions/route"
import { prisma } from "@/lib/prisma"
import { requireWorkforceAttendanceSecurityMfa } from "@/lib/workforce/attendance-route"
import { requireWorkforceExceptionDecisionRateLimit } from "@/lib/workforce/exception-decision-rate-limit"

const auth = { orgId: "org_1", userId: "user_1", role: "admin" }
type Handler = (req: NextRequest, auth: typeof auth, context: { params: Promise<{ id: string }> }) => Promise<Response>
const callPost = POST as unknown as Handler

function request(body: unknown) {
  return new NextRequest("http://localhost/api/v1/workforce/exceptions/case_1/decisions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const caseRow = {
  id: "case_1",
  agentId: "agent_1",
  workdayEvent: { occurredAt: new Date("2026-08-29T09:00:00.000Z") },
  workday: { startedAt: new Date("2026-08-29T09:00:00.000Z") },
  segment: { siteId: "site_1" },
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

describe("Workforce scoped exception-decision API", () => {
  it("writes an immutable reviewed decision only through an effective scoped grant", async () => {
    const response = await callPost(request({
      operationId: "decision-op-1",
      decisionCode: "ACKNOWLEDGE",
      reason: "Review started by the manager.",
    }), auth, { params: Promise.resolve({ id: "case_1" }) })
    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    await expect(response.json()).resolves.toEqual({ success: true, idempotent: false, data: { decisionId: "decision_1" } })
    expect(prisma.workforceAccessGrant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org_1", principalUserId: "user_1" }),
    }))
    expect(prisma.workforceExceptionDecision.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ caseId: "case_1", actorUserId: "user_1", decisionCode: "ACKNOWLEDGE" }),
    }))
    expect(prisma.workforceExceptionCase.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        workdayEvent: { select: { occurredAt: true } },
        workday: { select: { startedAt: true } },
      }),
    }))
    expect(requireWorkforceAttendanceSecurityMfa).toHaveBeenCalledWith("org_1", auth)
    expect(requireWorkforceExceptionDecisionRateLimit).toHaveBeenCalledWith({
      organizationId: "org_1", principalUserId: "user_1",
    })
  })

  it("never substitutes a current directory team when historical membership is unavailable", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([] as never)

    const response = await callPost(request({
      operationId: "decision-op-historical-team",
      decisionCode: "ACKNOWLEDGE",
      reason: "Review started by the manager.",
    }), auth, { params: Promise.resolve({ id: "case_1" }) })

    expect(response.status).toBe(404)
    expect(prisma.workforceExceptionDecision.create).not.toHaveBeenCalled()
  })

  it("uses an indistinguishable unavailable result for an absent case or absent grant", async () => {
    vi.mocked(prisma.workforceExceptionCase.findFirst).mockResolvedValueOnce(null)
    const missing = await callPost(request({ operationId: "decision-op-1", decisionCode: "ACKNOWLEDGE", reason: "Review started." }), auth, { params: Promise.resolve({ id: "case_1" }) })
    expect(missing.status).toBe(404)

    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValueOnce([])
    const denied = await callPost(request({ operationId: "decision-op-2", decisionCode: "ACKNOWLEDGE", reason: "Review started." }), auth, { params: Promise.resolve({ id: "case_1" }) })
    expect(denied.status).toBe(404)
    expect(await missing.json()).toEqual(await denied.json())
    expect(prisma.workforceExceptionDecision.create).not.toHaveBeenCalled()
  })

  it("rejects malformed input before any authority or case lookup", async () => {
    const response = await callPost(request({ operationId: "short", decisionCode: "PAYROLL", reason: "x" }), auth, { params: Promise.resolve({ id: "case_1" }) })
    expect(response.status).toBe(400)
    expect(prisma.workforceExceptionCase.findFirst).not.toHaveBeenCalled()
    expect(prisma.workforceAccessGrant.findMany).not.toHaveBeenCalled()
    expect(requireWorkforceExceptionDecisionRateLimit).not.toHaveBeenCalled()
  })

  it("stops before case/grant lookup when mandatory MFA is unavailable or denied", async () => {
    vi.mocked(requireWorkforceAttendanceSecurityMfa).mockResolvedValueOnce(new Response(null, { status: 403 }) as never)

    const response = await callPost(request({
      operationId: "decision-op-mfa-denied",
      decisionCode: "ACKNOWLEDGE",
      reason: "Review requires active MFA.",
    }), auth, { params: Promise.resolve({ id: "case_1" }) })

    expect(response.status).toBe(403)
    expect(requireWorkforceExceptionDecisionRateLimit).not.toHaveBeenCalled()
    expect(prisma.workforceExceptionCase.findFirst).not.toHaveBeenCalled()
    expect(prisma.workforceAccessGrant.findMany).not.toHaveBeenCalled()
  })

  it("stops before case/grant lookup when the shared decision guard denies or is unavailable", async () => {
    vi.mocked(requireWorkforceExceptionDecisionRateLimit).mockResolvedValueOnce(new Response(null, { status: 429 }) as never)

    const response = await callPost(request({
      operationId: "decision-op-rate-limited",
      decisionCode: "ACKNOWLEDGE",
      reason: "Review remains pending.",
    }), auth, { params: Promise.resolve({ id: "case_1" }) })

    expect(response.status).toBe(429)
    expect(prisma.workforceExceptionCase.findFirst).not.toHaveBeenCalled()
    expect(prisma.workforceAccessGrant.findMany).not.toHaveBeenCalled()
    expect(prisma.workforceExceptionDecision.create).not.toHaveBeenCalled()
  })
})
