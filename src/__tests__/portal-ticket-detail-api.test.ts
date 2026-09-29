import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => {
  const prisma = {
    ticket: { findFirst: vi.fn(), update: vi.fn() },
    ticketComment: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    ticketAttachment: { count: vi.fn(), updateMany: vi.fn() },
    user: { findMany: vi.fn() },
    survey: { findMany: vi.fn() },
    surveyResponse: { findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  }
  return { prisma }
})
vi.mock("@/lib/portal-auth", () => ({ getPortalUser: vi.fn() }))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn(async (_orgId: string, work: () => unknown) => work()),
}))

import { GET, POST } from "@/app/api/v1/public/portal-tickets/[id]/route"
import { prisma } from "@/lib/prisma"
import { getPortalUser } from "@/lib/portal-auth"

const USER = {
  contactId: "contact-1",
  organizationId: "org-1",
  companyId: "company-1",
  fullName: "Portal User",
  email: "portal@example.com",
}
const context = { params: Promise.resolve({ id: "ticket-1" }) }
const UUID = "123e4567-e89b-42d3-a456-426614174000"

function request(method = "GET", body?: unknown) {
  return new NextRequest("http://localhost/api/v1/public/portal-tickets/ticket-1", {
    method,
    ...(body === undefined ? {} : {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPortalUser).mockResolvedValue(USER)
  vi.mocked(prisma.$transaction).mockImplementation(async (work) => work(prisma as never))
  vi.mocked(prisma.user.findMany).mockResolvedValue([])
})

describe("portal ticket detail isolation and projection", () => {
  it("requires both the portal tenant and contact for a direct route", async () => {
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null)
    const response = await GET(request(), context)
    expect(response.status).toBe(404)
    expect(prisma.ticket.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "ticket-1", organizationId: "org-1", contactId: "contact-1" },
    }))
  })

  it("returns only customer-safe ticket and public-comment fields", async () => {
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue({
      id: "ticket-1",
      ticketNumber: "SUP-1",
      subject: "Cannot sign in",
      description: "Details",
      status: "open",
      priority: "critical",
      assigneeId: "agent-secret",
      category: "technical",
      categoryRef: { name: "Technical", slug: "technical" },
      satisfactionRating: null,
      satisfactionComment: null,
      createdAt: new Date("2026-09-05T10:00:00.000Z"),
      updatedAt: new Date("2026-09-05T10:10:00.000Z"),
      resolvedAt: null,
      closedAt: null,
      slaDueAt: new Date("2026-09-06T10:00:00.000Z"),
      slaFirstResponseDueAt: new Date("2026-09-05T11:00:00.000Z"),
      firstResponseAt: null,
      comments: [{
        id: "comment-1",
        comment: "Public reply",
        isInternal: false,
        userId: null,
        createdAt: new Date("2026-09-05T10:05:00.000Z"),
        attachments: [],
      }],
    } as never)
    const response = await GET(request(), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).not.toHaveProperty("priority")
    expect(body.data).not.toHaveProperty("assigneeId")
    expect(body.data.comments[0]).not.toHaveProperty("isInternal")
    expect(prisma.ticket.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        comments: expect.objectContaining({ where: { isInternal: false } }),
      }),
    }))
  })
})

describe("portal reply idempotency and atomic reopen", () => {
  it("binds owned drafts and reopens a terminal ticket in the same transaction", async () => {
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue({ id: "ticket-1", status: "resolved" } as never)
    vi.mocked(prisma.ticketComment.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.ticketAttachment.count).mockResolvedValue(1)
    vi.mocked(prisma.ticketComment.create).mockResolvedValue({
      id: "comment-1",
      comment: "Still broken",
      isInternal: false,
      userId: null,
      createdAt: new Date(),
    } as never)
    vi.mocked(prisma.ticketAttachment.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.ticketComment.findUniqueOrThrow).mockResolvedValue({
      id: "comment-1",
      comment: "Still broken",
      isInternal: false,
      userId: null,
      createdAt: new Date(),
      attachments: [{ id: "file-1" }],
    } as never)
    vi.mocked(prisma.ticket.update).mockResolvedValue({ id: "ticket-1", status: "in_progress" } as never)

    const response = await POST(request("POST", {
      comment: "Still broken",
      attachmentIds: ["file-1"],
      clientRequestId: UUID,
    }), context)

    expect(response.status).toBe(201)
    expect(prisma.ticketAttachment.count).toHaveBeenCalledWith({
      where: {
        id: { in: ["file-1"] },
        organizationId: "org-1",
        ticketId: "ticket-1",
        uploadedBy: "contact-1",
        commentId: null,
      },
    })
    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "ticket-1" },
      data: {
        status: "in_progress",
        resolvedAt: null,
        closedAt: null,
        reopenCount: { increment: 1 },
      },
    })
  })

  it("returns an existing matching request without a second comment or reopen", async () => {
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue({ id: "ticket-1", status: "closed" } as never)
    vi.mocked(prisma.ticketComment.findUnique).mockResolvedValue({
      id: "comment-1",
      comment: "Same reply",
      isInternal: false,
      userId: null,
      createdAt: new Date(),
      attachments: [],
    } as never)

    const response = await POST(request("POST", {
      comment: "Same reply",
      attachmentIds: [],
      clientRequestId: UUID,
    }), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.replayed).toBe(true)
    expect(prisma.ticketComment.create).not.toHaveBeenCalled()
    expect(prisma.ticket.update).not.toHaveBeenCalled()
  })
})
