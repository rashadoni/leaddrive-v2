import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: { ticketClosureRequest: { findUnique: vi.fn() } },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: vi.fn(async (work: () => unknown) => work()),
  runWithTenant: vi.fn(async (_orgId: string, work: () => unknown) => work()),
}))
vi.mock("@/lib/ticketing/closure-requests", () => ({
  hashTicketClosureToken: vi.fn(() => "hashed-token"),
  getTicketClosureRequestByHash: vi.fn(),
  confirmTicketClosureByHash: vi.fn(),
}))

import { GET, POST } from "@/app/api/v1/public/ticket-closure/[token]/route"
import { prisma } from "@/lib/prisma"
import {
  confirmTicketClosureByHash,
  getTicketClosureRequestByHash,
} from "@/lib/ticketing/closure-requests"

const context = { params: Promise.resolve({ token: "opaque-token" }) }

beforeEach(() => {
  vi.clearAllMocks()
})

describe("public closure token boundary", () => {
  it("returns the same not-found shape before any tenant query for an unknown hash", async () => {
    vi.mocked(prisma.ticketClosureRequest.findUnique).mockResolvedValue(null)
    const response = await GET(new NextRequest("http://localhost/ticket-closure/opaque-token"), context)
    expect(response.status).toBe(404)
    expect(getTicketClosureRequestByHash).not.toHaveBeenCalled()
  })

  it("uses bypass only to resolve an organization and re-queries the hash in that tenant", async () => {
    vi.mocked(prisma.ticketClosureRequest.findUnique).mockResolvedValue({ organizationId: "org-1" })
    vi.mocked(getTicketClosureRequestByHash).mockResolvedValue({
      id: "closure-1",
      status: "pending",
      requestedAt: new Date(),
      dueAt: new Date(),
      confirmedAt: null,
      rejectedAt: null,
      expiredAt: null,
      ticket: { id: "ticket-1", ticketNumber: "SUP-1", subject: "Help", status: "resolved" },
    } as never)
    const response = await GET(new NextRequest("http://localhost/ticket-closure/opaque-token"), context)
    expect(response.status).toBe(200)
    expect(getTicketClosureRequestByHash).toHaveBeenCalledWith("org-1", "hashed-token")
  })

  it("refuses an empty action instead of defaulting to confirmation", async () => {
    vi.mocked(prisma.ticketClosureRequest.findUnique).mockResolvedValue({ organizationId: "org-1" })
    const response = await POST(new NextRequest("http://localhost/ticket-closure/opaque-token", {
      method: "POST",
      body: JSON.stringify({}),
    }), context)
    expect(response.status).toBe(400)
    expect(confirmTicketClosureByHash).not.toHaveBeenCalled()
  })

  it("passes only a validated action, tenant and token hash to the transactional helper", async () => {
    vi.mocked(prisma.ticketClosureRequest.findUnique).mockResolvedValue({ organizationId: "org-1" })
    vi.mocked(confirmTicketClosureByHash).mockResolvedValue({
      status: "rejected",
      ticket: { id: "ticket-1", status: "open" },
    } as never)
    const response = await POST(new NextRequest("http://localhost/ticket-closure/opaque-token", {
      method: "POST",
      body: JSON.stringify({ action: "reject" }),
    }), context)
    expect(response.status).toBe(200)
    expect(confirmTicketClosureByHash).toHaveBeenCalledWith({
      orgId: "org-1",
      tokenHash: "hashed-token",
      action: "reject",
    })
  })
})
