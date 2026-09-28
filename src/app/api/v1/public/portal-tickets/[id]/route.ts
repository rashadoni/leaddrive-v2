import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { getPortalUser } from "@/lib/portal-auth"

const commentSchema = z.object({
  comment: z.string().trim().min(1).max(5000),
  attachmentIds: z.array(z.string().min(1)).max(10).default([]),
  clientRequestId: z.string().uuid().optional(),
}).refine((value) => new Set(value.attachmentIds).size === value.attachmentIds.length, {
  message: "Duplicate attachment IDs are not allowed",
  path: ["attachmentIds"],
})

class PortalAttachmentConflictError extends Error {}

type PortalCommentRow = {
  id: string
  comment: string
  userId: string | null
  createdAt: Date
  attachments?: Array<{
    id: string
    originalName: string
    fileSize: number
    mimeType: string
  }>
}

type PortalAgentIdentity = {
  id: string
  name: string | null
}

// GET /api/v1/public/portal-tickets/[id] — ticket detail with public comments
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getPortalUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  // RLS: org comes from the verified portal JWT — whole handler runs tenant-scoped.
  return await runWithTenant(user.organizationId, async () => {
  const ticket = await prisma.ticket.findFirst({
    where: {
      id,
      organizationId: user.organizationId,
      contactId: user.contactId,
    },
    include: {
      categoryRef: { select: { name: true, slug: true } },
      comments: {
        where: { isInternal: false },
        orderBy: { createdAt: "asc" },
        include: {
          attachments: {
            select: { id: true, originalName: true, fileSize: true, mimeType: true },
          },
        },
      },
    },
  })

  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })

  // Resolve user names for comments
  const commentRows = ticket.comments as PortalCommentRow[]
  const userIds = [...new Set(commentRows.map((comment) => comment.userId).filter((id): id is string => Boolean(id)))]
  const users: PortalAgentIdentity[] = userIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : []
  const userMap = Object.fromEntries(users.map((user) => [user.id, user.name || "Support"]))

  const comments = commentRows.map((comment) => ({
    id: comment.id,
    comment: comment.comment,
    isAgent: Boolean(comment.userId),
    authorName: comment.userId ? (userMap[comment.userId] || "Support") : user.fullName,
    createdAt: comment.createdAt,
    attachments: comment.attachments || [],
  }))

  return NextResponse.json({
    success: true,
    data: {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      description: ticket.description,
      status: ticket.status,
      category: ticket.category,
      categoryRef: ticket.categoryRef,
      satisfactionRating: ticket.satisfactionRating,
      satisfactionComment: ticket.satisfactionComment,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      resolvedAt: ticket.resolvedAt,
      closedAt: ticket.closedAt,
      slaDueAt: ticket.slaDueAt,
      slaFirstResponseDueAt: ticket.slaFirstResponseDueAt,
      firstResponseAt: ticket.firstResponseAt,
      comments,
    },
  })
  }) // end runWithTenant (tenant-scoped handler body)
}

