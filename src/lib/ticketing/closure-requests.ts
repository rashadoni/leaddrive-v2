import { createHash, randomBytes } from "crypto"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

export const TICKET_CLOSURE_CONFIRMATION_DAYS = 7

type TicketForClosureRequest = {
  id: string
  organizationId: string
  ticketNumber: string | null
  subject: string
  status: string
  source: string | null
  sourceMeta: Prisma.JsonValue | null
  requesterEmail: string | null
  requesterPhone: string | null
  requesterExternalId: string | null
  contactId: string | null
}

export function createTicketClosureToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url")
  return { token, tokenHash: hashTicketClosureToken(token) }
}

export function hashTicketClosureToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function ticketClosureDueAt(from = new Date()): Date {
  return new Date(from.getTime() + TICKET_CLOSURE_CONFIRMATION_DAYS * 24 * 60 * 60 * 1000)
}

export function buildTicketClosureUrl(token: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.NEXTAUTH_URL || ""
  const path = `/ticket-closure/${encodeURIComponent(token)}`
  return baseUrl ? `${baseUrl.replace(/\/$/, "")}${path}` : path
}

export function inferClosureRequestTarget(ticket: TicketForClosureRequest): { channel: string | null; recipient: string | null } {
  const sourceMeta = isRecord(ticket.sourceMeta) ? ticket.sourceMeta : {}
  const sourcePhone = typeof sourceMeta.phone === "string" ? sourceMeta.phone : null

  if (ticket.source === "whatsapp") {
    return { channel: "whatsapp", recipient: ticket.requesterPhone || sourcePhone }
  }
  if (ticket.requesterEmail) {
    return { channel: ticket.source === "portal" ? "portal" : "email", recipient: ticket.requesterEmail }
  }
  if (ticket.requesterPhone || sourcePhone) {
    return { channel: ticket.source || "phone", recipient: ticket.requesterPhone || sourcePhone }
  }

  return { channel: ticket.source || null, recipient: ticket.requesterExternalId || ticket.contactId }
}

export async function createTicketClosureRequestForTicket(params: {
  orgId: string
  ticket: TicketForClosureRequest
  requestedBy?: string | null
}): Promise<{
  id: string
  status: string
  token: string
  confirmationUrl: string
  requestedAt: Date
  dueAt: Date
  channel: string | null
  recipient: string | null
  confirmedAt: Date | null
  rejectedAt: Date | null
  expiredAt: Date | null
  canceledAt: Date | null
}> {
  const { token, tokenHash } = createTicketClosureToken()
  const dueAt = ticketClosureDueAt()
  const target = inferClosureRequestTarget(params.ticket)

  await prisma.ticketClosureRequest.updateMany({
    where: {
      organizationId: params.orgId,
      ticketId: params.ticket.id,
      status: "pending",
    },
    data: { status: "canceled", canceledAt: new Date() },
  })

  const request = await prisma.ticketClosureRequest.create({
    data: {
      organizationId: params.orgId,
      ticketId: params.ticket.id,
      status: "pending",
      channel: target.channel,
      recipient: target.recipient,
      tokenHash,
      requestedBy: params.requestedBy || null,
      dueAt,
    },
  })

  return {
    id: request.id,
    status: request.status,
    token,
    confirmationUrl: buildTicketClosureUrl(token),
    requestedAt: request.requestedAt,
    dueAt: request.dueAt,
    channel: request.channel,
    recipient: request.recipient,
    confirmedAt: request.confirmedAt,
    rejectedAt: request.rejectedAt,
    expiredAt: request.expiredAt,
    canceledAt: request.canceledAt,
  }
}

export async function cancelPendingTicketClosureRequests(orgId: string, ticketId: string): Promise<number> {
  const result = await prisma.ticketClosureRequest.updateMany({
    where: { organizationId: orgId, ticketId, status: "pending" },
    data: { status: "canceled", canceledAt: new Date() },
  })
  return result.count
}

export async function confirmTicketClosureByHash(params: {
  orgId: string
  tokenHash: string
  action: "confirm" | "reject"
}) {
  const request = await prisma.ticketClosureRequest.findFirst({
    where: { organizationId: params.orgId, tokenHash: params.tokenHash },
    include: { ticket: true },
  })
  if (!request) return { status: "not_found" as const }

  if (request.status !== "pending") {
    return { status: request.status as "confirmed" | "rejected" | "expired" | "canceled", ticket: request.ticket }
  }

  if (request.dueAt.getTime() <= Date.now()) {
    const result = await expireTicketClosureRequest(params.orgId, request.id, request.ticketId)
    return { status: "expired" as const, ticket: result.ticket }
  }

  if (params.action === "confirm") {
    const ticket = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.ticketClosureRequest.update({
        where: { id: request.id },
        data: { status: "confirmed", confirmedAt: new Date() },
      })
      return tx.ticket.update({
        where: { id: request.ticketId },
        data: { status: "closed", closedAt: new Date() },
      })
    })
    return { status: "confirmed" as const, ticket }
  }

  const ticket = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.ticketClosureRequest.update({
      where: { id: request.id },
      data: { status: "rejected", rejectedAt: new Date() },
    })
    return tx.ticket.update({
      where: { id: request.ticketId },
      data: {
        status: "open",
        resolvedAt: null,
        closedAt: null,
        reopenCount: { increment: 1 },
      },
    })
  })
  return { status: "rejected" as const, ticket }
}

export async function getTicketClosureRequestByHash(orgId: string, tokenHash: string) {
  return prisma.ticketClosureRequest.findFirst({
    where: { organizationId: orgId, tokenHash },
    include: {
      ticket: {
        select: {
          id: true,
          ticketNumber: true,
          subject: true,
          status: true,
          resolvedAt: true,
          closedAt: true,
        },
      },
    },
  })
}

export async function autoCloseExpiredTicketClosureRequests(limit = 200) {
  const pending = await prisma.ticketClosureRequest.findMany({
    where: {
      status: "pending",
      dueAt: { lte: new Date() },
    },
    orderBy: { dueAt: "asc" },
    take: limit,
    select: { id: true, organizationId: true, ticketId: true },
  })

  let closed = 0
  let canceled = 0
  for (const request of pending) {
    const result = await expireTicketClosureRequest(request.organizationId, request.id, request.ticketId)
    if (result.closed) closed++
    else canceled++
  }

  return { scanned: pending.length, closed, canceled }
}

async function expireTicketClosureRequest(orgId: string, requestId: string, ticketId: string) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: ticketId, organizationId: orgId },
      select: { id: true, status: true },
    })

    await tx.ticketClosureRequest.update({
      where: { id: requestId },
      data: { status: "expired", expiredAt: new Date() },
    })

    if (ticket?.status === "resolved") {
      const closedTicket = await tx.ticket.update({
        where: { id: ticketId },
        data: { status: "closed", closedAt: new Date() },
      })
      return { closed: true, ticket: closedTicket }
    }

    return { closed: false, ticket }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
