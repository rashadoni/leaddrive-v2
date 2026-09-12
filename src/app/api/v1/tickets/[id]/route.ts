import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { getFieldPermissions, filterEntityFields, filterWritableFields } from "@/lib/field-filter"
import { sendWhatsAppMessage } from "@/lib/whatsapp"
import { sendEmail } from "@/lib/email"
import { executeWorkflows } from "@/lib/workflow-engine"
import { autoAssignTicket } from "@/lib/auto-assign"
import { fireWebhooks } from "@/lib/webhooks"
import { triggerSurveysOnTicketResolved } from "@/lib/survey-triggers"
import { clearDeletedMentionRefs } from "@/lib/social/mention-refs"
import { clearTaskRelations } from "@/lib/tasks/clear-task-relations"
import { LEGACY_TICKET_CATEGORY_SLUGS } from "@/lib/ticketing/categories"
import {
  TicketingValidationError,
  buildTicketRequesterSnapshot,
  getContactRequesterSnapshot,
  resolveTicketCategoryForWrite,
} from "@/lib/ticketing/category-service"
import {
  cancelPendingTicketClosureRequests,
  createTicketClosureRequestForTicket,
} from "@/lib/ticketing/closure-requests"
import {
  markTicketMilestonesMet,
  type RuntimeMilestoneDefinition,
} from "@/lib/entitlement-process/ticket-milestones"
import type { MilestoneType } from "@/lib/entitlement-process/types"

type WhatsAppStatusNotificationResult = { surveyHandled: boolean } | undefined
type WhatsAppTicketStatusSettings = {
  whatsappTicketStatusTemplates?: Record<string, string>
}
type ChannelMessageMetadata = {
  waPhone?: unknown
}
type SurveyTriggerSettings = {
  afterTicketResolve?: boolean
}
type TicketCommentRow = { userId: string | null; [key: string]: unknown }
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

function milestoneTypesForTicketUpdate(
  oldStatus: string,
  newStatus: string | undefined,
  isEscalation: boolean,
): MilestoneType[] {
  const types = new Set<MilestoneType>()
  if (newStatus && newStatus !== oldStatus) {
    if (newStatus === "in_progress") types.add("problem_identified")
    if (newStatus === "waiting") types.add("workaround_delivered")
    if (newStatus === "resolved") types.add("resolution")
    if (newStatus === "escalated") types.add("escalation")
  }
  if (isEscalation) types.add("escalation")
  return [...types]
}