// POST /api/v1/public/portal-tickets/[id] — add comment from customer
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getPortalUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const parsed = commentSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  // RLS: org comes from the verified portal JWT — whole handler runs tenant-scoped.
  return await runWithTenant(user.organizationId, async () => {
  // Verify ticket belongs to this contact
  const ticket = await prisma.ticket.findFirst({
    where: { id, organizationId: user.organizationId, contactId: user.contactId },
  })
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })

  const createComment = async () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (parsed.data.clientRequestId) {
      const existing = await tx.ticketComment.findUnique({
        where: { ticketId_clientRequestId: { ticketId: id, clientRequestId: parsed.data.clientRequestId } },
        include: { attachments: true },
      })
      if (existing) {
        if (existing.userId !== null || existing.comment !== parsed.data.comment || existing.isInternal) {
          throw new PortalAttachmentConflictError("Request key was already used for different content")
        }
        return { comment: existing, replayed: true }
      }
    }

    if (parsed.data.attachmentIds.length > 0) {
      const available = await tx.ticketAttachment.count({
        where: {
          id: { in: parsed.data.attachmentIds },
          organizationId: user.organizationId,
          ticketId: id,
          uploadedBy: user.contactId,
          commentId: null,
        },
      })
      if (available !== parsed.data.attachmentIds.length) {
        throw new PortalAttachmentConflictError("One or more attachments are unavailable")
      }
    }

    const created = await tx.ticketComment.create({
      data: {
        ticketId: id,
        comment: parsed.data.comment,
        isInternal: false,
        userId: null,
        clientRequestId: parsed.data.clientRequestId,
      },
    })

    if (parsed.data.attachmentIds.length > 0) {
      const attached = await tx.ticketAttachment.updateMany({
        where: {
          id: { in: parsed.data.attachmentIds },
          organizationId: user.organizationId,
          ticketId: id,
          uploadedBy: user.contactId,
          commentId: null,
        },
        data: { commentId: created.id },
      })
      if (attached.count !== parsed.data.attachmentIds.length) {
        throw new PortalAttachmentConflictError("One or more attachments changed before send")
      }
    }

    // Customer reply and terminal-state reopen are one commit: the UI cannot
    // show a sent message on a ticket that silently stayed closed.
    if (ticket.status === "resolved" || ticket.status === "closed") {
      await tx.ticket.update({
        where: { id },
        data: { status: "in_progress", resolvedAt: null, closedAt: null, reopenCount: { increment: 1 } },
      })
    }

    return {
      comment: await tx.ticketComment.findUniqueOrThrow({
        where: { id: created.id },
        include: { attachments: true },
      }),
      replayed: false,
    }
  })

  let result: Awaited<ReturnType<typeof createComment>>
  try {
    result = await createComment()
  } catch (error) {
    if (error instanceof PortalAttachmentConflictError) {
      return NextResponse.json({ error: error.message, errorKey: "attachmentConflict" }, { status: 409 })
    }
    if (parsed.data.clientRequestId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.ticketComment.findUnique({
        where: { ticketId_clientRequestId: { ticketId: id, clientRequestId: parsed.data.clientRequestId } },
        include: { attachments: true },
      })
      if (existing && existing.userId === null && existing.comment === parsed.data.comment && !existing.isInternal) {
        result = { comment: existing, replayed: true }
      } else {
        return NextResponse.json({ error: "Duplicate request conflict", errorKey: "duplicateRequestConflict" }, { status: 409 })
      }
    } else {
      console.error("[portal-ticket-comment POST]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  }

  const { comment: created, replayed } = result

  return NextResponse.json({
    success: true,
    data: {
      id: created.id,
      comment: created.comment,
      isAgent: false,
      authorName: user.fullName,
      createdAt: created.createdAt,
      attachments: created.attachments,
      replayed,
    },
  }, { status: replayed ? 200 : 201 })
  }) // end runWithTenant (tenant-scoped handler body)
}

// PATCH /api/v1/public/portal-tickets/[id] — submit CSAT rating
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getPortalUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const { satisfactionRating, satisfactionComment } = await req.json()

  if (!satisfactionRating || satisfactionRating < 1 || satisfactionRating > 5) {
    return NextResponse.json({ error: "Rating must be 1-5" }, { status: 400 })
  }

  // RLS: org comes from the verified portal JWT — whole handler runs
  // tenant-scoped (the fire-and-forget CSAT survey-mirror IIFE starts
  // inside the scope and inherits it).
  return await runWithTenant(user.organizationId, async () => {
  const ticket = await prisma.ticket.findFirst({
    where: { id, organizationId: user.organizationId, contactId: user.contactId },
  })
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })

  if (!["resolved", "closed"].includes(ticket.status)) {
    return NextResponse.json({ error: "Can only rate resolved/closed tickets" }, { status: 400 })
  }

  await prisma.ticket.update({
    where: { id },
    data: {
      satisfactionRating,
      satisfactionComment: satisfactionComment || null,
    },
  })

  // Mirror the portal CSAT into SurveyResponse so it shows up in the Surveys
  // analytics alongside invite-based responses — but only if the org has a
  // CSAT survey wired to the ticket-resolved trigger and the ticket isn't
  // already recorded against it (dedup by surveyId+ticketId).
  ;(async () => {
    try {
      const csatSurveys = await prisma.survey.findMany({
        where: { organizationId: user.organizationId, status: "active", type: "csat" },
      })
      for (const s of csatSurveys) {
        const triggers = isRecord(s.triggers) ? s.triggers : {}
        if (!triggers.afterTicketResolve) continue
        const already = await prisma.surveyResponse.findFirst({
          where: { surveyId: s.id, ticketId: id },
          select: { id: true },
        })
        if (already) continue
        // CSAT 1-5 maps to NPS-style buckets: 5 = promoter, 4 = passive, ≤3 = detractor
        const category = satisfactionRating === 5 ? "promoter" : satisfactionRating === 4 ? "passive" : "detractor"
        await prisma.surveyResponse.create({
          data: {
            organizationId: user.organizationId,
            surveyId: s.id,
            ticketId: id,
            contactId: user.contactId,
            score: satisfactionRating,
            category,
            comment: satisfactionComment || null,
            channel: "portal",
            answers: {},
          },
        })
      }
    } catch (e) {
      console.error("[portal-csat] survey mirror failed:", e)
    }
  })()

  return NextResponse.json({ success: true })
  }) // end runWithTenant (tenant-scoped handler body)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
