import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { getFieldPermissions, filterEntityFields } from "@/lib/field-filter"
import { autoAssignTicket } from "@/lib/auto-assign"
import { fireWebhooks } from "@/lib/webhooks"
import { clearDeletedMentionRefs } from "@/lib/social/mention-refs"
import { clearTaskRelations } from "@/lib/tasks/clear-task-relations"
import { createRestActorContext } from "@/lib/crm-commands/actor-context"
import { CrmCommandError } from "@/lib/crm-commands/errors"
import { updateTicketCommand } from "@/lib/crm-commands/ticket/update-ticket"
import { TicketingValidationError } from "@/lib/ticketing/category-service"
import { type RuntimeMilestoneDefinition } from "@/lib/entitlement-process/ticket-milestones"
import { systemCommentText } from "@/lib/ticketing/chat-transcript"

type TicketCommentRow = { userId: string | null; comment: string; [key: string]: unknown }
type UserNameRow = { id: string; name: string | null; email: string | null }
type TicketEntitlementMilestoneRow = {
  id: string
  type: string
  status: string
  dueAt: Date
  completedAt: Date | null
  missedAt: Date | null
  waivedAt: Date | null
  waivedReason: string | null
  definition: RuntimeMilestoneDefinition & {
    entitlement: {
      id: string
      supportLevel: string
      status: string
      validFrom: Date
      validTo: Date | null
      company: { id: string; name: string }
      slaPolicy: { id: string; name: string }
    }
  }
}

function buildTicketEntitlementSummary(milestones: TicketEntitlementMilestoneRow[]) {
  if (milestones.length === 0) return null
  const entitlement = milestones[0].definition.entitlement
  const now = Date.now()
  const soon = now + 24 * 60 * 60 * 1000
  let open = 0
  let overdue = 0
  let atRisk = 0
  let met = 0

  for (const milestone of milestones) {
    if (milestone.status === "met" || milestone.status === "waived") {
      met += 1
      continue
    }
    open += 1
    const due = milestone.dueAt.getTime()
    if (milestone.status === "missed" || due <= now) overdue += 1
    else if (due <= soon) atRisk += 1
  }

  return {
    id: entitlement.id,
    supportLevel: entitlement.supportLevel,
    status: entitlement.status,
    validFrom: entitlement.validFrom,
    validTo: entitlement.validTo,
    companyId: entitlement.company.id,
    companyName: entitlement.company.name,
    slaPolicyId: entitlement.slaPolicy.id,
    slaPolicyName: entitlement.slaPolicy.name,
    risk: overdue > 0 ? "overdue" : atRisk > 0 ? "at_risk" : open === 0 ? "complete" : "on_track",
    counts: {
      total: milestones.length,
      open,
      overdue,
      atRisk,
      met,
    },
    milestones: milestones.map((milestone) => ({
      id: milestone.id,
      type: milestone.type,
      status: milestone.status,
      dueAt: milestone.dueAt,
      completedAt: milestone.completedAt,
      missedAt: milestone.missedAt,
      waivedAt: milestone.waivedAt,
      waivedReason: milestone.waivedReason,
      definitionId: milestone.definition.id,
      definitionName: milestone.definition.name || milestone.type,
      severityTier: milestone.definition.severityTier || null,
      isRequired: milestone.definition.isRequired,
    })),
  }
}

// The ticket card reports its stopwatch when the agent leaves the page. That is
// a reading, not an edit: it must not write an audit entry, start workflows or
// fire the "ticket updated" webhook.
const HANDLE_TIME_MAX_SECONDS = 60 * 60 * 24 * 30
const handleTimeReadingSchema = z.object({
  handleTimeSeconds: z.number().int().min(0).max(HANDLE_TIME_MAX_SECONDS),
}).strict()