const updateTicketSchema = z.object({
  subject: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  status: z.enum(["new", "open", "in_progress", "waiting", "resolved", "closed", "escalated"]).optional(),
  assignedTo: z.string().optional(),
  contactId: z.string().nullable().optional(),
  companyId: z.string().optional(),
  category: z.enum(LEGACY_TICKET_CATEGORY_SLUGS).optional(),
  categoryId: z.string().nullable().optional(),
})

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
      userName: c.userId ? userMap[c.userId] || "Support" : contactName,
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
  const preFieldPerms = await getFieldPermissions(orgId, role, "ticket")
  const filteredBody = filterWritableFields(body, preFieldPerms, role)
  const parsed = updateTicketSchema.safeParse(filteredBody)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    // Fetch original ticket to detect status change
    const original = await prisma.ticket.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!original) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })

    const oldStatus = original.status

    // Guard: a ticket linked to ComplaintMeta is in the complaints registry and cannot
    // have its category changed away from "complaint" — operators must not be able to
    // silently remove a complaint from the registry. The only way out is deleting the
    // ticket entirely (which cascades the ComplaintMeta).
    const hasCategoryPatch = parsed.data.category !== undefined || parsed.data.categoryId !== undefined
    const resolvedCategory = hasCategoryPatch
      ? await resolveTicketCategoryForWrite(orgId, {
          categoryId: parsed.data.categoryId,
          category: parsed.data.category,
        })
      : null

    if (resolvedCategory && resolvedCategory.scope === "ticket") {
      const hasComplaint = await prisma.complaintMeta.findUnique({
        where: { ticketId: id },
        select: { id: true },
      })
      if (hasComplaint) {
        return NextResponse.json(
          { error: "Нельзя снять флаг жалобы — тикет находится в реестре жалоб" },
          { status: 409 },
        )
      }
    }

    const fieldPerms = await getFieldPermissions(orgId, role, "ticket")
    let closureRequest: Awaited<ReturnType<typeof createTicketClosureRequestForTicket>> | null = null
    // Increment escalationLevel when priority is changed to critical
    const isEscalation = parsed.data.priority === "critical" && original.priority !== "critical"
    const milestoneTypesToMark = milestoneTypesForTicketUpdate(oldStatus, parsed.data.status, isEscalation)
    // Reopen: a terminal ticket (resolved/closed) is moved back to an active status.
    // Bump reopenCount (KPI Arena reopen-rate) and clear the terminal timestamps so it
    // no longer counts as resolved until it's resolved again.
    const isReopen =
      (oldStatus === "resolved" || oldStatus === "closed") &&
      (parsed.data.status === "open" || parsed.data.status === "in_progress")
    const requesterSnapshot = parsed.data.contactId !== undefined
      ? parsed.data.contactId
        ? await getContactRequesterSnapshot(orgId, parsed.data.contactId)
        : buildTicketRequesterSnapshot({})
      : {}

    const updateData = {
      ...(parsed.data.subject && { subject: parsed.data.subject }),
      ...(parsed.data.description !== undefined && { description: parsed.data.description }),
      ...(parsed.data.priority && { priority: parsed.data.priority }),
      ...(parsed.data.status && { status: parsed.data.status }),
      ...(parsed.data.assignedTo !== undefined && { assignedTo: parsed.data.assignedTo || null }),
      ...(parsed.data.contactId !== undefined && { contactId: parsed.data.contactId || null }),
      ...(parsed.data.companyId !== undefined && { companyId: parsed.data.companyId || null }),
      ...(resolvedCategory && { category: resolvedCategory.category, categoryId: resolvedCategory.categoryId }),
      ...requesterSnapshot,
      ...(parsed.data.status === "resolved" && { resolvedAt: new Date() }),
      ...(parsed.data.status === "closed" && { closedAt: new Date() }),
      ...(isEscalation && { escalationLevel: (original.escalationLevel || 0) + 1, lastEscalatedAt: new Date() }),
      ...(isReopen && { reopenCount: (original.reopenCount || 0) + 1, resolvedAt: null, closedAt: null }),
    }
    const filteredUpdateData = filterWritableFields(updateData, fieldPerms, role)

    await prisma.ticket.updateMany({
      where: { id, organizationId: orgId },
      data: filteredUpdateData,
    })

    const updated = await prisma.ticket.findFirst({
      where: { id, organizationId: orgId },
      include: { comments: { orderBy: { createdAt: "desc" } } },  // TicketComment has no organizationId — safe (FK-scoped child)
    })

    // Send WhatsApp notification on status change for WhatsApp tickets.
    // The resolved-path also merges the active survey link into the same
    // message (customer gets ONE ping instead of two), and returns a flag
    // so the survey trigger below skips the whatsapp channel to avoid
    // sending the link twice.
    const newStatus = parsed.data.status
    const waTicket = (original.tags as string[])?.includes("whatsapp")
    const waNotifyPromise = newStatus && newStatus !== oldStatus && waTicket
      ? sendWhatsAppStatusNotification(orgId, original, newStatus).catch(err => {
          console.error("[Ticket WA] Status notification error:", err)
          return undefined
        })
      : Promise.resolve(undefined)

    logAudit(orgId, "update", "ticket", id, original.subject, { newValue: parsed.data })
    if (updated) {
      const triggerEvent = parsed.data.status ? "status_changed" : "updated"
      executeWorkflows(orgId, "ticket", triggerEvent, updated).catch(() => {})
      const webhookEvent = updated.status === "resolved" ? "ticket.resolved" : "ticket.updated"
      fireWebhooks(orgId, webhookEvent, { id: updated.id, ticketNumber: updated.ticketNumber, subject: updated.subject, status: updated.status }).catch(() => {})
      if (milestoneTypesToMark.length > 0) {
        try {
          await markTicketMilestonesMet(prisma, {
            organizationId: orgId,
            ticketId: updated.id,
            types: milestoneTypesToMark,
            eventName: parsed.data.status ? `ticket_status_${updated.status}` : "ticket_priority_escalation",
            actorUserId: authResult.userId,
          })
        } catch (error) {
          console.error("[ticket-milestones] ticket update milestone sync failed:", error)
        }
      }

      // Fire survey triggers when ticket transitions to resolved (§8 trigger).
      // Wait for the WhatsApp status-notification to finish so we can tell
      // the survey trigger whether it already embedded the survey link.
      if (oldStatus !== "resolved" && updated.status === "resolved") {
        closureRequest = await createTicketClosureRequestForTicket({
          orgId,
          ticket: updated,
          requestedBy: authResult.userId,
        })
        if (closureRequest.channel === "whatsapp" && closureRequest.recipient) {
          sendWhatsAppMessage({
            to: closureRequest.recipient,
            organizationId: orgId,
            contactId: updated.contactId || undefined,
            message: `Ваш тикет ${updated.ticketNumber} отмечен как решён. Подтвердите закрытие или верните в работу: ${closureRequest.confirmationUrl}`,
            forceText: true,
          }).catch(err => console.error("[ticket-closure] whatsapp request failed:", err))
        } else if (closureRequest.recipient && closureRequest.recipient.includes("@")) {
          sendTicketClosureEmail({
            to: closureRequest.recipient,
            orgId,
            contactId: updated.contactId,
            ticketNumber: updated.ticketNumber,
            subject: updated.subject,
            dueAt: closureRequest.dueAt,
            confirmationUrl: closureRequest.confirmationUrl,
          }).catch(err => console.error("[ticket-closure] email request failed:", err))
        }
        waNotifyPromise
          .then(waResult => triggerSurveysOnTicketResolved(orgId, {
            id: updated.id,
            contactId: updated.contactId,
            ticketNumber: updated.ticketNumber,
            source: updated.source,
            sourceMeta: updated.sourceMeta,
          }, { skipWhatsAppChannel: !!waResult?.surveyHandled }))
          .catch(err => console.error("[survey-trigger] ticket.resolved:", err))
      }
      if (isReopen) {
        cancelPendingTicketClosureRequests(orgId, updated.id).catch(() => {})
      }
      if (updated.status === "closed") {
        cancelPendingTicketClosureRequests(orgId, updated.id).catch(() => {})
      }
    }

    return NextResponse.json({ success: true, data: updated, closureRequest })
  } catch (e) {
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

async function sendTicketClosureEmail(params: {
  to: string
  orgId: string
  contactId: string | null
  ticketNumber: string | null
  subject: string
  dueAt: Date
  confirmationUrl: string
}) {
  const ticketNumber = params.ticketNumber || "ticket"
  const safeTicketNumber = escapeHtml(ticketNumber)
  const safeSubject = escapeHtml(params.subject)
  const safeUrl = escapeHtml(params.confirmationUrl)
  const dueAt = params.dueAt.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  const html = `
<!doctype html><html><body style="font-family:system-ui,Segoe UI,Arial;margin:0;padding:24px;background:#f6f7f9;color:#111827">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
    <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">Подтвердите закрытие тикета ${safeTicketNumber}</h1>
    <p style="margin:0 0 16px;color:#4b5563;line-height:1.5">Мы отметили обращение как решенное:</p>
    <p style="margin:0 0 20px;font-weight:600">${safeSubject}</p>
    <p style="margin:0 0 20px;color:#4b5563;line-height:1.5">Если вопрос решен, подтвердите закрытие. Если проблема осталась, верните тикет в работу по той же ссылке.</p>
    <p style="margin:24px 0">
      <a href="${safeUrl}" style="background:#2563eb;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">Открыть подтверждение</a>
    </p>
    <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5">Если ответа не будет, тикет закроется автоматически: ${escapeHtml(dueAt)}.</p>
    <p style="margin:18px 0 0;color:#9ca3af;font-size:12px;line-height:1.5">Ссылка: <a href="${safeUrl}" style="color:#6b7280">${safeUrl}</a></p>
  </div>
</body></html>`

  const text = [
    `Подтвердите закрытие тикета ${ticketNumber}`,
    "",
    `Тема: ${params.subject}`,
    "",
    "Если вопрос решен, подтвердите закрытие. Если проблема осталась, верните тикет в работу по ссылке:",
    params.confirmationUrl,
    "",
    `Если ответа не будет, тикет закроется автоматически: ${dueAt}.`,
  ].join("\n")

  const result = await sendEmail({
    to: params.to,
    subject: `Подтвердите закрытие тикета ${ticketNumber}`,
    html,
    text,
    organizationId: params.orgId,
    contactId: params.contactId || undefined,
    transactional: true,
  })

  if (!result?.success) {
    console.error(`[ticket-closure] email not sent to ${params.to}:`, result?.error || "unknown error")
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// ─── WhatsApp status notification ────────────────────────────────────────
//
// Ticket status changes on whatsapp-sourced tickets are now sent via a
// per-tenant Meta-approved template. The tenant configures a template name
// (per status) in ChannelConfig.settings:
//
//   { whatsappTicketStatusTemplates: {
//       in_progress: "ticket_in_progress",
//       waiting:     "ticket_waiting_info",
//       resolved:    "ticket_resolved",
//       closed:      "ticket_closed",
//     } }
//
// If the tenant has no template configured for the new status, we silently
// skip — better to send nothing than a hardcoded Azerbaijani payment
// reminder. Template body placeholders are filled with {{1}}=ticketNumber
// by default (positional). Tenants can also configure named parameters
// in Meta and the library will bind them by name.

async function sendWhatsAppStatusNotification(
  orgId: string,
  ticket: { id: string; ticketNumber: string | null; description: string | null; contactId: string | null; tags: string[] },
  newStatus: string,
): Promise<WhatsAppStatusNotificationResult> {
  // Resolve tenant's configured template mapping from ChannelConfig.settings.
  const waConfig = await prisma.channelConfig.findFirst({
    where: { organizationId: orgId, channelType: "whatsapp", isActive: true },
    select: { settings: true },
  })
  const settings = waConfig?.settings as WhatsAppTicketStatusSettings | null | undefined
  const tmplMap = settings?.whatsappTicketStatusTemplates || {}
  const templateName: string | undefined = tmplMap[newStatus]

  const ticketNumber = ticket.ticketNumber || ticket.id.slice(0, 8)

  // Plain-text fallback messages. Used only when no template is configured
  // AND the customer messaged us within the 23h session window (the
  // whatsapp library blocks text outside the window). This keeps ticket
  // notifications useful out-of-the-box for tenants who haven't set up
  // Meta templates yet. Keep the wording generic and neutral so the fact
  // that it's not a Meta-approved template isn't a policy issue.
  const fallbackTextByStatus: Record<string, string> = {
    in_progress: `Your ticket #${ticketNumber} is now being processed.`,
    waiting:     `We need more info on your ticket #${ticketNumber}. Please reply with details.`,
    resolved:    `Your ticket #${ticketNumber} has been resolved. Thank you for contacting us.`,
    closed:      `Your ticket #${ticketNumber} has been closed.`,
    escalated:   `Your ticket #${ticketNumber} has been escalated to a specialist.`,
    reopened:    `Your ticket #${ticketNumber} has been reopened.`,
  }

  // Extract phone — same heuristics as before.
  let waPhone: string | undefined
  const phoneMatch = ticket.description?.match(/\+(\d{10,15})/)
  if (phoneMatch) waPhone = phoneMatch[1]

  if (!waPhone && ticket.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: ticket.contactId, organizationId: orgId },
      select: { phone: true },
    })
    if (contact?.phone) waPhone = contact.phone.replace(/[\s\-\(\)\+]/g, "")
  }

  if (!waPhone && ticket.contactId) {
    const recentMsg = await prisma.channelMessage.findFirst({
      where: { organizationId: orgId, contactId: ticket.contactId, channelType: "whatsapp", direction: "inbound" },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    })
    const meta = recentMsg?.metadata as ChannelMessageMetadata | null | undefined
    if (typeof meta?.waPhone === "string") waPhone = meta.waPhone
  }

  if (!waPhone) {
    console.log(`[Ticket WA] No phone for status notification, ticket ${ticketNumber}`)
    return
  }

  // When the ticket transitions into "resolved" and the tenant has an
  // active survey wired to afterTicketResolve, merge the survey invite
  // into this same WhatsApp message. Customer gets ONE message with
  // "ticket resolved + please rate us: <link>" instead of two separate
  // pings arriving seconds apart. triggerSurveysOnTicketResolved sees
  // the "handledChannels" flag we return and skips the whatsapp path
  // for this ticket to avoid duplicates.
  let surveyAppendix = ""
  let surveyHandled = false
  if (newStatus === "resolved") {
    const activeSurvey = await prisma.survey.findFirst({
      where: { organizationId: orgId, status: "active" },
      select: { id: true, name: true, publicSlug: true, triggers: true },
    })
    const triggers = (activeSurvey?.triggers as SurveyTriggerSettings | null | undefined) || {}
    if (activeSurvey && triggers.afterTicketResolve) {
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "")
      // Carry the ticketId so the response links back to it (reflects onto ticket.satisfactionRating).
      // This is the OTHER survey-link builder (the resolve-notification embed); the sendSurveyInvite
      // path was fixed separately — both must append ?t= or the rating shows as "not rated".
      const qs = new URLSearchParams({ p: waPhone, t: ticket.id }).toString()
      const link = `${appUrl}/s/${activeSurvey.publicSlug}?${qs}`
      surveyAppendix = `\n\n${activeSurvey.name}\n${link}`
      surveyHandled = true
    }
  }

  const fallbackText = fallbackTextByStatus[newStatus]
  const fallbackWithSurvey = fallbackText ? fallbackText + surveyAppendix : fallbackText

  const result = templateName
    ? await sendWhatsAppMessage({
        to: waPhone,
        message: `[template:${templateName}]`,
        templateName,
        templateVariables: { "1": ticketNumber, ticketNumber },
        organizationId: orgId,
        contactId: ticket.contactId || undefined,
      })
    : fallbackWithSurvey
    ? await sendWhatsAppMessage({
        to: waPhone,
        message: fallbackWithSurvey,
        organizationId: orgId,
        contactId: ticket.contactId || undefined,
      })
    : { success: false, error: "no-template-no-fallback" }

  console.log(`[Ticket WA] Status "${newStatus}" notification to ${waPhone}: ${result.success ? "OK" : result.error}${templateName ? " (template)" : " (fallback-text)"}${surveyHandled ? " +survey" : ""}`)

  return { surveyHandled: surveyHandled && result.success }
}
