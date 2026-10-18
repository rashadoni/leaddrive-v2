import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { getPortalUser } from "@/lib/portal-auth"
import { customerDescriptionForStorage, portalTicketSubject } from "@/lib/ticketing/portal-ticket-view"
import { ASSISTANT_CHAT_TICKET_DESCRIPTION_HEAD, chatTicketDescription, type ChatTicketMessage } from "@/lib/ticketing/chat-transcript"
import { assistantChatMessages, copyAssistantChatToComments } from "@/lib/ticketing/assistant-chat-ticket"
import { enrichComplaintInBackground } from "@/lib/complaint-ai"
import { resolveTicketSla } from "@/lib/sla-resolver"
import { createTicketWithAssignment } from "@/lib/ticket-factory"
import { lockTicketNumberSequence, nextTicketNumber } from "@/lib/ticket-number"
import { createTicketEntitlementMilestones } from "@/lib/entitlement-process/ticket-milestones"
import {
  buildTicketRequesterSnapshot,
  resolveTicketCategoryForWrite,
} from "@/lib/ticketing/category-service"
import { featureFlagsToArray } from "@/lib/modules"

type PortalComplaintMeta = {
  brand?: string | null
  productCategory?: string | null
  complaintObject?: string | null
  complaintObjectDetail?: string | null
  complaintType?: "complaint" | "suggestion"
}

const createPortalTicketSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).optional().default(""),
  // The portal chat widget's «create ticket» button: the customer's own Da Vinci chat session,
  // which becomes the ticket's description in place of `description`.
  chatSessionId: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().max(100).optional().default("general"),
  clientRequestId: z.string().uuid().optional(),
  isComplaint: z.boolean().optional().default(false),
  complaintMeta: z.object({
    brand: z.string().max(200).nullable().optional(),
    productCategory: z.string().max(200).nullable().optional(),
    complaintObject: z.string().max(300).nullable().optional(),
    complaintObjectDetail: z.string().max(300).nullable().optional(),
    complaintType: z.enum(["complaint", "suggestion"]).optional(),
  }).optional().default({}),
})

export async function GET() {
  const user = await getPortalUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // RLS: org comes from the verified portal JWT — query runs tenant-scoped.
  const tickets = await runWithTenant(user.organizationId, () =>
    prisma.ticket.findMany({
      where: {
        organizationId: user.organizationId,
        contactId: user.contactId,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        status: true,
        category: true,
        categoryRef: { select: { name: true, slug: true } },
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
        closedAt: true,
        slaDueAt: true,
        slaFirstResponseDueAt: true,
        firstResponseAt: true,
      },
    })
  )

  return NextResponse.json({
    success: true,
    data: tickets.map((ticket: { subject: string }) => ({ ...ticket, subject: portalTicketSubject(ticket.subject) })),
  })
}