export const GET = withRls(async (_req: NextRequest, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  const role = session?.role || "admin"
  const { id } = await params

  try {
    const ticket = await prisma.ticket.findFirst({
      where: { id, organizationId: orgId },
      include: {
        categoryRef: { select: { id: true, name: true, slug: true, scope: true } },
        comments: { orderBy: { createdAt: "asc" }, include: { attachments: true } },
        closureRequests: {
          orderBy: { requestedAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            channel: true,
            recipient: true,
            requestedAt: true,
            dueAt: true,
            confirmedAt: true,
            rejectedAt: true,
            expiredAt: true,
            canceledAt: true,
          },
        },
        entitlementMilestones: {
          where: { organizationId: orgId },
          orderBy: { dueAt: "asc" },
          include: {
            definition: {
              select: {
                id: true,
                type: true,
                name: true,
                severityTier: true,
                dueWithinSeconds: true,
                isRequired: true,
                entitlement: {
                  select: {
                    id: true,
                    supportLevel: true,
                    status: true,
                    validFrom: true,
                    validTo: true,
                    company: { select: { id: true, name: true } },
                    slaPolicy: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },  // TicketComment has no organizationId — safe (FK-scoped child)
    })

    if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })

    // Resolve user names for comments, assignee, company
    const comments = ticket.comments as TicketCommentRow[]
    const userIds = [...new Set([
      ...comments.map((c: TicketCommentRow) => c.userId).filter((id: string | null): id is string => Boolean(id)),
      ticket.assignedTo,
      ticket.createdBy,
    ].filter((id: string | null): id is string => Boolean(id)))]

    const [users, company, contact] = await Promise.all([
      userIds.length > 0
        ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
        : Promise.resolve([]),
      ticket.companyId
        ? prisma.company.findFirst({ where: { id: ticket.companyId }, select: { id: true, name: true } })
        : Promise.resolve(null),
      ticket.contactId
        ? prisma.contact.findFirst({ where: { id: ticket.contactId }, select: { id: true, fullName: true, email: true, phone: true, preferredLanguage: true } })
        : Promise.resolve(null),
    ])

    const userMap = Object.fromEntries((users as UserNameRow[]).map((u) => [u.id, u.name || u.email]))

    const contactName = contact?.fullName || contact?.email || "Клиент"
    const {
      closureRequests: rawClosureRequests,
      entitlementMilestones: rawEntitlementMilestones,
      ...ticketWithoutClosureRequests
    } = ticket
    const closureRequests = rawClosureRequests as unknown[]
    const latestClosureRequest = closureRequests[0] || null
    const entitlement = buildTicketEntitlementSummary((rawEntitlementMilestones ?? []) as TicketEntitlementMilestoneRow[])

    const enrichedComments = comments.map((c: TicketCommentRow) => ({
      ...c,
      // No userId is the customer — unless the product wrote it itself (the AI
      // auto-actions cron): that has no author name, and the page labels it «System».
      userName: c.userId ? userMap[c.userId] || "Support" : systemCommentText(c.comment) !== null ? null : contactName,
    }))

    const fieldPerms = await getFieldPermissions(orgId, role, "ticket")
    const enrichedTicket = {
      ...ticketWithoutClosureRequests,
      comments: enrichedComments,
      assigneeName: ticket.assignedTo ? userMap[ticket.assignedTo] || ticket.assignedTo : null,
      companyName: company?.name || null,
      contactName: contactName !== "Клиент" ? contactName : null,
      categoryName: ticket.categoryRef?.name || ticket.category || "general",
      categorySlug: ticket.categoryRef?.slug || ticket.category || "general",
      requesterName: ticket.requesterName || contact?.fullName || contact?.email || contact?.phone || null,
      requesterEmail: ticket.requesterEmail || contact?.email || null,
      requesterPhone: ticket.requesterPhone || contact?.phone || null,
      contactPreferredLanguage: contact?.preferredLanguage || null,
      closureRequest: latestClosureRequest,
      entitlement,
    }
    const filteredTicket = filterEntityFields(enrichedTicket, fieldPerms, role)

    return NextResponse.json({
      success: true,
      data: filteredTicket,
    })
  } catch {
    return NextResponse.json({ error: "Failed to fetch ticket" }, { status: 500 })
  }
})

export const PUT = withRlsAuth("tickets", "write", async (req: NextRequest, authResult, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = authResult.orgId
  const role = authResult.role
  const { id } = await params
  const body = await req.json()

  const handleTimeReading = handleTimeReadingSchema.safeParse(body)
  if (handleTimeReading.success) {
    // Only ever moves forward, so two open cards cannot rewind each other.
    await prisma.ticket.updateMany({
      where: { id, organizationId: orgId, handleTimeSeconds: { lt: handleTimeReading.data.handleTimeSeconds } },
      data: { handleTimeSeconds: handleTimeReading.data.handleTimeSeconds },
    })
    return NextResponse.json({ success: true })
  }

  try {
    // Одна команда с голосом (этап 4): проверка реестра жалоб, SLA, всё, что
    // уходит клиенту, — там. Ответ экрана — прежний.
    const actor = createRestActorContext({ organizationId: orgId, userId: authResult.userId, role })
    const { entity: updated, closureRequest } = await updateTicketCommand(actor, id, body)
    return NextResponse.json({ success: true, data: updated, closureRequest })
  } catch (e) {
    if (e instanceof CrmCommandError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof TicketingValidationError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("tickets", "delete", async (_req: NextRequest, authResult, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = authResult.orgId
  const { id } = await params

  try {
    const existing = await prisma.ticket.findFirst({ where: { id, organizationId: orgId }, select: { subject: true } })
    const result = await prisma.ticket.deleteMany({
      where: { id, organizationId: orgId },
    })

    if (result.count === 0) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })
    logAudit(orgId, "delete", "ticket", id, existing?.subject || "")
    fireWebhooks(orgId, "ticket.deleted", { id, subject: existing?.subject }).catch(() => {})
    // Drop any social-mention back-reference so Social Monitoring stops showing
    // "view ticket" for the now-deleted ticket (no FK → not auto-nulled).
    await clearDeletedMentionRefs(orgId, "ticketId", [id])
    // Null out tasks that linked to this now-deleted ticket (no FK → not auto-nulled).
    await clearTaskRelations(orgId, "ticket", id)
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// PATCH /api/v1/tickets/[id] — auto-assign via skill-based routing
export const PATCH = withRlsAuth("tickets", "write", async (_req: NextRequest, authResult, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = authResult.orgId
  const { id } = await params

  try {
    const ticket = await prisma.ticket.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })

    const result = await autoAssignTicket(ticket.id, orgId, ticket.category)

    if (!result.assigned) {
      return NextResponse.json({ error: "No available agents" }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      data: {
        assignedTo: result.agentId,
        assigneeName: result.agentName,
        queueName: result.queueName,
      },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
