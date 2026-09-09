import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { lockTicketNumberSequence, nextTicketNumber } from "@/lib/ticket-number"
import { enrichComplaintInBackground } from "@/lib/complaint-ai"
import { createNotification } from "@/lib/notifications"
import { createTicketEntitlementMilestones } from "@/lib/entitlement-process/ticket-milestones"
import {
  buildTicketRequesterSnapshot,
  getContactRequesterSnapshot,
  resolveTicketCategoryForWrite,
} from "@/lib/ticketing/category-service"

const createSchema = z.object({
  customerName: z.string().min(1).max(200).optional(),
  phone: z.string().max(50).optional().nullable(),
  source: z.string().max(50).optional().nullable(),
  complaintType: z.enum(["complaint", "suggestion"]).default("complaint"),
  brand: z.string().max(200).optional().nullable(),
  productionArea: z.string().max(200).optional().nullable(),
  productCategory: z.string().max(200).optional().nullable(),
  complaintObject: z.string().max(300).optional().nullable(),
  complaintObjectDetail: z.string().max(300).optional().nullable(),
  content: z.string().min(1).max(10000),
  responsibleDepartment: z.string().max(200).optional().nullable(),
  riskLevel: z.enum(["low", "medium", "high"]).optional().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent", "critical"]).optional(),
  externalRegistryNumber: z.number().int().positive().optional().nullable(),
  requestDate: z.string().datetime().optional().nullable(),
})

function subjectFrom(content: string, brand?: string | null, obj?: string | null): string {
  const parts = [brand, obj].filter(Boolean).join(" — ")
  const head = content.replace(/\s+/g, " ").trim().slice(0, 120)
  return parts ? `${parts}: ${head}` : head || "Şikayət"
}

export const GET = withRls(async (req, { orgId }) => {

  const sp = new URL(req.url).searchParams
  const status = sp.get("status") || ""
  const brand = sp.get("brand") || ""
  const riskLevel = sp.get("riskLevel") || ""
  const productCategory = sp.get("productCategory") || ""
  const q = sp.get("q") || ""
  const dateFrom = sp.get("dateFrom")
  const dateTo = sp.get("dateTo")
  const page = Math.max(1, parseInt(sp.get("page") || "1"))
  const limit = Math.min(200, Math.max(1, parseInt(sp.get("limit") || "50")))

  const where: Prisma.TicketWhereInput = {
    organizationId: orgId,
    complaintMeta: { isNot: null },
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { subject: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(dateFrom || dateTo
      ? {
          createdAt: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        }
      : {}),
  }

  if (brand || riskLevel || productCategory) {
    where.complaintMeta = {
      ...(brand ? { brand } : {}),
      ...(riskLevel ? { riskLevel } : {}),
      ...(productCategory ? { productCategory } : {}),
    }
  }

  try {
    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        include: { complaintMeta: true, contact: { select: { id: true, fullName: true, phone: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.ticket.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      data: { complaints: tickets, total, page, limit },
    })
  } catch (e) {
    console.error("Complaints GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId }) => {

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const d = parsed.data

  try {
    // findOrCreate contact from phone/name
    let contactId: string | undefined
    let companyId: string | null = null
    if (d.phone || d.customerName) {
      const existing = d.phone
        ? await prisma.contact.findFirst({
            where: { organizationId: orgId, phone: d.phone },
            select: { id: true, companyId: true },
          })
        : null
      if (existing) {
        contactId = existing.id
        companyId = existing.companyId
      } else {
        const created = await prisma.contact.create({
          data: {
            organizationId: orgId,
            fullName: d.customerName || d.phone || "Unknown",
            phone: d.phone || null,
            source: d.source || "complaints_register",
          },
          select: { id: true },
        })
        contactId = created.id
      }
    }

    const complaintCategory = await resolveTicketCategoryForWrite(orgId, {
      category: "complaint",
      scope: "complaint",
    })
    const priority =
      d.priority
      ?? (d.riskLevel === "high" ? "high" : d.riskLevel === "low" ? "low" : complaintCategory.defaultPriority || "medium")
    const requesterSnapshot = contactId
      ? await getContactRequesterSnapshot(orgId, contactId)
      : buildTicketRequesterSnapshot({
          name: d.customerName,
          phone: d.phone,
          meta: { source: d.source || "complaints_register" },
        })

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await lockTicketNumberSequence(orgId, tx)
      const ticketNumber = await nextTicketNumber(orgId, tx)
      const ticket = await tx.ticket.create({
        data: {
          organizationId: orgId,
          ticketNumber,
          subject: subjectFrom(d.content, d.brand, d.complaintObject),
          description: d.content,
          priority,
          status: "open",
          category: "complaint",
          categoryId: complaintCategory.categoryId,
          source: d.source || null,
          contactId,
          companyId,
          ...requesterSnapshot,
          ...(d.requestDate ? { createdAt: new Date(d.requestDate) } : {}),
        },
      })
      await tx.complaintMeta.create({
        data: {
          ticketId: ticket.id,
          organizationId: orgId,
          externalRegistryNumber: d.externalRegistryNumber ?? null,
          complaintType: d.complaintType,
          brand: d.brand ?? null,
          productionArea: d.productionArea ?? null,
          productCategory: d.productCategory ?? null,
          complaintObject: d.complaintObject ?? null,
          complaintObjectDetail: d.complaintObjectDetail ?? null,
          responsibleDepartment: d.responsibleDepartment ?? null,
          riskLevel: d.riskLevel ?? null,
        },
      })
      await createTicketEntitlementMilestones(tx, {
        organizationId: orgId,
        ticketId: ticket.id,
        companyId: ticket.companyId,
        ticketCreatedAt: ticket.createdAt,
        priority: ticket.priority,
      })
      return ticket
    })

    logAudit(orgId, "create", "complaint", result.id, result.subject)
    // Fire-and-forget AI enrichment: fills riskLevel / responsibleDepartment if user left them blank.
    enrichComplaintInBackground(result.id, orgId).catch(() => {})
    // Phase 2b — best-effort notification on new complaint (Support section, tickets module).
    // No assignee on the complaint register model, so emit org-wide (userId: "").
    // Org-wide = in-app only (no per-recipient push target).
    createNotification({
      organizationId: orgId,
      userId: "",
      type: "warning",
      title: "New complaint",
      message: `Complaint: ${result.subject}`,
      entityType: "complaint",
      entityId: result.id,
      kind: "complaint.created",
    }).catch(() => {})
    return NextResponse.json({ success: true, data: result }, { status: 201 })
  } catch (e) {
    console.error("Complaints POST error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
