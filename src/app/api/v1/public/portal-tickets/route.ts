import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { getPortalUser } from "@/lib/portal-auth"
import { enrichComplaintInBackground } from "@/lib/complaint-ai"
import { resolveTicketSla, normalizeTicketPriority } from "@/lib/sla-resolver"
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
        priority: true,
        category: true,
        categoryId: true,
        categoryRef: { select: { id: true, name: true, slug: true } },
        requesterName: true,
        requesterEmail: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
        closedAt: true,
      },
    })
  )

  return NextResponse.json({ success: true, data: tickets })
}

export async function POST(req: NextRequest) {
  const user = await getPortalUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const { subject, description, category, priority } = body as {
    subject?: string
    description?: string
    category?: string
    priority?: string
  }
  const isComplaint = body?.isComplaint === true
  const meta: PortalComplaintMeta = (body?.complaintMeta as PortalComplaintMeta) || {}
  if (!subject) return NextResponse.json({ error: "Subject is required" }, { status: 400 })

  // RLS: org comes from the verified portal JWT — whole handler runs
  // tenant-scoped (the fire-and-forget AI enrichment starts inside the
  // scope and inherits it).
  return await runWithTenant(user.organizationId, async () => {
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

  // Normalize the free-form body priority to a valid tier (defends both the SLA
  // lookup and the cron's increase_priority from a bad/non-tier value).
  const ticketPriority = normalizeTicketPriority(priority)
  const resolvedCategory = await resolveTicketCategoryForWrite(user.organizationId, {
    category: complaintsEnabled ? "complaint" : category,
    scope: complaintsEnabled ? "complaint" : "ticket",
  })

  // SLA window (company → priority-based) via the shared resolver, so
  // portal-raised tickets are tracked + escalated like any other.
  const sla = await resolveTicketSla(user.organizationId, {
    companyId: user.companyId,
    priority: priority ? ticketPriority : resolvedCategory.defaultPriority || ticketPriority,
  })
  const effectivePriority = priority ? ticketPriority : resolvedCategory.defaultPriority || ticketPriority
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
    })

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

  // AI enrichment (risk + department) runs in the background, never blocks the response.
  enrichComplaintInBackground(result.id, user.organizationId).catch(() => {})

  return NextResponse.json({ success: true, data: result }, { status: 201 })
  }) // end runWithTenant (tenant-scoped handler body)
}
