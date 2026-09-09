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

import { POST } from "@/app/api/v1/mtm/mobile/tasks/bulk-reassign/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"

const ORG = "org-1"
const MANAGER = { orgId: ORG, agentId: "mgr-1", userId: "u-1", email: "m@x.co", name: "Mgr", role: "MANAGER" }

function req(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/mtm/mobile/tasks/bulk-reassign", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer valid" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(MANAGER as never)
  vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: ["agent-1", "agent-2"] } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-2" } as never)
  vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([
    { id: "t1", agentId: "agent-1", visitId: "visit-1", status: "PENDING", version: 1 },
    { id: "t2", agentId: "agent-1", visitId: null, status: "IN_PROGRESS", version: 2 },
  ] as never)
  vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)
})

describe("POST /api/v1/mtm/mobile/tasks/bulk-reassign", () => {
  it("rejects an AGENT caller without TEAM_DECIDE", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({ ...MANAGER, role: "AGENT" } as never)
    const res = await POST(req({ taskIds: ["t1"], agentId: "agent-2", expectedVersions: { t1: 1 } }))
    expect(res.status).toBe(403)
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })

  it("reassigns in-scope tasks and returns the moved count", async () => {
    const res = await POST(req({ taskIds: ["t1", "t2"], agentId: "agent-2", expectedVersions: { t1: 1, t2: 2 } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, data: { reassigned: 2, agentId: "agent-2" } })
    const call = vi.mocked(prisma.mtmTask.updateMany).mock.calls[0][0]
    expect(call.data).toMatchObject({ agentId: "agent-2", visitId: null, version: { increment: 1 } })
    expect(call.where).toMatchObject({ organizationId: ORG })
    expect(call.where.agentId).toBe("agent-1")
    expect(call.where.id).toBe("t1")
    const scopedRead = vi.mocked(prisma.mtmTask.findMany).mock.calls[0][0]
    expect(scopedRead.where.agentId).toEqual({ in: ["agent-1", "agent-2"] })
    expect(scopedRead.where.id).toEqual({ in: ["t1", "t2"] })
  })

  it("admin scope (agentIds null) reassigns without an owner filter", async () => {
    vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: null } as never)
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([
      { id: "t1", agentId: "agent-1", visitId: null, status: "PENDING", version: 1 },
    ] as never)
    await POST(req({ taskIds: ["t1"], agentId: "agent-2", expectedVersions: { t1: 1 } }))
    const call = vi.mocked(prisma.mtmTask.findMany).mock.calls[0][0]
    expect(call.where.agentId).toBeUndefined()
  })

  it("forbids reassigning to an out-of-scope target agent", async () => {
    const res = await POST(req({ taskIds: ["t1"], agentId: "agent-99", expectedVersions: { t1: 1 } }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("MTM_TASK_SCOPE_DENIED")
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })

  it("returns 404 when the target agent is missing/inactive", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null as never)
    const res = await POST(req({ taskIds: ["t1"], agentId: "agent-2", expectedVersions: { t1: 1 } }))
    expect(res.status).toBe(404)
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })

  it("rejects an empty task list", async () => {
    expect((await POST(req({ taskIds: [], agentId: "agent-2", expectedVersions: {} }))).status).toBe(400)
    expect((await POST(req({ agentId: "agent-2", expectedVersions: {} }))).status).toBe(400)
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })
})
