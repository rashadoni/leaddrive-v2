import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: { workforceExceptionCase: { findMany: vi.fn() } },
}))
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionAdminAuth: vi.fn((handler) => handler),
}))

import { GET } from "@/app/api/v1/workforce/exceptions/route"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"

const AUTH = { orgId: "org-workforce", userId: "admin-1", role: "admin" }
const callGet = GET as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>

function caseRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "case-00000001",
    kind: "NO_SHOW",
    createdAt: new Date("2026-08-30T09:00:00.000Z"),
    evidenceId: "evidence-1",
    agent: { name: "Aysel Aliyeva" },
    decisions: [{ decisionCode: "ACKNOWLEDGE" }],
    ...overrides,
  }
}

beforeEach(() => vi.mocked(prisma.workforceExceptionCase.findMany).mockReset())

describe("Workforce read-only exception queue API", () => {
  it("uses the session-admin boundary and returns a tenant-scoped raw-proof-free projection", async () => {
    vi.mocked(prisma.workforceExceptionCase.findMany).mockResolvedValue([
      caseRecord({
        // A mocked database row may contain extra data, but the route must not
        // select or return it as part of the review projection.
        rawLocation: "RAW_LOCATION_MUST_NOT_LEAK",
        qrPayload: "RAW_QR_MUST_NOT_LEAK",
        decisionReason: "RAW_REASON_MUST_NOT_LEAK",
      }),
    ] as never)

    const response = await callGet(new NextRequest("http://localhost:3000/api/v1/workforce/exceptions"), AUTH)

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      data: {
        disposition: "READ_ONLY_HUMAN_REVIEW_REQUIRED",
        cases: [{
          displayReference: "WF-00000001",
          employeeDisplayName: "Aysel Aliyeva",
          type: "NO_SHOW",
          triageSeverity: "ATTENTION_REVIEW",
          stage: "HR_REVIEW",
          evidenceState: "LINKED_RESTRICTED",
          employeeResponse: "NOT_REQUESTED",
          nextAction: "HUMAN_REVIEW_REQUIRED",
        }],
      },
    })
    expect(JSON.stringify(body)).not.toMatch(/RAW_LOCATION|RAW_QR|RAW_REASON|evidence-1|case-00000001/)
    expect(prisma.workforceExceptionCase.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: AUTH.orgId },
      take: 251,
      select: expect.objectContaining({
        evidenceId: true,
        agent: { select: { name: true } },
        decisions: expect.objectContaining({ select: { decisionCode: true } }),
      }),
    }))
    expect(withWorkforceSessionAdminAuth).toHaveBeenCalledTimes(1)
  })

  it("fails closed instead of silently truncating an unbounded review queue", async () => {
    vi.mocked(prisma.workforceExceptionCase.findMany).mockResolvedValue(
      Array.from({ length: 251 }, () => caseRecord()) as never,
    )

    const response = await callGet(new NextRequest("http://localhost:3000/api/v1/workforce/exceptions"), AUTH)

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      error: "Too many exception cases for one safe review page; narrow the review window first",
      code: "WORKFORCE_EXCEPTION_QUEUE_LIMIT_EXCEEDED",
    })
  })
})
