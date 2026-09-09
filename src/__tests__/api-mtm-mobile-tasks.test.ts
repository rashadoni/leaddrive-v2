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

import { GET } from "@/app/api/v1/mtm/mobile/tasks/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const request = (query = "") => new NextRequest(`http://localhost/api/v1/mtm/mobile/tasks${query}`, {
  headers: { Authorization: "Bearer mobile" },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockReturnValue({ orgId: "org-1", agentId: "agent-1" } as never)
  vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
})

describe("GET /api/v1/mtm/mobile/tasks", () => {
  it("returns only the authenticated agent's tasks and self-service capabilities", async () => {
    const response = await GET(request("?search=clinic&limit=999"))
    expect(response.status).toBe(200)
    expect(prisma.mtmTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        agentId: "agent-1",
        deletedAt: null,
        OR: expect.any(Array),
      }),
      take: 200,
    }))
    const body = await response.json()
    expect(body.data.capabilities).toEqual({ createSelfTask: true, recurringTasks: true })
  })

  it("computes overdue for display without rewriting the persisted status", async () => {
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([{
      id: "task-1",
      title: "Follow up",
      description: null,
      status: "PENDING",
      dueDate: new Date("2020-01-01T00:00:00.000Z"),
      sourceKey: null,
      priority: "HIGH",
      events: [],
    }] as never)
    const body = await (await GET(request())).json()
    expect(body.data.tasks[0]).toMatchObject({ status: "OVERDUE", persistedStatus: "PENDING", canEditContent: false })
  })

  it("fails closed when the mobile token is missing", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(null as never)
    expect((await GET(request())).status).toBe(401)
  })
})
