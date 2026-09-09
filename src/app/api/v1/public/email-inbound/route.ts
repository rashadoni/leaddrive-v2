import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { extractReplyToFromToHeader, parseReplyTo } from "@/lib/email-reply-address"
import { checkRateLimit, RATE_LIMIT_CONFIG } from "@/lib/rate-limit"
import { clientIp } from "@/lib/request-ip"
import { reopenTicketForCustomerReply } from "@/lib/ticket-reopen"
import { ensureConversation } from "@/lib/inbox-ensure-conversation"
import { notifyConversationRecipients } from "@/lib/social/notify-recipients"
import { Prisma } from "@prisma/client"
import { createTicketWithAssignment } from "@/lib/ticket-factory"
import { lockTicketNumberSequence, nextTicketNumber } from "@/lib/ticket-number"
import { enrichComplaintInBackground } from "@/lib/complaint-ai"
import { notifyComplaintRegistered } from "@/lib/inbox/complaint-register"
import { createTicketEntitlementMilestones } from "@/lib/entitlement-process/ticket-milestones"
import {
  buildTicketRequesterSnapshot,
  getContactRequesterSnapshot,
  resolveTicketCategoryForWrite,
} from "@/lib/ticketing/category-service"
import {
  displayNameFromEmailHeader,
  extractEmailAddresses,
  matchEmailIntakeRoute,
  type EmailIntakeRoute,
} from "@/lib/ticketing/email-intake"
import { autoExitSequenceEnrollments } from "@/lib/sequence-auto-exit"
import { firstRfcMessageId } from "@/lib/sequence-threading"
import { processGoogleAlertsInbound } from "@/lib/social/google-alerts-ingest"

// Shape posted by the Cloudflare Email Worker after it parses the raw MIME.
const inboundSchema = z.object({
  to: z.string().min(1),
  from: z.string().min(1),
  headerFrom: z.string().optional().nullable(),
  authenticationResults: z.string().optional().nullable(),
  subject: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
  html: z.string().optional().nullable(),
  messageId: z.string().optional().nullable(),
  inReplyTo: z.string().optional().nullable(),
})

