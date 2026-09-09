import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticketQueue: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    ticket: {
      groupBy: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

import { autoAssignTicket } from "@/lib/auto-assign"
import { prisma } from "@/lib/prisma"

describe("autoAssignTicket", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("assigns to least-loaded agent matching queue skills", async () => {
    vi.mocked(prisma.ticketQueue.findMany).mockResolvedValue([
      { id: "q1", organizationId: "org1", name: "Tech", skills: ["technical"], priority: 1, isActive: true, autoAssign: true, assignMethod: "least_loaded", lastAssignedTo: null, maxTickets: 10, createdAt: new Date(), updatedAt: new Date() },
    ] as any)

    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "a1", name: "Alice", email: "a@test.com", skills: ["technical"], maxTickets: 5 },
      { id: "a2", name: "Bob", email: "b@test.com", skills: ["technical"], maxTickets: 5 },
    ] as any)

    vi.mocked(prisma.ticket.groupBy).mockResolvedValue([
      { assignedTo: "a1", _count: { id: 3 } },
      { assignedTo: "a2", _count: { id: 1 } },
    ] as any)

    vi.mocked(prisma.ticket.updateMany).mockResolvedValue({ count: 1 })

    const result = await autoAssignTicket("t1", "org1", "technical")

    expect(result.assigned).toBe(true)
    expect(result.agentId).toBe("a2") // Bob has fewer tickets
    expect(result.agentName).toBe("Bob")
    expect(result.queueName).toBe("Tech")
  })

  it("respects maxTickets limit", async () => {
    vi.mocked(prisma.ticketQueue.findMany).mockResolvedValue([
      { id: "q1", organizationId: "org1", name: "Support", skills: ["general"], priority: 1, isActive: true, autoAssign: true, assignMethod: "least_loaded", lastAssignedTo: null, maxTickets: 10, createdAt: new Date(), updatedAt: new Date() },
    ] as any)

    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "a1", name: "Alice", email: "a@test.com", skills: ["general"], maxTickets: 2 },
    ] as any)

    // Alice is at max capacity
    vi.mocked(prisma.ticket.groupBy).mockResolvedValue([
      { assignedTo: "a1", _count: { id: 2 } },
    ] as any)

    const result = await autoAssignTicket("t1", "org1", "general")

    expect(result.assigned).toBe(false)
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled()
  })

  it("uses round-robin when configured", async () => {
    vi.mocked(prisma.ticketQueue.findMany).mockResolvedValue([
      { id: "q1", organizationId: "org1", name: "Support", skills: ["billing"], priority: 1, isActive: true, autoAssign: true, assignMethod: "round_robin", lastAssignedTo: "a1", maxTickets: 10, createdAt: new Date(), updatedAt: new Date() },
    ] as any)

    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "a1", name: "Alice", email: "a@test.com", skills: ["billing"], maxTickets: 10 },
      { id: "a2", name: "Bob", email: "b@test.com", skills: ["billing"], maxTickets: 10 },
      { id: "a3", name: "Charlie", email: "c@test.com", skills: ["billing"], maxTickets: 10 },
    ] as any)

    vi.mocked(prisma.ticket.groupBy).mockResolvedValue([] as any)
    vi.mocked(prisma.ticket.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.ticketQueue.update).mockResolvedValue({} as any)

    const result = await autoAssignTicket("t1", "org1", "billing")

    // Last was a1, so next should be a2
    expect(result.assigned).toBe(true)
    expect(result.agentId).toBe("a2")
  })

  it("falls back to least-loaded when no queue matches", async () => {
    vi.mocked(prisma.ticketQueue.findMany).mockResolvedValue([] as any)

    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "a1", name: "Alice", email: "a@test.com", maxTickets: 10 },
    ] as any)

    vi.mocked(prisma.ticket.groupBy).mockResolvedValue([] as any)
    vi.mocked(prisma.ticket.updateMany).mockResolvedValue({ count: 1 })

    const result = await autoAssignTicket("t1", "org1", "unknown_category")

    expect(result.assigned).toBe(true)
    expect(result.agentId).toBe("a1")
  })

  it("returns not assigned when no agents available", async () => {
    vi.mocked(prisma.ticketQueue.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)

    const result = await autoAssignTicket("t1", "org1", "technical")

    expect(result.assigned).toBe(false)
  })
})
