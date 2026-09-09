import { describe, it, expect, vi, beforeEach, type Mock } from "vitest"
import { NextRequest } from "next/server"

/**
 * E1 canary observability — recent ConversationFlowRun read API.
 * Covers tenant scoping, flowId filtering, limit clamp, and org-scoped conversation summaries.
 */
const db: {
  runs: Record<string, unknown>[]
  conversations: Record<string, unknown>[]
} = {
  runs: [],
  conversations: [],
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversationFlowRun: {
      findMany: vi.fn(async () => db.runs),
    },
    socialConversation: {
      findMany: vi.fn(async () => db.conversations),
    },
  },
}))

vi.mock("@/lib/with-rls", () => ({
  withRls:
    (
      h: (
        req: NextRequest,
        scope: { orgId: string },
        ctx?: unknown,
      ) => unknown,
    ) =>
    (req: NextRequest, ctx?: unknown) =>
      h(req, { orgId: "org_1" }, ctx),
}))

import { GET } from "@/app/api/v1/conversation-flows/runs/route"

const get = (path = "http://localhost/api/v1/conversation-flows/runs") => new NextRequest(path)

beforeEach(() => {
  db.runs = []
  db.conversations = []
  vi.clearAllMocks()
})

describe("GET /conversation-flows/runs", () => {
  it("lists recent org-scoped flow runs with flow and conversation summaries", async () => {
    const startedAt = new Date("2026-06-24T10:00:00.000Z")
    const updatedAt = new Date("2026-06-24T10:00:03.000Z")
    db.runs = [
      {
        id: "run_1",
        organizationId: "org_1",
        flowId: "flow_1",
        conversationId: "conv_1",
        status: "completed",
        currentNodeId: null,
        state: { steps: [{ nodeId: "a1" }, { nodeId: "a2" }], stop: "end" },
        startedAt,
        updatedAt,
        flow: {
          id: "flow_1",
          name: "Inbound triage",
          trigger: "message_inbound",
          status: "active",
        },
      },
    ]
    db.conversations = [
      {
        id: "conv_1",
        platform: "telegram",
        contactName: "Customer",
        status: "open",
        lastMessageAt: updatedAt,
      },
    ]

    const res = await GET(get())

    expect(res.status).toBe(200)
    const { prisma } = await import("@/lib/prisma")
    const findRuns = prisma.conversationFlowRun.findMany as unknown as Mock
    const findConversations = prisma.socialConversation.findMany as unknown as Mock
    expect(findRuns.mock.calls[0][0]).toMatchObject({
      where: { organizationId: "org_1" },
      take: 20,
      orderBy: [{ startedAt: "desc" }],
    })
    expect(findConversations.mock.calls[0][0]).toMatchObject({
      where: { organizationId: "org_1", id: { in: ["conv_1"] } },
    })
    const body = await res.json()
    expect(body.data[0]).toMatchObject({
      id: "run_1",
      status: "completed",
      summary: { stepCount: 2, stop: "end" },
      flow: { name: "Inbound triage" },
      conversation: { platform: "telegram", contactName: "Customer" },
    })
  })

  it("filters by flowId and clamps limit to 50", async () => {
    await GET(get("http://localhost/api/v1/conversation-flows/runs?flowId=flow_2&limit=999"))

    const { prisma } = await import("@/lib/prisma")
    const findRuns = prisma.conversationFlowRun.findMany as unknown as Mock
    expect(findRuns.mock.calls[0][0]).toMatchObject({
      where: { organizationId: "org_1", flowId: "flow_2" },
      take: 50,
    })
  })

  it("skips the conversation lookup when there are no runs", async () => {
    const res = await GET(get())

    expect(res.status).toBe(200)
    const { prisma } = await import("@/lib/prisma")
    expect(prisma.socialConversation.findMany).not.toHaveBeenCalled()
    expect((await res.json()).data).toEqual([])
  })
})