// POST /api/v1/public/email-inbound
//   Shared secret: X-CF-Inbound-Secret = process.env.CF_INBOUND_SECRET
//   1. Validates the shared secret.
//   2. Extracts ticket/contact id from the `to` address (reply-to token built
//      by `buildReplyTo`). HMAC is verified inside parseReplyTo.
//   3. Creates a public TicketComment on the matching ticket.
//   4. If the ticket was already resolved, re-opens it.
//   5. Logs the inbound email into `email_logs` (direction="inbound") and
//      fires workflows on `ticket.replied`.
export async function POST(req: NextRequest) {
  const expectedSecret = process.env.CF_INBOUND_SECRET
  if (!expectedSecret) {
    return NextResponse.json({ error: "Inbound not configured" }, { status: 503 })
  }

  const providedSecret = req.headers.get("x-cf-inbound-secret")
  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Rate-limit by source IP — prevents abuse if the secret ever leaks (the
  // worker key rotating or a credentials test accidentally logging the value).
  // 600 req/min is ~10/sec — comfortably above CF Email Routing's real
  // throughput for this tenant, but stops anyone from using the endpoint as
  // a free comment-spawner.
  // clientIp(), not a bare cf-connecting-ip read. The origin is reachable
  // directly on its public address, so a caller that bypasses Cloudflare can
  // set cf-connecting-ip to anything and mint a fresh bucket per request.
  // clientIp() only honours that header when the connecting peer is inside a
  // published Cloudflare range.
  const ip = clientIp(req)
  if (!checkRateLimit(`email-inbound:${ip}`, RATE_LIMIT_CONFIG.webhook)) {
    return NextResponse.json({ error: "Too Many Requests" }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = inboundSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const payload = parsed.data

  // Google Alerts is a hidden acquisition transport, not customer email.
  // Handle its signed tenant address before ticket/contact routing so alert
  // messages can never become CRM Inbox conversations or support tickets.
  const googleAlertResult = await processGoogleAlertsInbound(payload)
  if (googleAlertResult.recognized) {
    return NextResponse.json(googleAlertResult.body, { status: googleAlertResult.status })
  }

  const body_text = payload.text || (payload.html ? stripHtml(payload.html) : "")
  if (!body_text.trim()) {
    return NextResponse.json({ success: false, skipped: "empty_body" }, { status: 202 })
  }

  // 1) Pull the tracked recipient token out of the "To:" header.
  const token =
    extractReplyToFromToHeader(payload.to) ?? parseReplyTo(payload.to)
  if (!token.ok) {
    const routed = await handleConfiguredEmailIntake(payload, body_text)
    if (routed) return routed

    // Unrecognized destination — log and 202 so the worker doesn't retry.
    console.warn("[email-inbound] unrecognized recipient:", payload.to, token.reason)
    return NextResponse.json({ success: false, skipped: "unrecognized_recipient" }, { status: 202 })
  }

  try {
    if (token.kind === "ticket") {
      // RLS phase 1 — org resolution: the reply-token carries a raw ticket id
      // with no tenant context yet, so the lookup runs bypass-scoped.
      const ticket = await runWithRlsBypass(() =>
        prisma.ticket.findFirst({
          where: { id: token.id },
          select: {
            id: true,
            organizationId: true,
            contactId: true,
          },
        })
      )
      if (!ticket) {
        return NextResponse.json({ success: false, skipped: "ticket_not_found" }, { status: 202 })
      }

      // RLS phase 2 — all remaining ticket-branch work runs tenant-scoped.
      return await runWithTenant(ticket.organizationId, async () => {
      const trimmed = stripReplyQuotes(body_text).slice(0, 10000)

      // reopenTicketForCustomerReply handles: comment creation, reopen (if resolved),
      // audit log, workflow fire, and ticket.updated webhook. The 📧 prefix is passed
      // via commentOverride so the UI can render the "via email" badge client-side
      // without an extra JOIN against email_logs.
      const result = await reopenTicketForCustomerReply({
        organizationId: ticket.organizationId,
        channel: "email",
        customerMessage: trimmed,
        ticketId: ticket.id,
        commentOverride: `📧 ${trimmed}`,
      })

      // emailLog is email-channel-specific — not emitted by the shared helper. Idempotency ([P3]):
      // skip if a log with this messageId already exists for the org (duplicate provider redelivery).
      const ticketInboundId = firstRfcMessageId(payload.messageId)
      const ticketEmailLogDupe = ticketInboundId
        ? await prisma.emailLog.findFirst({
            where: { organizationId: ticket.organizationId, messageId: ticketInboundId },
            select: { id: true },
          }).catch(() => null)
        : null
      if (!ticketEmailLogDupe) {
        await prisma.emailLog.create({
          data: {
            organizationId: ticket.organizationId,
            direction: "inbound",
            fromEmail: payload.from.slice(0, 255),
            toEmail: payload.to.slice(0, 255),
            subject: (payload.subject || "").slice(0, 500),
            body: trimmed,
            status: "received",
            messageId: ticketInboundId,
            inReplyTo: firstRfcMessageId(payload.inReplyTo),
            contactId: ticket.contactId || null,
          },
        }).catch(() => {})
      }

      // Cadence auto-exit: the customer replied — stop their active sequence
      // enrollments (never throws; awaited INSIDE the tenant scope).
      await autoExitSequenceEnrollments({
        organizationId: ticket.organizationId,
        trigger: "replied",
        contactId: ticket.contactId,
        email: extractEmailAddresses(payload.from)[0] || null,
        // E2: a third party replying into the thread must alert, not exit
        fromEmail: extractEmailAddresses(payload.from)[0] || null,
      })

      return NextResponse.json({ success: true, data: { ticketId: ticket.id, reopened: result.reopened } })
      }) // end runWithTenant (ticket branch)
    }

    // kind === "contact" — reply to a portal registration / survey etc.
    // Try to attach as a comment on the most recent open ticket for that contact,
    // otherwise just log it so it doesn't get silently dropped.
    // RLS phase 1 — org resolution: raw contact id from the reply-token,
    // bypass-scoped lookup only.
    const contact = await runWithRlsBypass(() =>
      prisma.contact.findFirst({
        where: { id: token.id },
        select: { id: true, organizationId: true, fullName: true },
      })
    )
    if (!contact) {
      return NextResponse.json({ success: false, skipped: "contact_not_found" }, { status: 202 })
    }
    // RLS phase 2 — all remaining contact-branch work runs tenant-scoped
    // (including the fire-and-forget inbox-ingest IIFE, which starts inside
    // this scope and therefore inherits the tenant context).
    return await runWithTenant(contact.organizationId, async () => {
    const openTicket = await prisma.ticket.findFirst({
      where: { contactId: contact.id, status: { notIn: ["closed", "resolved"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, subject: true },
    })

    if (openTicket) {
      await prisma.ticketComment.create({
        data: {
          ticketId: openTicket.id,
          comment: `📧 ${stripReplyQuotes(body_text).slice(0, 10000)}`,
          isInternal: false,
        },
      })
    }

    // Idempotency ([P3]): a duplicate provider redelivery of the same messageId must not double the
    // email_logs row (the A2 ChannelMessage below is already unique-guarded; this closes the audit-log
    // asymmetry). Skip the insert if a log with this messageId already exists for the org.
    const contactInboundId = firstRfcMessageId(payload.messageId)
    const emailLogDupe = contactInboundId
      ? await prisma.emailLog.findFirst({
          where: { organizationId: contact.organizationId, messageId: contactInboundId },
          select: { id: true },
        }).catch(() => null)
      : null
    if (!emailLogDupe) {
      await prisma.emailLog.create({
        data: {
          organizationId: contact.organizationId,
          direction: "inbound",
          fromEmail: payload.from.slice(0, 255),
          toEmail: payload.to.slice(0, 255),
          subject: (payload.subject || "").slice(0, 500),
          body: body_text.slice(0, 10000),
          status: "received",
          messageId: contactInboundId,
          // E1/E2 sequence threading: which of OUR emails this reply answers.
          // Both ids are sender-controlled — normalised to the first safe
          // <id> token (multi-id/whitespace headers tolerated, junk dropped).
          inReplyTo: firstRfcMessageId(payload.inReplyTo),
          contactId: contact.id,
        },
      }).catch(() => {})
    }

    // A2 — ingest as inbox ChannelMessage so the contact's email reply appears in the unified Inbox UI.
    // Fire-and-forget: the 200 to the CF Worker is already committed; fail-soft.
    ;(async () => {
      try {
        // Idempotency guard 1/2 (sequential retries): skip if we already ingested this
        // provider message-id. The partial UNIQUE index on (organizationId, externalId)
        // — WHERE direction='inbound' AND channelType IN ('sms','email') — is guard 2/2
        // for the CONCURRENT-retry race the catch below handles.
        if (payload.messageId) {
          const existing = await prisma.channelMessage.findFirst({
            where: { organizationId: contact.organizationId, externalId: payload.messageId },
            select: { id: true },
          })
          if (existing) return
        }

        const msg = await prisma.channelMessage.create({
          data: {
            organizationId: contact.organizationId,
            direction: "inbound",
            channelType: "email",
            from: payload.from.slice(0, 255),
            to: payload.to.slice(0, 255),
            subject: (payload.subject || "").slice(0, 500),
            body: body_text.slice(0, 10000),
            externalId: payload.messageId || undefined,
            contactId: contact.id,
          },
        })

        const conv = await ensureConversation(contact.organizationId, {
          channel: "email",
          contactId: contact.id,
          contactEmail: payload.from,
          messageIds: [msg.id],
          reopenOnInbound: true,
        })

        await notifyConversationRecipients(contact.organizationId, conv.id, conv.assignedTo, {
          type: "info",
          title: "New email reply",
          message: `Inbound email from ${payload.from}`,
          entityType: "inbox_message",
          entityId: conv.id,
          kind: "inbox.message",
        })
        try {
          const { emitConversationIngestEvents } = await import("@/lib/inbox/conversation-events")
          await emitConversationIngestEvents({
            organizationId: contact.organizationId,
            conversationId: conv.id,
            wasCreated: conv.wasCreated,
            senderEmail: extractEmailAddresses(payload.from)[0] || null,
          })
        } catch (eventError) {
          console.error("[email-inbound] conversation flow event failed:", eventError)
        }
      } catch (e) {
        // P2002 = a concurrent provider retry lost the unique-index race; the winning
        // request already ingested this messageId. Expected idempotent outcome — skip
        // quietly instead of logging a scary error.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          return
        }
        console.error("[email-inbound] inbox-ingest failed:", e)
      }
    })()

    // Cadence auto-exit: the contact replied — stop their active sequence
    // enrollments (never throws; awaited INSIDE the tenant scope).
    await autoExitSequenceEnrollments({
      organizationId: contact.organizationId,
      trigger: "replied",
      contactId: contact.id,
      email: extractEmailAddresses(payload.from)[0] || null,
      // E2: a third party replying into the thread must alert, not exit
      fromEmail: extractEmailAddresses(payload.from)[0] || null,
    })

    return NextResponse.json({
      success: true,
      data: { contactId: contact.id, attachedTo: openTicket?.id || null },
    })
    }) // end runWithTenant (contact branch)
  } catch (e) {
    console.error("[email-inbound] processing failed:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

type InboundEmailPayload = z.infer<typeof inboundSchema>

async function handleConfiguredEmailIntake(payload: InboundEmailPayload, bodyText: string): Promise<NextResponse | null> {
  const channels = await runWithRlsBypass(() =>
    prisma.channelConfig.findMany({
      where: { channelType: "email", isActive: true },
      select: { id: true, organizationId: true, configName: true, settings: true },
    })
  )

  const match = matchEmailIntakeRoute(payload.to, channels)
  if (!match.ok) {
    if (match.reason === "ambiguous") {
      console.warn("[email-inbound] ambiguous configured intake recipient:", payload.to)
      return NextResponse.json({ success: false, skipped: "ambiguous_email_intake" }, { status: 202 })
    }
    return null
  }

  return runWithTenant(match.channel.organizationId, async () => {
    if (payload.messageId) {
      const existing = await prisma.emailLog.findFirst({
        where: { organizationId: match.channel.organizationId, messageId: payload.messageId },
        select: { id: true },
      }).catch(() => null)
      if (existing) {
        return NextResponse.json({ success: false, skipped: "duplicate_message" }, { status: 202 })
      }
    }

    const trimmed = stripReplyQuotes(bodyText).slice(0, 10000)
    if (!trimmed) return NextResponse.json({ success: false, skipped: "empty_body" }, { status: 202 })

    const contact = await findOrCreateEmailContact(
      match.channel.organizationId,
      payload.from,
      match.route.source || "email",
    )

    // Cadence auto-exit: inbound email from this person — stop their active
    // sequence enrollments (never throws; a just-created contact simply has none).
    await autoExitSequenceEnrollments({
      organizationId: match.channel.organizationId,
      trigger: "replied",
      contactId: contact.contactId,
      email: contact.requesterEmail,
      fromEmail: contact.requesterEmail,
    })

    const subject = (payload.subject || `Email from ${contact.requesterName || contact.requesterEmail || payload.from}`).slice(0, 300)
    const sourceMeta = {
      channelConfigId: match.channel.id,
      intakeAddress: match.matchedAddress,
      messageId: payload.messageId || null,
      from: payload.from,
      to: payload.to,
      target: match.route.target,
    }

    const created = match.route.target === "complaint"
      ? await createComplaintFromConfiguredEmail({
          orgId: match.channel.organizationId,
          route: match.route,
          subject,
          body: trimmed,
          contactId: contact.contactId,
          companyId: contact.companyId,
          requesterName: contact.requesterName,
          requesterEmail: contact.requesterEmail,
          sourceMeta,
        })
      : await createTicketWithAssignment({
          organizationId: match.channel.organizationId,
          subject,
          description: trimmed,
          priority: ticketPriorityFromRoute(match.route.priority),
          categoryId: match.route.categoryId,
          category: match.route.category || "general",
          contactId: contact.contactId,
          companyId: contact.companyId,
          source: "email",
          sourceMeta,
          requesterName: contact.requesterName,
          requesterEmail: contact.requesterEmail,
        })

    await logInboundEmail({
      orgId: match.channel.organizationId,
      payload,
      body: trimmed,
      contactId: contact.contactId,
    })

    ingestInboundEmailConversation({
      orgId: match.channel.organizationId,
      payload,
      body: trimmed,
      contactId: contact.contactId,
      channelConfigId: match.channel.id,
      intakeTarget: match.route.target,
      ticketId: created.id,
    }).catch((error) => {
      console.error("[email-inbound] configured intake conversation ingest failed:", error)
    })

    return NextResponse.json({
      success: true,
      data: {
        target: match.route.target,
        ticketId: created.id,
        ticketNumber: created.ticketNumber,
        intakeAddress: match.matchedAddress,
      },
    }, { status: 201 })
  })
}

async function findOrCreateEmailContact(orgId: string, fromHeader: string, source: string): Promise<{
  contactId: string | null
  companyId: string | null
  requesterName: string | null
  requesterEmail: string | null
}> {
  const email = extractEmailAddresses(fromHeader)[0] || null
  const displayName = displayNameFromEmailHeader(fromHeader)
  if (!email) {
    return { contactId: null, companyId: null, requesterName: displayName || fromHeader.slice(0, 200), requesterEmail: null }
  }

  const existing = await prisma.contact.findFirst({
    where: { organizationId: orgId, email },
    select: { id: true, companyId: true, fullName: true, email: true },
  })
  if (existing) {
    return {
      contactId: existing.id,
      companyId: existing.companyId,
      requesterName: existing.fullName || existing.email,
      requesterEmail: existing.email,
    }
  }

  const created = await prisma.contact.create({
    data: {
      organizationId: orgId,
      fullName: displayName || email,
      email,
      source,
    },
    select: { id: true, fullName: true, email: true },
  })
  return {
    contactId: created.id,
    companyId: null,
    requesterName: created.fullName || created.email,
    requesterEmail: created.email,
  }
}

function ticketPriorityFromRoute(priority?: string | null): "low" | "medium" | "high" | "critical" {
  if (priority === "low" || priority === "medium" || priority === "high" || priority === "critical") return priority
  if (priority === "urgent") return "critical"
  return "medium"
}

function complaintPriorityFromRoute(priority?: string | null): string {
  if (priority === "low" || priority === "medium" || priority === "high" || priority === "urgent" || priority === "critical") return priority
  return "medium"
}

async function createComplaintFromConfiguredEmail(input: {
  orgId: string
  route: EmailIntakeRoute
  subject: string
  body: string
  contactId: string | null
  companyId: string | null
  requesterName: string | null
  requesterEmail: string | null
  sourceMeta: Prisma.InputJsonObject
}): Promise<{ id: string; ticketNumber: string; subject: string }> {
  const category = await resolveTicketCategoryForWrite(input.orgId, {
    categoryId: input.route.categoryId || undefined,
    category: input.route.category || "complaint",
    scope: "complaint",
  })
  const requesterSnapshot = input.contactId
    ? await getContactRequesterSnapshot(input.orgId, input.contactId)
    : buildTicketRequesterSnapshot({
        name: input.requesterName,
        email: input.requesterEmail,
        meta: { source: input.route.source || "email" },
      })

  const ticket = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await lockTicketNumberSequence(input.orgId, tx)
    const ticketNumber = await nextTicketNumber(input.orgId, tx)
    const created = await tx.ticket.create({
      data: {
        organizationId: input.orgId,
        ticketNumber,
        subject: input.subject,
        description: input.body,
        priority: complaintPriorityFromRoute(input.route.priority),
        status: "open",
        category: "complaint",
        categoryId: category.categoryId,
        contactId: input.contactId,
        companyId: input.companyId,
        source: "email",
        sourceMeta: input.sourceMeta as Prisma.InputJsonValue,
        ...requesterSnapshot,
      },
    })
    await tx.complaintMeta.create({
      data: {
        organizationId: input.orgId,
        ticketId: created.id,
        complaintType: input.route.complaintType || "complaint",
      },
    })
    await createTicketEntitlementMilestones(tx, {
      organizationId: input.orgId,
      ticketId: created.id,
      companyId: created.companyId,
      ticketCreatedAt: created.createdAt,
      priority: created.priority,
    })
    return created
  })

  logAudit(input.orgId, "create", "complaint", ticket.id, ticket.subject)
  enrichComplaintInBackground(ticket.id, input.orgId).catch(() => {})
  notifyComplaintRegistered(input.orgId, ticket.id).catch(() => {})
  return ticket
}

async function logInboundEmail(input: {
  orgId: string
  payload: InboundEmailPayload
  body: string
  contactId: string | null
}) {
  await prisma.emailLog.create({
    data: {
      organizationId: input.orgId,
      direction: "inbound",
      fromEmail: input.payload.from.slice(0, 255),
      toEmail: input.payload.to.slice(0, 255),
      subject: (input.payload.subject || "").slice(0, 500),
      body: input.body,
      status: "received",
      messageId: input.payload.messageId || null,
      contactId: input.contactId,
    },
  }).catch(() => {})
}

async function ingestInboundEmailConversation(input: {
  orgId: string
  payload: InboundEmailPayload
  body: string
  contactId: string | null
  channelConfigId: string
  intakeTarget: "ticket" | "complaint"
  ticketId: string
}) {
  if (!input.contactId) return
  if (input.payload.messageId) {
    const existing = await prisma.channelMessage.findFirst({
      where: { organizationId: input.orgId, externalId: input.payload.messageId },
      select: { id: true },
    })
    if (existing) return
  }

  const msg = await prisma.channelMessage.create({
    data: {
      organizationId: input.orgId,
      channelConfigId: input.channelConfigId,
      direction: "inbound",
      channelType: "email",
      from: input.payload.from.slice(0, 255),
      to: input.payload.to.slice(0, 255),
      subject: (input.payload.subject || "").slice(0, 500),
      body: input.body,
      externalId: input.payload.messageId || undefined,
      contactId: input.contactId,
      metadata: {
        intakeTarget: input.intakeTarget,
        ticketId: input.ticketId,
      },
    },
  }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null
    throw error
  })
  if (!msg) return

  const conv = await ensureConversation(input.orgId, {
    channel: "email",
    contactId: input.contactId,
    contactEmail: extractEmailAddresses(input.payload.from)[0] || input.payload.from,
    messageIds: [msg.id],
    reopenOnInbound: true,
  })

  await notifyConversationRecipients(input.orgId, conv.id, conv.assignedTo, {
    type: input.intakeTarget === "complaint" ? "warning" : "info",
    title: input.intakeTarget === "complaint" ? "New complaint email" : "New support email",
    message: `Inbound email from ${input.payload.from}`,
    entityType: "inbox_message",
    entityId: conv.id,
    kind: "inbox.message",
  })
}

// Very light HTML → text conversion — mirrors what's in src/lib/email.ts
// without pulling the whole module in (this endpoint runs on server-only paths).
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// Strip quoted previous messages ("> On 2026-01-01, X wrote:") so we only keep
// the actual reply body. Not perfect but good enough for 95% of Gmail replies.
function stripReplyQuotes(text: string): string {
  const lines = text.split("\n")
  const cut = lines.findIndex((l) => /^On .+wrote:$/i.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l.trim()))
  const kept = cut >= 0 ? lines.slice(0, cut) : lines
  return kept.filter((l) => !/^>/.test(l.trim())).join("\n").trim()
}
