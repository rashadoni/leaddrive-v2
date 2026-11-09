import type { Prisma, Ticket } from "@prisma/client"
import { z } from "zod"
import { selectWhatsAppAutomationChannel } from "@/lib/channels/whatsapp-settings-channel"
import { prisma, logAudit } from "@/lib/prisma"
import { getFieldPermissions, filterWritableFields } from "@/lib/field-filter"
import { sendWhatsAppMessage } from "@/lib/whatsapp"
import { sendEmail } from "@/lib/email"
import { executeWorkflows } from "@/lib/workflow-engine"
import { fireWebhooks } from "@/lib/webhooks"
import { triggerSurveysOnTicketResolved } from "@/lib/survey-triggers"
import { LEGACY_TICKET_CATEGORY_SLUGS } from "@/lib/ticketing/categories"
import {
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
  milestoneTypesForStatusChange,
} from "@/lib/entitlement-process/ticket-milestones"
import type { MilestoneType } from "@/lib/entitlement-process/types"
import { loadCustomerLanguage, type CustomerLanguageContext } from "@/lib/ticketing/customer-locale"
import {
  closureRequestEmail,
  closureRequestWhatsAppText,
  ticketStatusWhatsAppText,
} from "@/lib/ticketing/customer-ticket-text"
import type { CrmCommandActorContext } from "../actor-context"
import {
  dispatchOrDeferCommandEffects,
  type CrmCommandExecutionContext,
} from "../execution-context"
import { CrmCommandError, notFoundError, staleWriteError, validationError } from "../errors"
import { requireWritableFields } from "../field-permissions"

/**
 * Правка тикета — одна команда для экрана (`PUT /api/v1/tickets/[id]`) и для
 * голоса («переведи тикет TK-0012 в работу», этап 4, владелец 2026-11-09).
 *
 * Перенесено из маршрута без изменения поведения экрана: та же проверка
 * реестра жалоб, те же отметки SLA, то же клиенту — уведомление о статусе в
 * WhatsApp, запрос подтверждения закрытия, опрос. Внутри чужой транзакции
 * (голос) запись тикета идёт в ней, а всё, что уходит наружу, — после коммита.
 *
 * Голос меняет только статус, приоритет и ответственного, и только с версией,
 * которую видел подтверждающий.
 */

type WhatsAppStatusNotificationResult = { surveyHandled: boolean } | undefined
type WhatsAppTicketStatusSettings = {
  whatsappTicketStatusTemplates?: Record<string, string>
  whatsappTicketStatusTemplateLanguages?: Record<string, string>
  whatsappSurveyTemplate?: string
}
type ChannelMessageMetadata = {
  waPhone?: unknown
}
type SurveyTriggerSettings = {
  afterTicketResolve?: boolean
}

