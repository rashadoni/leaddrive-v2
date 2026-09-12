import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  ticketFindFirst: vi.fn(),
  commentFindUnique: vi.fn(),
  commentFindUniqueOrThrow: vi.fn(),
  commentCreate: vi.fn(),
  attachmentCount: vi.fn(),
  attachmentUpdateMany: vi.fn(),
  ticketUpdateMany: vi.fn(),
  transaction: vi.fn(),
  notification: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticket: { findFirst: mocks.ticketFindFirst, updateMany: mocks.ticketUpdateMany },
    ticketComment: {
      findUnique: mocks.commentFindUnique,
      findUniqueOrThrow: mocks.commentFindUniqueOrThrow,
      create: mocks.commentCreate,
    },
    ticketAttachment: { count: mocks.attachmentCount, updateMany: mocks.attachmentUpdateMany },
    $transaction: mocks.transaction,
  },
}))
vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: unknown) => handler,
}))
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn() }))
vi.mock("@/lib/notifications", () => ({ createNotification: mocks.notification }))
vi.mock("@/lib/entitlement-process/ticket-milestones", () => ({ markTicketMilestonesMet: vi.fn() }))

import { POST } from "@/app/api/v1/tickets/[id]/comments/route"

const auth = { orgId: "org-1", userId: "user-1", role: "support" }
const context = { params: Promise.resolve({ id: "ticket-1" }) }
const postHandler = POST as unknown as (
  request: NextRequest,
  authContext: typeof auth,
  routeContext: typeof context,
) => Promise<Response>
const requestId = "00000000-0000-4000-8000-000000000001"
const tx = {
  ticketComment: {
    findUnique: mocks.commentFindUnique,
    findUniqueOrThrow: mocks.commentFindUniqueOrThrow,
    create: mocks.commentCreate,
  },
  ticketAttachment: {
    count: mocks.attachmentCount,
    updateMany: mocks.attachmentUpdateMany,
  },
}

function request(attachmentIds = ["file-1"]) {
  return new NextRequest("http://localhost/api/v1/tickets/ticket-1/comments", {
    method: "POST",
    body: JSON.stringify({
      comment: "Private diagnosis",
      isInternal: true,
      attachmentIds,
      clientRequestId: requestId,
    }),
  })
}

describe("ticket comment idempotency and attachment binding", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ticketFindFirst.mockResolvedValue({
      id: "ticket-1",
      organizationId: "org-1",
      status: "open",
      assignedTo: null,
      firstResponseAt: new Date(),
      tags: [],
      ticketNumber: "TK-1",
      subject: "Printer",
    })
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
    mocks.commentFindUnique.mockResolvedValue(null)
    mocks.attachmentCount.mockResolvedValue(1)
    mocks.attachmentUpdateMany.mockResolvedValue({ count: 1 })
    mocks.commentCreate.mockResolvedValue({
      id: "comment-1",
      ticketId: "ticket-1",
      userId: "user-1",
      comment: "Private diagnosis",
      isInternal: true,
      clientRequestId: requestId,
    })
    mocks.commentFindUniqueOrThrow.mockResolvedValue({ id: "comment-1", attachments: [{ id: "file-1" }] })
  })

  it("binds only the caller's available pending files in the comment transaction", async () => {
    const response = await postHandler(request(), auth, context)

    expect(response.status).toBe(201)
    expect(mocks.attachmentCount).toHaveBeenCalledWith({ where: {
      id: { in: ["file-1"] },
      organizationId: "org-1",
      ticketId: "ticket-1",
      commentId: null,
      uploadedBy: "user-1",
    } })
    expect(mocks.attachmentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { commentId: "comment-1" },
    }))
    expect(await response.json()).toMatchObject({ success: true, replayed: false })
  })

  it("returns the original comment without duplicating side effects on retry", async () => {
    mocks.commentFindUnique.mockResolvedValue({
      id: "comment-1",
      ticketId: "ticket-1",
      userId: "user-1",
      comment: "Private diagnosis",
      isInternal: true,
      attachments: [{ id: "file-1" }],
    })

    const response = await postHandler(request(), auth, context)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, replayed: true })
    expect(mocks.commentCreate).not.toHaveBeenCalled()
    expect(mocks.attachmentUpdateMany).not.toHaveBeenCalled()
    expect(mocks.notification).not.toHaveBeenCalled()
  })

  it("keeps the draft recoverable when a selected file is no longer available", async () => {
    mocks.attachmentCount.mockResolvedValue(0)
    const response = await postHandler(request(), auth, context)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ errorKey: "attachmentConflict" })
    expect(mocks.commentCreate).not.toHaveBeenCalled()
  })
})
