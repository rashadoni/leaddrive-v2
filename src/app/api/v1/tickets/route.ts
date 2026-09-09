import type { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { getFieldPermissions, filterEntityFields, filterWritableFields } from "@/lib/field-filter"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { createTicketWithAssignment } from "@/lib/ticket-factory"
import { LEGACY_TICKET_CATEGORY_SLUGS } from "@/lib/ticketing/categories"
import { TicketingValidationError } from "@/lib/ticketing/category-service"

const createTicketSchema = z.object({
  subject: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  category: z.enum(LEGACY_TICKET_CATEGORY_SLUGS).optional(),
  categoryId: z.string().optional(),
  contactId: z.string().optional(),
  companyId: z.string().optional(),
  assignedTo: z.string().optional(),
})

type CreateTicketWritableData = {
  subject: string
  description?: string
  priority?: "low" | "medium" | "high" | "critical"
  category?: (typeof LEGACY_TICKET_CATEGORY_SLUGS)[number]
  categoryId?: string | null
  contactId?: string | null
  companyId?: string | null
  assignedTo?: string | null
}

type TicketListRow = Prisma.TicketGetPayload<{
  include: {
    categoryRef: { select: { id: true; name: true; slug: true; scope: true } }
    contact: { select: { id: true; fullName: true; email: true; phone: true } }
  }
}>
type CompanyNameRow = { id: string; name: string }
type UserNameRow = { id: string; name: string | null; email: string | null }

export const GET = withRls(async (req, { orgId, session }) => {
  const role = session?.role || "admin"

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status") || ""
  const companyId = searchParams.get("companyId") || ""
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "50")

  try {
    let where: Prisma.TicketWhereInput = {
      organizationId: orgId,
      ...(status ? { status } : {}),
      ...(companyId ? { companyId } : {}),
    }
    where = await applyRecordFilter(orgId, session?.userId || "", role, "ticket", where)

    const [rawTicketRows, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          categoryRef: { select: { id: true, name: true, slug: true, scope: true } },
          contact: { select: { id: true, fullName: true, email: true, phone: true } },
        },
      }),
      prisma.ticket.count({ where }),
    ])
    const ticketRows = rawTicketRows as TicketListRow[]

    // Resolve company names and assignee names
    const companyIds = [...new Set(ticketRows.map((t: TicketListRow) => t.companyId).filter((id: string | null): id is string => Boolean(id)))]
    const userIds = [...new Set(ticketRows.map((t: TicketListRow) => t.assignedTo).filter((id: string | null): id is string => Boolean(id)))]

    const [companies, users] = await Promise.all([
      companyIds.length > 0
        ? prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
        : Promise.resolve([] as CompanyNameRow[]),
      userIds.length > 0
        ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
        : Promise.resolve([] as UserNameRow[]),
    ]) as [CompanyNameRow[], UserNameRow[]]

    const companyMap = Object.fromEntries(companies.map((c) => [c.id, c.name]))
    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name || u.email]))

    const tickets = ticketRows.map((t: TicketListRow) => ({
      ...t,
      companyName: t.companyId ? companyMap[t.companyId] || null : null,
      assigneeName: t.assignedTo ? userMap[t.assignedTo] || null : null,
      categoryName: t.categoryRef?.name || t.category || "general",
      categorySlug: t.categoryRef?.slug || t.category || "general",
      requesterName: t.requesterName || t.contact?.fullName || t.contact?.email || t.contact?.phone || null,
      requesterEmail: t.requesterEmail || t.contact?.email || null,
      requesterPhone: t.requesterPhone || t.contact?.phone || null,
    }))

    const fieldPerms = await getFieldPermissions(orgId, role, "ticket")
    const filteredTickets = tickets.map((t: Record<string, unknown>) => filterEntityFields(t, fieldPerms, role))

    return NextResponse.json({ success: true, data: { tickets: filteredTickets, total, page, limit } })
  } catch (e) {
    console.error("Tickets GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId, session }) => {
  const role = session?.role || "admin"
  const body = await req.json()
  const parsed = createTicketSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const fieldPerms = await getFieldPermissions(orgId, role, "ticket")
    const writableData = filterWritableFields({
      subject: parsed.data.subject,
      description: parsed.data.description,
      priority: parsed.data.priority,
      category: parsed.data.category,
      categoryId: parsed.data.categoryId,
      contactId: parsed.data.contactId,
      companyId: parsed.data.companyId,
      assignedTo: parsed.data.assignedTo,
    }, fieldPerms, role) as CreateTicketWritableData

    const ticket = await createTicketWithAssignment({
      organizationId: orgId,
      createdBy: session?.userId || null,
      source: "agent",
      ...writableData,
    })
    return NextResponse.json({ success: true, data: ticket }, { status: 201 })
  } catch (e) {
    if (e instanceof TicketingValidationError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
