import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mtmAgent: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionAuth: vi.fn((_action, handler) => handler),
}))
vi.mock("@/lib/workforce/approved-report-rate-limit", () => ({
  requireWorkforceEvidenceTimelineRateLimit: vi.fn(async () => null),
}))
vi.mock("@/lib/workforce/evidence-timeline-access", () => ({
  resolveWorkforceEvidenceDirectoryAccess: vi.fn(async () => ({ mode: "ALL_ACTIVE_AGENTS" })),
}))
vi.mock("@/lib/workforce/sensitive-operation-log", () => ({
  logWorkforceSensitiveOperationFailure: vi.fn(),
}))

import { GET } from "@/app/api/v1/workforce/evidence/targets/route"
import { prisma } from "@/lib/prisma"
import { requireWorkforceEvidenceTimelineRateLimit } from "@/lib/workforce/approved-report-rate-limit"
import { resolveWorkforceEvidenceDirectoryAccess } from "@/lib/workforce/evidence-timeline-access"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"

const AUTH = { orgId: "org-1", userId: "reviewer-1", role: "manager", principalType: "session" as const }
const invoke = GET as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>

function request(query = "ay", headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/v1/workforce/evidence/targets?q=${query}`, {
    headers: {
      "x-workforce-access-purpose": "ATTENDANCE_REVIEW",
      "x-workforce-access-reason-code": "OPEN_EXCEPTION",
      "x-workforce-case-reference": "case-17",
      "x-real-ip": "203.0.113.77",
      "user-agent": "evidence-target-test",
      ...headers,
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWorkforceEvidenceTimelineRateLimit).mockResolvedValue(null)
  vi.mocked(resolveWorkforceEvidenceDirectoryAccess).mockResolvedValue({ mode: "ALL_ACTIVE_AGENTS" })
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: "audit-1" } as never)
})

describe("GET /api/v1/workforce/evidence/targets", () => {
  it("returns only bounded active named employees after a metadata-only audit", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      name: "Aysel Aliyeva",
      email: "aysel@example.test",
      externalCode: "EMP-17",
    }] as never)

    const response = await invoke(request(), AUTH)

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { items: [{ id: "agent-1", label: "Aysel Aliyeva · EMP-17" }], hasMore: false },
    })
    expect(prisma.mtmAgent.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        status: "ACTIVE",
        OR: [
          { name: { contains: "ay", mode: "insensitive" } },
          { email: { contains: "ay", mode: "insensitive" } },
          { externalCode: { contains: "ay", mode: "insensitive" } },
        ],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 26,
      select: { id: true, name: true, email: true, externalCode: true },
    })
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: "reviewer-1",
        entityType: "workforce_evidence_target_search",
        entityId: null,
        newValue: expect.objectContaining({
          purpose: "ATTENDANCE_REVIEW",
          reasonCode: "OPEN_EXCEPTION",
          queryLength: 2,
          resultCount: 1,
        }),
      }),
    }))
    const audit = JSON.stringify(vi.mocked(prisma.auditLog.create).mock.calls)
    expect(audit).not.toContain("Aysel")
    expect(audit).not.toContain("aysel@example.test")
    expect(audit).not.toContain("agent-1")
  })

  it("applies the exact-agent predicate returned by the shared evidence resolver", async () => {
    vi.mocked(resolveWorkforceEvidenceDirectoryAccess).mockResolvedValue({
      mode: "EXACT_AGENTS",
      agentIds: ["agent-1", "agent-2"],
    })

    const response = await invoke(request(), AUTH)

    expect(response.status).toBe(200)
    expect(prisma.mtmAgent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ["agent-1", "agent-2"] } }),
    }))
  })

  it("rejects invalid search/context before rate, access, directory and audit reads", async () => {
    const short = await invoke(request("a"), AUTH)
    const wildcard = await invoke(request("%25_"), AUTH)
    const missingContext = await invoke(new NextRequest(
      "http://localhost/api/v1/workforce/evidence/targets?q=ay",
    ), AUTH)

    expect(short.status).toBe(400)
    expect(wildcard.status).toBe(400)
    expect(missingContext.status).toBe(400)
    expect(requireWorkforceEvidenceTimelineRateLimit).not.toHaveBeenCalled()
    expect(resolveWorkforceEvidenceDirectoryAccess).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findMany).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("fails closed before directory access when the distributed rate guard denies", async () => {
    vi.mocked(requireWorkforceEvidenceTimelineRateLimit).mockResolvedValue(
      NextResponse.json({ code: "WORKFORCE_EVIDENCE_TIMELINE_RATE_LIMITED" }, { status: 429 }),
    )

    const response = await invoke(request(), AUTH)

    expect(response.status).toBe(429)
    expect(resolveWorkforceEvidenceDirectoryAccess).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findMany).not.toHaveBeenCalled()
  })

  it("never queries employees when the shared evidence resolver denies access", async () => {
    vi.mocked(resolveWorkforceEvidenceDirectoryAccess).mockResolvedValue(
      NextResponse.json({ code: "WORKFORCE_EVIDENCE_TIMELINE_ACCESS_REQUIRED" }, { status: 403 }),
    )

    const response = await invoke(request(), AUTH)

    expect(response.status).toBe(403)
    expect(prisma.mtmAgent.findMany).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("returns no target list if the mandatory access audit cannot be written", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      name: "Aysel Aliyeva",
      email: "aysel@example.test",
      externalCode: null,
    }] as never)
    vi.mocked(prisma.auditLog.create).mockRejectedValue(new Error("audit unavailable"))

    const response = await invoke(request(), AUTH)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_EVIDENCE_TARGET_SEARCH_UNAVAILABLE" })
    expect(logWorkforceSensitiveOperationFailure).toHaveBeenCalledWith({ operation: "search-evidence-timeline-targets" })
  })
})
