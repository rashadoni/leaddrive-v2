import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((value: unknown) => value instanceof NextResponse),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticket: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}))

import { GET } from "@/app/api/v1/support/agent-desktop/route"
import { requireAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const auth = {
  orgId: "org-1",
  userId: "agent-1",
  role: "support",
  email: "agent@example.com",
  name: "Agent",
}

function request() {
  return new NextRequest("http://localhost:3000/api/v1/support/agent-desktop")
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(auth as never)
  vi.mocked(prisma.ticket.findMany)
    .mockResolvedValueOnce([] as never)
    .mockResolvedValueOnce([] as never)
  vi.mocked(prisma.ticket.groupBy).mockResolvedValue([] as never)
})

describe("GET /api/v1/support/agent-desktop", () => {
  it("gates the route with ticket read permission and scopes every query to this agent", async () => {
    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "tickets", "read")
    for (const [query] of vi.mocked(prisma.ticket.findMany).mock.calls) {
      expect(query?.where).toEqual(expect.objectContaining({
        organizationId: "org-1",
        assignedTo: "agent-1",
      }))
    }
    expect(vi.mocked(prisma.ticket.groupBy).mock.calls[0][0]?.where).toEqual(expect.objectContaining({
      organizationId: "org-1",
      assignedTo: "agent-1",
    }))
  })

  it("returns null—not invented zeroes—when the metric cohort is empty", async () => {
    const response = await GET(request())
    const body = await response.json()

    expect(body.data.scope).toBe("assigned_to_current_user")
    expect(body.data.period).toEqual(expect.objectContaining({ key: "rolling_30_days", days: 30 }))
    expect(body.data.metrics).toEqual(expect.objectContaining({
      averageFirstResponseSeconds: null,
      averageResolutionSeconds: null,
      resolutionRatePct: null,
      slaCompliancePct: null,
      csatAverage: null,
    }))
    expect(body.data.canViewTeamAnalytics).toBe(false)
  })

  it("returns a compact prioritized preview while preserving the full queue count", async () => {
    const activeRows = Array.from({ length: 10 }, (_, index) => ({
      id: `ticket-${index}`,
      ticketNumber: `SUP-${index}`,
      subject: `Ticket ${index}`,
      priority: "medium",
      status: "open",
      createdAt: new Date(`2026-09-${String(index + 1).padStart(2, "0")}T08:00:00Z`),
      updatedAt: new Date(`2026-09-${String(index + 1).padStart(2, "0")}T09:00:00Z`),
      slaFirstResponseDueAt: null,
      slaDueAt: null,
      firstResponseAt: null,
    }))
    vi.mocked(prisma.ticket.findMany).mockReset()
    vi.mocked(prisma.ticket.findMany)
      .mockResolvedValueOnce(activeRows as never)
      .mockResolvedValueOnce([] as never)

    const response = await GET(request())
    const body = await response.json()

    expect(body.data.queue.total).toBe(10)
    expect(body.data.queue.shown).toBe(8)
    expect(body.data.queue.tickets).toHaveLength(8)
    expect(body.data.queue.nextTicket.id).toBe("ticket-0")
  })

  it("denies before querying when authorization fails", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }) as never,
    )

    const response = await GET(request())
    expect(response.status).toBe(403)
    expect(prisma.ticket.findMany).not.toHaveBeenCalled()
  })
})
