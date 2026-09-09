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

import { PATCH } from "@/app/api/v1/mtm/mobile/tasks/[id]/progress/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"

const ORG = "org-1"
const AGENT = { orgId: ORG, agentId: "agent-1", userId: "u-1", email: "a@x.co", name: "Agent", role: "AGENT" }

function req(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/mtm/mobile/tasks/task-1/progress", {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: "Bearer valid" },
    body: JSON.stringify(body),
  })
}
const params = (id = "task-1") => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(AGENT as never)
  vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({ id: "task-1", progress: 20, status: "PENDING", version: 2 } as never)
  vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as never)
})

describe("PATCH /api/v1/mtm/mobile/tasks/[id]/progress", () => {
  it("denies a manager token even when the task is assigned to that manager", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({ ...AGENT, role: "MANAGER" } as never)

    const res = await PATCH(req({ progress: 75 }), params())

    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("MTM_MOBILE_CAPABILITY_REQUIRED")
    expect(prisma.mtmTask.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })

  it("updates the caller's own task progress", async () => {
    const res = await PATCH(req({ progress: 75 }), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, data: { id: "task-1", progress: 75 } })
    const call = vi.mocked(prisma.mtmTask.updateMany).mock.calls[0][0]
    expect(call.data).toMatchObject({ progress: 75 })
    // own-task scope must be enforced in the update filter
    expect(call.where).toMatchObject({ organizationId: ORG, agentId: "agent-1" })
  })

  it("returns 404 when the task is not the caller's own (or missing)", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(null as never)
    const res = await PATCH(req({ progress: 50 }), params())
    expect(res.status).toBe(404)
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })

  it("replays an exact no-version progress retry without another version or event", async () => {
    const response = await PATCH(req({ progress: 20 }), params())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: { id: "task-1", progress: 20, version: 2, idempotent: true },
    })
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmTaskEvent.create).not.toHaveBeenCalled()
  })

  it("rejects out-of-range progress", async () => {
    expect((await PATCH(req({ progress: 150 }), params())).status).toBe(400)
    expect((await PATCH(req({ progress: -5 }), params())).status).toBe(400)
    expect((await PATCH(req({ progress: 33.5 }), params())).status).toBe(400)
    expect((await PATCH(req({}), params())).status).toBe(400)
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })
})