export async function POST(req: NextRequest) {
  const user = await getPortalUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsed = createPortalTicketSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  const { subject, category, clientRequestId, isComplaint, chatSessionId } = parsed.data
  const meta: PortalComplaintMeta = parsed.data.complaintMeta

  // RLS: org comes from the verified portal JWT — whole handler runs
  // tenant-scoped (the fire-and-forget AI enrichment starts inside the
  // scope and inherits it).
  return await runWithTenant(user.organizationId, async () => {
  // A ticket from the chat widget's button carries the chat as the server holds it, read from the
  // customer's own session — written like the escalation's, so the agent's page shows it as the chat
  // and the portal as the ticket's conversation (assistant-chat-ticket.ts). Until 2026-10-19 the
  // widget sent the chat it had built in the browser as the description, which no reader can trust.
  let chat: ChatTicketMessage[] | null = null
  if (chatSessionId) {
    const session = await prisma.aiChatSession.findFirst({
      where: { id: chatSessionId, organizationId: user.organizationId, portalUserId: user.contactId },
      select: { id: true },
    })
    if (!session) return NextResponse.json({ error: "Chat session not found" }, { status: 404 })
    chat = await assistantChatMessages(session.id)
  }
  // Stored so that no reader takes it for a transcript a chat channel wrote (portal-ticket-view.ts).
  const description = chat
    ? chatTicketDescription([ASSISTANT_CHAT_TICKET_DESCRIPTION_HEAD, "", `Сессия: ${chatSessionId}`], chat)
    : customerDescriptionForStorage(parsed.data.description)

  if (clientRequestId) {
    const existing = await prisma.ticket.findFirst({
      where: {
        organizationId: user.organizationId,
        contactId: user.contactId,
        source: "portal",
        sourceMeta: { path: ["clientRequestId"], equals: clientRequestId },
      },
    })
    if (existing) {
      return NextResponse.json({ success: true, data: existing, replayed: true })
    }
  }

  // Only honour isComplaint if the tenant actually has the feature enabled.
  let complaintsEnabled = false
  if (isComplaint) {
    const org = await prisma.organization.findFirst({
      where: { id: user.organizationId },
      select: { features: true },
    })
    // Тот же разбор, что и везде: и список, и запакованная в строку форма.
    complaintsEnabled = featureFlagsToArray(org?.features).includes("complaints_register")
  }

  const resolvedCategory = await resolveTicketCategoryForWrite(user.organizationId, {
    category: complaintsEnabled ? "complaint" : category,
    scope: complaintsEnabled ? "complaint" : "ticket",
  })

  // SLA window (company → priority-based) via the shared resolver, so
  // portal-raised tickets are tracked + escalated like any other.
  const sla = await resolveTicketSla(user.organizationId, {
    companyId: user.companyId,
    priority: resolvedCategory.defaultPriority || "medium",
  })
  // Portal callers cannot self-assign an internal urgency. The selected ticket
  // category's configured default remains authoritative.
  const effectivePriority = resolvedCategory.defaultPriority || "medium"
  const requesterSnapshot = buildTicketRequesterSnapshot({
    name: user.fullName,
    email: user.email,
    externalId: user.contactId,
    meta: { source: "portal" },
  })

  if (!complaintsEnabled) {
    const ticket = await createTicketWithAssignment({
      organizationId: user.organizationId,
      subject,
      description: description || undefined,
      category: resolvedCategory.category,
      categoryId: resolvedCategory.categoryId,
      priority: effectivePriority,
      contactId: user.contactId,
      companyId: user.companyId,
      createdBy: user.contactId,
      source: "portal",
      requesterName: user.fullName,
      requesterEmail: user.email,
      requesterExternalId: user.contactId,
      requesterMeta: { source: "portal" },
      sourceMeta: clientRequestId ? { clientRequestId } : undefined,
    })
    if (chat) await copyAssistantChatToComments(ticket.id, chat)

    return NextResponse.json({ success: true, data: ticket }, { status: 201 })
  }

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await lockTicketNumberSequence(user.organizationId, tx)
    const ticketNumber = await nextTicketNumber(user.organizationId, tx)
    const ticket = await tx.ticket.create({
      data: {
        organizationId: user.organizationId,
        ticketNumber,
        subject,
        description: description || null,
        category: resolvedCategory.category,
        categoryId: resolvedCategory.categoryId,
        priority: effectivePriority,
        status: "new",
        contactId: user.contactId,
        companyId: user.companyId,
        createdBy: user.contactId,
        source: "portal",
        sourceMeta: clientRequestId ? { clientRequestId } : undefined,
        requesterName: requesterSnapshot.requesterName,
        requesterEmail: requesterSnapshot.requesterEmail,
        requesterPhone: requesterSnapshot.requesterPhone,
        requesterExternalId: requesterSnapshot.requesterExternalId,
        requesterMeta: requesterSnapshot.requesterMeta as Prisma.InputJsonValue | undefined,
        ...sla,
      },
    })
    await tx.complaintMeta.create({
      data: {
        ticketId: ticket.id,
        organizationId: user.organizationId,
        complaintType: meta.complaintType === "suggestion" ? "suggestion" : "complaint",
        brand: meta.brand ?? null,
        productCategory: meta.productCategory ?? null,
        complaintObject: meta.complaintObject ?? null,
        complaintObjectDetail: meta.complaintObjectDetail ?? null,
      },
    })
    await createTicketEntitlementMilestones(tx, {
      organizationId: user.organizationId,
      ticketId: ticket.id,
      companyId: ticket.companyId,
      ticketCreatedAt: ticket.createdAt,
      priority: ticket.priority,
    })
    return ticket
  })

  if (chat) await copyAssistantChatToComments(result.id, chat)
  // AI enrichment (risk + department) runs in the background, never blocks the response.
  enrichComplaintInBackground(result.id, user.organizationId).catch(() => {})

  return NextResponse.json({ success: true, data: result }, { status: 201 })
  }) // end runWithTenant (tenant-scoped handler body)
}