export const updateTicketCommandSchema = z.object({
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

function milestoneTypesForTicketUpdate(
  oldStatus: string,
  newStatus: string | undefined,
  isEscalation: boolean,
): MilestoneType[] {
  const types = new Set<MilestoneType>(milestoneTypesForStatusChange(oldStatus, newStatus))
  if (isEscalation) types.add("escalation")
  return [...types]
}


/** Что голос может поменять в тикете. */
export const VOICE_TICKET_UPDATE_FIELDS = ["status", "priority", "assignedTo"] as const
const VOICE_FIELDS: ReadonlySet<string> = new Set(VOICE_TICKET_UPDATE_FIELDS)

type ClosureRequest = Awaited<ReturnType<typeof createTicketClosureRequestForTicket>>

export interface UpdateTicketCommandResult {
  entity: Ticket
  /** Запрос подтверждения закрытия; внутри чужой транзакции создаётся после коммита и здесь null. */
  closureRequest: ClosureRequest | null
}

function readExpectedUpdatedAt(body: Record<string, unknown>): Date | null {
  const raw = body.expectedUpdatedAt
  if (raw === undefined) return null
  const parsed = typeof raw === "string" ? new Date(raw) : null
  if (!parsed || Number.isNaN(parsed.getTime())) throw validationError("Invalid expectedUpdatedAt")
  return parsed
}

export async function updateTicketCommand(
  actor: CrmCommandActorContext,
  ticketId: string,
  rawBody: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<UpdateTicketCommandResult> {
  const orgId = actor.organizationId
  const role = actor.role
  const id = ticketId
  const db = execution?.transaction ?? prisma
  const body = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
    ? { ...(rawBody as Record<string, unknown>) }
    : {}
  const expectedUpdatedAt = readExpectedUpdatedAt(body)
  delete body.expectedUpdatedAt

  let writable: Record<string, unknown>
  if (actor.source === "rest") {
    const preFieldPerms = await getFieldPermissions(orgId, role, "ticket")
    writable = filterWritableFields(body, preFieldPerms, role)
  } else {
    const forbidden = Object.keys(body).filter((field) => !VOICE_FIELDS.has(field))
    if (forbidden.length > 0) {
      throw new CrmCommandError("FORBIDDEN_FIELD", `Fields are not available to voice: ${forbidden.join(", ")}`, 403, { fields: forbidden })
    }
    if (!expectedUpdatedAt) throw validationError("expectedUpdatedAt is required for voice updates")
    if (Object.keys(body).length === 0) throw validationError("No writable fields")
    const permissions = await getFieldPermissions(orgId, role, "ticket")
    writable = requireWritableFields(body, permissions, role)
  }
  const parsed = updateTicketCommandSchema.safeParse(writable)
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid ticket update")

  // Fetch original ticket to detect status change
  const original = await db.ticket.findFirst({
    where: { id, organizationId: orgId },
  })
  if (!original) throw notFoundError("Ticket not found")
  if (expectedUpdatedAt && original.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw staleWriteError()

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
    const hasComplaint = await db.complaintMeta.findUnique({
      where: { ticketId: id },
      select: { id: true },
    })
    if (hasComplaint) {
      throw new CrmCommandError(
        "CONFLICT",
        "Нельзя снять флаг жалобы — тикет находится в реестре жалоб",
        409,
      )
    }
  }

  // Голос назначает только активного сотрудника этой организации; экран — как раньше.
  if (actor.source !== "rest" && parsed.data.assignedTo) {
    const assignee = await db.user.findFirst({
      where: { id: parsed.data.assignedTo, organizationId: orgId, isActive: true },
      select: { id: true },
    })
    if (!assignee) throw validationError("Assignee must be an active member of this organization")
  }

  const fieldPerms = await getFieldPermissions(orgId, role, "ticket")
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

  const changed = await db.ticket.updateMany({
    where: {
      id,
      organizationId: orgId,
      ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}),
    },
    data: filteredUpdateData as Prisma.TicketUpdateManyMutationInput,
  })
  if (expectedUpdatedAt && changed.count === 0) throw staleWriteError()

  const updated = await db.ticket.findFirst({
    where: { id, organizationId: orgId },
    include: { comments: { orderBy: { createdAt: "desc" } } },  // TicketComment has no organizationId — safe (FK-scoped child)
  })

  // Всё, что следует за записью: клиенту (WhatsApp о статусе, запрос
  // подтверждения закрытия, опрос), журнал, автоматизации, вебхуки, SLA.
  const afterUpdate = async (): Promise<ClosureRequest | null> => {
    let closureRequest: ClosureRequest | null = null
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

    logAudit(orgId, "update", "ticket", id, original.subject, {
      newValue: parsed.data,
      ...(actor.source !== "rest" && actor.userId ? { userId: actor.userId } : {}),
    })
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
            actorUserId: actor.userId,
          })
        } catch (error) {
          console.error("[ticket-milestones] ticket update milestone sync failed:", error)
        }
      }

      // Fire survey triggers when ticket transitions to resolved (§8 trigger).
      // Wait for the WhatsApp status-notification to finish so we can tell
      // the survey trigger whether it already embedded the survey link.
      if (oldStatus !== "resolved" && updated.status === "resolved") {
        const customer = await loadCustomerLanguage({ organizationId: orgId, contactId: updated.contactId })
        const request = await createTicketClosureRequestForTicket({
          orgId,
          ticket: updated,
          requestedBy: actor.userId,
          locale: customer.locale,
        })
        closureRequest = request
        if (request.channel === "whatsapp" && request.recipient) {
          const closureRecipient = request.recipient
          const confirmationUrl = request.confirmationUrl
          selectWhatsAppAutomationChannel(orgId, closureRecipient).then(selection => selection.id ? sendWhatsAppMessage({
            to: closureRecipient,
            organizationId: orgId,
            channelConfigId: selection.id,
            contactId: updated.contactId || undefined,
            message: closureRequestWhatsAppText(customer.locale, {
              ticketNumber: updated.ticketNumber,
              confirmationUrl,
            }),
            forceText: true,
          }) : undefined).catch(err => console.error("[ticket-closure] whatsapp request failed:", err))
        } else if (request.recipient && request.recipient.includes("@")) {
          sendTicketClosureEmail({
            to: request.recipient,
            orgId,
            contactId: updated.contactId,
            customer,
            ticketNumber: updated.ticketNumber,
            subject: updated.subject,
            dueAt: request.dueAt,
            confirmationUrl: request.confirmationUrl,
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
    return closureRequest
  }

  if (!updated) throw notFoundError("Ticket not found")
  if (execution?.transaction) {
    dispatchOrDeferCommandEffects(execution, async () => { await afterUpdate() })
    return { entity: updated, closureRequest: null }
  }
  return { entity: updated, closureRequest: await afterUpdate() }
}

async function sendTicketClosureEmail(params: {
  to: string
  orgId: string
  contactId: string | null
  customer: CustomerLanguageContext
  ticketNumber: string | null
  subject: string
  dueAt: Date
  confirmationUrl: string
}) {
  const email = closureRequestEmail(params.customer.locale, {
    ticketNumber: params.ticketNumber,
    subject: params.subject,
    dueAt: params.dueAt,
    timezone: params.customer.timezone,
    confirmationUrl: params.confirmationUrl,
  })

  const result = await sendEmail({
    to: params.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    organizationId: params.orgId,
    contactId: params.contactId || undefined,
    transactional: true,
  })

  if (!result?.success) {
    console.error(`[ticket-closure] email not sent to ${params.to}:`, result?.error || "unknown error")
  }
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
  const ticketNumber = ticket.ticketNumber || ticket.id.slice(0, 8)

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

  const selection = await selectWhatsAppAutomationChannel(orgId, waPhone)
  if (!selection.id) return
  // Resolve tenant's configured template mapping from ChannelConfig.settings.
  const waConfig = await prisma.channelConfig.findFirst({
    where: { id: selection.id, organizationId: orgId, channelType: "whatsapp", isActive: true },
    select: { settings: true },
  })
  const settings = waConfig?.settings as WhatsAppTicketStatusSettings | null | undefined
  const tmplMap = settings?.whatsappTicketStatusTemplates || {}
  const templateName: string | undefined = tmplMap[newStatus]

  // Saving an empty dropdown explicitly disables this notification. Older
  // tenants with no settings key retain their existing session-text fallback.
  if (settings && Object.hasOwn(settings, "whatsappTicketStatusTemplates") && !templateName) return

  // When the ticket transitions into "resolved" and the tenant has an
  // active survey wired to afterTicketResolve, merge the survey invite
  // into this same WhatsApp message. Customer gets ONE message with
  // "ticket resolved + please rate us: <link>" instead of two separate
  // pings arriving seconds apart. triggerSurveysOnTicketResolved sees
  // the "handledChannels" flag we return and skips the whatsapp path
  // for this ticket to avoid duplicates.
  let surveyAppendix = ""
  let surveyHandled = false
  // Only legacy session-text notifications can embed a survey. A status
  // template has no survey link; configured survey templates (or explicit
  // off) belong to the standalone survey sender and must not be bypassed.
  if (newStatus === "resolved" && !templateName && !Object.hasOwn(settings || {}, "whatsappSurveyTemplate")) {
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

  // Plain-text fallback message. Used only when no template is configured
  // AND the customer messaged us within the 23h session window (the
  // whatsapp library blocks text outside the window). This keeps ticket
  // notifications useful out-of-the-box for tenants who haven't set up
  // Meta templates yet. Keep the wording generic and neutral so the fact
  // that it's not a Meta-approved template isn't a policy issue. In the
  // customer's language — until 2026-10-17 it was English for everyone.
  const fallbackLocale = templateName
    ? null
    : (await loadCustomerLanguage({ organizationId: orgId, contactId: ticket.contactId })).locale
  const fallbackText = fallbackLocale ? ticketStatusWhatsAppText(fallbackLocale, newStatus, ticketNumber) : null
  const fallbackWithSurvey = fallbackText ? fallbackText + surveyAppendix : fallbackText

  const result = templateName
    ? await sendWhatsAppMessage({
        to: waPhone,
        message: `[template:${templateName}]`,
        templateName,
        templateLanguage: settings?.whatsappTicketStatusTemplateLanguages?.[newStatus] || undefined,
        templateVariables: { "1": ticketNumber, ticketNumber },
        organizationId: orgId,
        channelConfigId: selection.id,
        contactId: ticket.contactId || undefined,
      })
    : fallbackWithSurvey
    ? await sendWhatsAppMessage({
        to: waPhone,
        message: fallbackWithSurvey,
        organizationId: orgId,
        channelConfigId: selection.id,
        contactId: ticket.contactId || undefined,
      })
    : { success: false, error: "no-template-no-fallback" }

  console.log(`[Ticket WA] Status "${newStatus}" notification to ${waPhone}: ${result.success ? "OK" : result.error}${templateName ? " (template)" : " (fallback-text)"}${surveyHandled ? " +survey" : ""}`)

  return { surveyHandled: surveyHandled && result.success }
}
