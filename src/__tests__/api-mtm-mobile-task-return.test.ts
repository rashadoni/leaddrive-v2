import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

vi.mock("@/lib/mtm-audit", () => ({ writeMtmAudit: vi.fn(() => Promise.resolve()) }))

vi.mock("@/lib/mtm/territory-scope", () => ({ resolveAgentScope: vi.fn() }))

import { POST } from "@/app/api/v1/mtm/mobile/tasks/[id]/return/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"

const ORG = "org-1"
const MANAGER = { orgId: ORG, agentId: "mgr-1", userId: "u-1", email: "m@x.co", name: "Mgr", role: "MANAGER" }

function req(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/mtm/mobile/tasks/task-1/return", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer valid" },
    body: JSON.stringify(body),
  })
}
const params = (id = "task-1") => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(MANAGER as never)
  vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: ["agent-1"] } as never)
  vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({
    id: "task-1", agentId: "agent-1", title: "Visit", status: "COMPLETED", result: "photo evidence",
    completedAt: new Date("2026-08-01T10:00:00.000Z"), returnReason: null, version: 1,
  } as never)
  vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmNotification.create).mockResolvedValue({ id: "n-1" } as never)
})

describe("POST /api/v1/mtm/mobile/tasks/[id]/return", () => {
  it("rejects an AGENT caller without TEAM_DECIDE", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({ ...MANAGER, role: "AGENT" } as never)
    const res = await POST(req({ reason: "redo", expectedVersion: 1 }), params())
    expect(res.status).toBe(403)
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })

  it("reopens a completed task, records the reason, keeps result, notifies", async () => {
    const res = await POST(req({ reason: "photos missing", expectedVersion: 1 }), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, data: { status: "IN_PROGRESS", returnReason: "photos missing" } })
    const call = vi.mocked(prisma.mtmTask.updateMany).mock.calls[0][0]
    expect(call.data).toMatchObject({ status: "IN_PROGRESS", completedAt: null, returnReason: "photos missing" })
    expect(call.where).toMatchObject({ status: "COMPLETED" })
    expect(call.data).not.toHaveProperty("result") // prior evidence preserved
    expect(prisma.mtmNotification.create).toHaveBeenCalledTimes(1)
  })

  it("refuses to return a task that is not completed", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({
      id: "task-1", agentId: "agent-1", title: "Visit", status: "IN_PROGRESS", result: "photo evidence",
      completedAt: null, returnReason: null, version: 1,
    } as never)
    const res = await POST(req({ reason: "x", expectedVersion: 1 }), params())
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("MTM_TASK_NOT_RETURNABLE")
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })

  it("forbids returning a task owned by an out-of-scope agent", async () => {
    vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: ["someone-else"] } as never)
    const res = await POST(req({ reason: "x", expectedVersion: 1 }), params())
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("MTM_TASK_SCOPE_DENIED")
  })

  it("returns 404 when the task does not exist", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(null as never)
    expect((await POST(req({ reason: "x", expectedVersion: 1 }), params())).status).toBe(404)
  })

  it("requires a non-empty reason", async () => {
    expect((await POST(req({ reason: "", expectedVersion: 1 }), params())).status).toBe(400)
    expect((await POST(req({ expectedVersion: 1 }), params())).status).toBe(400)
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })
})
