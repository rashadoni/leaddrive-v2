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

vi.mock("@/lib/mtm/territory-scope", () => ({ resolveAgentScope: vi.fn() }))

import { GET } from "@/app/api/v1/mtm/mobile/tasks/[id]/documents/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"

const ORG = "org-1"
const AGENT = { orgId: ORG, agentId: "agent-1", userId: "u-1", email: "a@x.co", name: "Agent", role: "AGENT" }
const MANAGER = { orgId: ORG, agentId: "mgr-1", userId: "u-2", email: "m@x.co", name: "Mgr", role: "MANAGER" }

const req = () => new NextRequest("http://localhost:3000/api/v1/mtm/mobile/tasks/task-1/documents", { headers: { authorization: "Bearer valid" } })
const params = (id = "task-1") => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(AGENT as never)
  vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: ["agent-1"] } as never)
  vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({ id: "task-1", agentId: "agent-1" } as never)
  vi.mocked(prisma.mtmDocument.findMany).mockResolvedValue([
    { id: "d1", title: null, fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 1234, uploadedByAgentId: "agent-1", createdAt: new Date() },
  ] as never)
})

describe("GET /api/v1/mtm/mobile/tasks/[id]/documents", () => {
  it("returns documents for the caller's own task", async () => {
    const res = await GET(req(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.documents).toHaveLength(1)
    const where = vi.mocked(prisma.mtmDocument.findMany).mock.calls[0][0].where
    expect(where).toMatchObject({ taskId: "task-1", organizationId: ORG })
  })

  it("forbids an agent from viewing another agent's task files", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({ id: "task-1", agentId: "someone-else" } as never)
    const res = await GET(req(), params())
    expect(res.status).toBe(403)
    expect(prisma.mtmDocument.findMany).not.toHaveBeenCalled()
  })

  it("lets an in-scope manager view a team member's task files", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(MANAGER as never)
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({ id: "task-1", agentId: "agent-1" } as never)
    vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: ["agent-1", "agent-2"] } as never)
    const res = await GET(req(), params())
    expect(res.status).toBe(200)
  })

  it("forbids a manager whose scope excludes the task's agent", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(MANAGER as never)
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({ id: "task-1", agentId: "agent-9" } as never)
    vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: ["agent-1"] } as never)
    const res = await GET(req(), params())
    expect(res.status).toBe(403)
    expect(prisma.mtmDocument.findMany).not.toHaveBeenCalled()
  })

  it("returns 404 when the task does not exist", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue(null as never)
    expect((await GET(req(), params())).status).toBe(404)
  })
})
