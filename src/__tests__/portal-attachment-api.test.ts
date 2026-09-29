import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticket: { findFirst: vi.fn() },
    ticketAttachment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/portal-auth", () => ({ getPortalUser: vi.fn() }))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => true) }))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn(async (_orgId: string, work: () => unknown) => work()),
}))
vi.mock("@/lib/ticketing/ticket-attachment-storage", () => ({
  TICKET_ATTACHMENT_MAX_FILE_SIZE: 10 * 1024 * 1024,
  TicketAttachmentInputError: class TicketAttachmentInputError extends Error {},
  resolveTicketAttachmentPath: vi.fn(() => "/safe/tickets/file.pdf"),
  storeTicketAttachment: vi.fn(),
}))
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => Buffer.from("%PDF-1.7")),
  unlink: vi.fn(async () => undefined),
}))

import { GET as LIST_FILES } from "@/app/api/v1/public/portal-tickets/[id]/files/route"
import {
  DELETE as DELETE_FILE,
  GET as DOWNLOAD_FILE,
} from "@/app/api/v1/public/portal-tickets/[id]/files/[fileId]/route"
import { prisma } from "@/lib/prisma"
import { getPortalUser } from "@/lib/portal-auth"

const USER = {
  contactId: "contact-1",
  organizationId: "org-1",
  companyId: "company-1",
  fullName: "Portal User",
  email: "portal@example.com",
}

const ticketContext = { params: Promise.resolve({ id: "ticket-1" }) }
const fileContext = { params: Promise.resolve({ id: "ticket-1", fileId: "file-1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPortalUser).mockResolvedValue(USER)
})

describe("portal attachment isolation", () => {
  it("requires a portal session", async () => {
    vi.mocked(getPortalUser).mockResolvedValue(null)
    const response = await LIST_FILES(
      new NextRequest("http://localhost/api/v1/public/portal-tickets/ticket-1/files"),
      ticketContext,
    )
    expect(response.status).toBe(401)
    expect(prisma.ticket.findFirst).not.toHaveBeenCalled()
  })

  it("checks tenant and contact ownership before listing any file metadata", async () => {
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null)
    const response = await LIST_FILES(
      new NextRequest("http://localhost/api/v1/public/portal-tickets/ticket-1/files"),
      ticketContext,
    )
    expect(response.status).toBe(404)
    expect(prisma.ticket.findFirst).toHaveBeenCalledWith({
      where: { id: "ticket-1", organizationId: "org-1", contactId: "contact-1" },
      select: { id: true },
    })
    expect(prisma.ticketAttachment.findMany).not.toHaveBeenCalled()
  })

  it("lists only public-comment files or the current contact's unbound drafts", async () => {
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue({ id: "ticket-1" })
    vi.mocked(prisma.ticketAttachment.findMany).mockResolvedValue([])
    const response = await LIST_FILES(
      new NextRequest("http://localhost/api/v1/public/portal-tickets/ticket-1/files"),
      ticketContext,
    )
    expect(response.status).toBe(200)
    expect(prisma.ticketAttachment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        ticketId: "ticket-1",
        OR: [
          { comment: { is: { isInternal: false } } },
          { commentId: null, uploadedBy: "contact-1" },
        ],
      },
    }))
  })

  it("does not probe file metadata when the requested ticket belongs elsewhere", async () => {
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null)
    const response = await DOWNLOAD_FILE(
      new NextRequest("http://localhost/api/v1/public/portal-tickets/ticket-1/files/file-1"),
      fileContext,
    )
    expect(response.status).toBe(404)
    expect(prisma.ticketAttachment.findFirst).not.toHaveBeenCalled()
  })

  it("deletes only the current contact's still-unbound draft", async () => {
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue({ id: "ticket-1" })
    vi.mocked(prisma.ticketAttachment.findFirst).mockResolvedValue({ fileName: "file.pdf" })
    vi.mocked(prisma.ticketAttachment.deleteMany).mockResolvedValue({ count: 1 })
    const response = await DELETE_FILE(
      new NextRequest("http://localhost/api/v1/public/portal-tickets/ticket-1/files/file-1", { method: "DELETE" }),
      fileContext,
    )
    expect(response.status).toBe(200)
    expect(prisma.ticketAttachment.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "file-1",
        organizationId: "org-1",
        ticketId: "ticket-1",
        uploadedBy: "contact-1",
        commentId: null,
      },
    })
  })
})
