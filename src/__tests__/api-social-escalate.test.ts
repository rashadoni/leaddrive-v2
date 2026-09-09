import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteContext = { params: Promise<{ id: string }> }
type RouteHandler = (req: NextRequest, auth: AuthContext, ctx: RouteContext) => Promise<Response>

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest, ctx: RouteContext) => handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }, ctx),
}))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: async (
    _organizationId: string,
    mutate: () => Promise<unknown>,
  ) => ({ allowed: true, value: await mutate() }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialMention: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    task: {
      create: vi.fn(),
    },
    aiAlert: {
      create: vi.fn(),
    },
  },
  logAudit: vi.fn(),
}))

import { POST } from "@/app/api/v1/social/mentions/[id]/escalate/route"
import { logAudit, prisma } from "@/lib/prisma"

const findMention = vi.mocked(prisma.socialMention.findFirst)
const createTask = vi.mocked(prisma.task.create)
const createAlert = vi.mocked(prisma.aiAlert.create)
const updateMention = vi.mocked(prisma.socialMention.update)
const audit = vi.mocked(logAudit)

function request(body?: unknown) {
  return new NextRequest("http://localhost/api/v1/social/mentions/mention-1/escalate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const ctx: RouteContext = { params: Promise.resolve({ id: "mention-1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  findMention.mockResolvedValue({
    id: "mention-1",
    organizationId: "org-1",
    platform: "facebook",
    sourceProvider: "native",
    authorName: "Nigar",
    authorHandle: "nigar",
    url: "https://facebook.test/post/1",
    sentiment: "negative",
    text: "This needs urgent review",
    taskId: null,
    status: "new",
  })
  createTask.mockResolvedValue({ id: "task-1" })
  createAlert.mockResolvedValue({ id: "alert-1" })
  updateMention.mockResolvedValue({ id: "mention-1" })
})

describe("POST /api/v1/social/mentions/[id]/escalate", () => {
  it("creates a task and alert, then marks the mention reviewed", async () => {
    const res = await POST(request({ reason: "Critical complaint" }), ctx)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toEqual({ taskId: "task-1" })
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        priority: "high",
        assignedTo: "user-1",
        relatedType: "social_mention",
        relatedId: "mention-1",
      }),
    }))
    expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        type: "social_manual_escalation",
        severity: "critical",
      }),
    }))
    expect(updateMention).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "mention-1" },
      data: expect.objectContaining({
        taskId: "task-1",
        status: "reviewed",
        handledBy: "user-1",
      }),
    }))
    expect(audit).toHaveBeenCalledWith(
      "org-1",
      "social_mention_escalated",
      "social_mention",
      "mention-1",
      "facebook",
      expect.objectContaining({ newValue: { taskId: "task-1", reason: "Critical complaint" } }),
    )
  })
})
