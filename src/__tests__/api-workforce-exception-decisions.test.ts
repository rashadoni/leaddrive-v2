import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionAuth: vi.fn((_action, handler) => handler),
}))

import { POST } from "@/app/api/v1/workforce/exceptions/[id]/decisions/route"
import { prisma } from "@/lib/prisma"

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
  agent: { teamId: "team_1" },
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
  vi.mocked(prisma.workforceExceptionCase.findFirst).mockResolvedValue(caseRow as never)
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
    await expect(response.json()).resolves.toEqual({ success: true, idempotent: false, data: { decisionId: "decision_1" } })
    expect(prisma.workforceAccessGrant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org_1", principalUserId: "user_1" }),
    }))
    expect(prisma.workforceExceptionDecision.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ caseId: "case_1", actorUserId: "user_1", decisionCode: "ACKNOWLEDGE" }),
    }))
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
  })
})
