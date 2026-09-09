import { beforeEach, describe, expect, it, vi } from "vitest"

const teamQueueFindFirst = vi.hoisted(() => vi.fn())
const teamQueueUpdateMany = vi.hoisted(() => vi.fn())
const userFindMany = vi.hoisted(() => vi.fn())
const conversationFindFirst = vi.hoisted(() => vi.fn())
const conversationGroupBy = vi.hoisted(() => vi.fn())
const conversationUpdateMany = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    teamQueue: {
      findFirst: teamQueueFindFirst,
      updateMany: teamQueueUpdateMany,
    },
    user: {
      findMany: userFindMany,
    },
    socialConversation: {
      findFirst: conversationFindFirst,
      groupBy: conversationGroupBy,
      updateMany: conversationUpdateMany,
    },
  },
}))

import { routeConversation } from "@/lib/inbox/conversation-routing"

const queue = (overrides: Record<string, unknown> = {}) => ({
  id: "q_1",
  name: "Support",
  skillTags: ["support"],
  strategy: "least_loaded",
  lastAssignedTo: null,
  ...overrides,
})

const agent = (id: string, name: string, skills: string[], maxTickets = 20) => ({
  id,
  name,
  email: `${id}@example.test`,
  skills,
  maxTickets,
})

beforeEach(() => {
  vi.clearAllMocks()
  teamQueueFindFirst.mockResolvedValue(queue())
  teamQueueUpdateMany.mockResolvedValue({ count: 1 })
  userFindMany.mockResolvedValue([
    agent("u_1", "Alice", ["support"]),
    agent("u_2", "Bob", ["support"]),
  ])
  conversationFindFirst.mockResolvedValue({ assignedTo: null, metadata: { existing: true } })
  conversationGroupBy.mockResolvedValue([
    { assignedTo: "u_1", _count: { id: 3 } },
    { assignedTo: "u_2", _count: { id: 1 } },
  ])
  conversationUpdateMany.mockResolvedValue({ count: 1 })
})

describe("routeConversation", () => {
  it("routes to the least-loaded available skilled agent and writes tenant-scoped assignedTo", async () => {
    const result = await routeConversation({ organizationId: "org_1", conversationId: "c_1", queueId: "q_1" })

    expect(result).toEqual({
      routed: true,
      queueId: "q_1",
      queueName: "Support",
      strategy: "least_loaded",
      assignedTo: "u_2",
      agentName: "Bob",
      load: 1,
    })
    expect(teamQueueFindFirst).toHaveBeenCalledWith({
      where: { id: "q_1", organizationId: "org_1", isActive: true },
      select: { id: true, name: true, skillTags: true, strategy: true, lastAssignedTo: true },
    })
    expect(userFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org_1", isActive: true, isAvailable: true }),
    }))
    expect(conversationGroupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org_1", assignedTo: { in: ["u_1", "u_2"] } }),
    }))
    expect(conversationUpdateMany).toHaveBeenCalledWith({
      where: { id: "c_1", organizationId: "org_1" },
      data: {
        assignedTo: "u_2",
        metadata: expect.objectContaining({
          existing: true,
          routing: expect.objectContaining({
            queueId: "q_1",
            queueName: "Support",
            strategy: "least_loaded",
            assignedTo: "u_2",
            previousAssignedTo: null,
            assignedAt: expect.any(String),
          }),
        }),
      },
    })
  })

  it("respects maxTickets capacity", async () => {
    userFindMany.mockResolvedValue([agent("u_1", "Alice", ["support"], 3)])
    conversationGroupBy.mockResolvedValue([{ assignedTo: "u_1", _count: { id: 3 } }])

    const result = await routeConversation({ organizationId: "org_1", conversationId: "c_1", queueId: "q_1" })

    expect(result).toEqual({ routed: false, reason: "no_available_agent" })
    expect(conversationUpdateMany).not.toHaveBeenCalled()
  })

  it("uses stable round-robin order and updates lastAssignedTo after a successful assignment", async () => {
    teamQueueFindFirst.mockResolvedValue(queue({ strategy: "round_robin", lastAssignedTo: "u_1" }))
    userFindMany.mockResolvedValue([
      agent("u_1", "Alice", ["support"]),
      agent("u_2", "Bob", ["support"]),
      agent("u_3", "Charlie", ["support"]),
    ])
    conversationGroupBy.mockResolvedValue([])

    const result = await routeConversation({ organizationId: "org_1", conversationId: "c_1", queueId: "q_1" })

    expect(result).toMatchObject({ routed: true, assignedTo: "u_2", strategy: "round_robin" })
    expect(teamQueueUpdateMany).toHaveBeenCalledWith({
      where: { id: "q_1", organizationId: "org_1" },
      data: { lastAssignedTo: "u_2" },
    })
  })

  it("skill_match prefers the right-fit agent before load tie-breaks", async () => {
    teamQueueFindFirst.mockResolvedValue(queue({ strategy: "skill_match", skillTags: ["billing"] }))
    userFindMany.mockResolvedValue([
      agent("u_1", "Alice", ["billing", "vip"]),
      agent("u_2", "Bob", ["billing"]),
    ])
    conversationGroupBy.mockResolvedValue([{ assignedTo: "u_2", _count: { id: 1 } }])

    const result = await routeConversation({ organizationId: "org_1", conversationId: "c_1", queueId: "q_1" })

    expect(result).toMatchObject({ routed: true, assignedTo: "u_2", strategy: "skill_match", load: 1 })
  })

  it("returns no_queue for missing/inactive/cross-tenant queues", async () => {
    teamQueueFindFirst.mockResolvedValue(null)

    const result = await routeConversation({ organizationId: "org_1", conversationId: "c_1", queueId: "q_other" })

    expect(result).toEqual({ routed: false, reason: "no_queue" })
    expect(userFindMany).not.toHaveBeenCalled()
  })

  it("returns conversation_not_found when the final org-scoped assignment matches no row", async () => {
    conversationUpdateMany.mockResolvedValue({ count: 0 })

    const result = await routeConversation({ organizationId: "org_1", conversationId: "missing", queueId: "q_1" })

    expect(result).toEqual({ routed: false, reason: "conversation_not_found" })
  })

  it("can exclude the current assignee during reroute fallback", async () => {
    conversationFindFirst.mockResolvedValue({ assignedTo: "u_1", metadata: {} })

    const result = await routeConversation({
      organizationId: "org_1",
      conversationId: "c_1",
      queueId: "q_1",
      excludeUserIds: ["u_1"],
    })

    expect(result).toMatchObject({ routed: true, assignedTo: "u_2" })
    expect(conversationGroupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ assignedTo: { in: ["u_2"] } }),
    }))
  })
})
