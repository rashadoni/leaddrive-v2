import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionAuth: vi.fn((_action, handler) => handler),
}))
vi.mock("@/lib/workforce/actor", () => ({ resolveWorkforceActor: vi.fn() }))
vi.mock("@/lib/workforce/timesheet-approval-service", () => ({
  WorkforceTimesheetApprovalRequestSchema: {
    safeParse: vi.fn((value: unknown) => (
      value && typeof value === "object" && (value as { agentId?: unknown }).agentId
        ? { success: true, data: value }
        : { success: false, error: { issues: [{ message: "Invalid timesheet approval" }] } }
    )),
  },
  approveWorkforceTimesheet: vi.fn(),
}))

import { POST as approvalPost } from "@/app/api/v1/workforce/timesheet/approvals/route"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { resolveWorkforceActor } from "@/lib/workforce/actor"
import { approveWorkforceTimesheet } from "@/lib/workforce/timesheet-approval-service"

const AUTH = {
  orgId: "org-workforce",
  userId: "manager-user",
  role: "manager",
  email: "manager@example.test",
  name: "Workforce Manager",
  principalType: "session" as const,
}

function post(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/workforce/timesheet/approvals", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "vitest" },
    body: JSON.stringify(body),
  })
}

const invoke = approvalPost as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>

beforeEach(() => {
  // Keep the module-construction call intact: it proves this route uses the
  // session-only boundary rather than the API-key-capable Workforce wrapper.
  vi.mocked(resolveWorkforceActor).mockReset()
  vi.mocked(approveWorkforceTimesheet).mockReset()
  vi.mocked(resolveWorkforceActor).mockResolvedValue({
    agentId: "manager-agent",
    role: "MANAGER",
    scopedAgentIds: ["employee-1"],
  })
})

describe("POST /api/v1/workforce/timesheet/approvals", () => {
  it("is a session-only Workforce write boundary and delegates a server-derived approval", async () => {
    vi.mocked(approveWorkforceTimesheet).mockResolvedValue({
      kind: "success",
      idempotent: false,
      data: {
        id: "approval-1",
        revision: 1,
        recordKind: "APPROVAL",
        periodStart: "2026-08-28",
        periodEnd: "2026-08-28",
        agentId: "employee-1",
        rowsHash: "a".repeat(64),
        factsHash: "b".repeat(64),
        calculationVersion: 1,
      },
    } as never)

    const response = await invoke(post({
      agentId: "employee-1",
      periodStart: "2026-08-28",
      periodEnd: "2026-08-28",
    }), AUTH)

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ success: true, idempotent: false, data: { id: "approval-1" } })
    expect(withWorkforceSessionAuth).toHaveBeenCalledWith("write", expect.any(Function))
    expect(approveWorkforceTimesheet).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-workforce",
      userId: "manager-user",
      input: { agentId: "employee-1", periodStart: "2026-08-28", periodEnd: "2026-08-28" },
      audit: expect.objectContaining({ userAgent: "vitest" }),
    }))
  })

  it("does not turn a missing actor mapping into an approval path", async () => {
    vi.mocked(resolveWorkforceActor).mockResolvedValue(null)

    const response = await invoke(post({
      agentId: "employee-1", periodStart: "2026-08-28", periodEnd: "2026-08-28",
    }), AUTH)

    expect(response.status).toBe(403)
    expect(approveWorkforceTimesheet).not.toHaveBeenCalled()
  })

  it("returns immutable-history/finality failures as an explicit conflict", async () => {
    vi.mocked(approveWorkforceTimesheet).mockResolvedValue({
      kind: "conflict",
      code: "WORKFORCE_TIMESHEET_APPROVAL_HISTORY_INVALID",
      message: "A recorded workday cannot be reproduced from its immutable history",
    } as never)

    const response = await invoke(post({
      agentId: "employee-1", periodStart: "2026-08-28", periodEnd: "2026-08-28",
    }), AUTH)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "WORKFORCE_TIMESHEET_APPROVAL_HISTORY_INVALID" })
  })
})
