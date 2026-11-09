import type { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { getFieldPermissions, filterEntityFields } from "@/lib/field-filter"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { createRestActorContext } from "@/lib/crm-commands/actor-context"
import { CrmCommandError } from "@/lib/crm-commands/errors"
import { createTicketCommand } from "@/lib/crm-commands/ticket/create-ticket"
import { TicketingValidationError } from "@/lib/ticketing/category-service"
import {
  parseTicketListParams,
  ticketQueueCountWheres,
  ticketScopeWhere,
  ticketSearchWhere,
  type TicketQueueCounts,
} from "@/lib/ticketing/ticket-list-query"

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

  const { status, companyId, page, limit, scope, query, withCounts } = parseTicketListParams(new URL(req.url).searchParams)

  try {
    const userId = session?.userId || ""
    let where = await applyRecordFilter(orgId, userId, role, "ticket", {
      organizationId: orgId,
      ...(status ? { status } : {}),
      ...(companyId ? { companyId } : {}),
    }) as Prisma.TicketWhereInput

    if (scope) where = { AND: [where, ticketScopeWhere(scope)] }

    if (query) {
      // Company and assignee are id columns on the ticket, so a name typed
      // into the search box is resolved to ids first.
      const [companies, assignees] = await Promise.all([
        prisma.company.findMany({
          where: { organizationId: orgId, name: { contains: query, mode: "insensitive" } },
          select: { id: true },
          take: 50,
        }),
        prisma.user.findMany({
          where: { organizationId: orgId, name: { contains: query, mode: "insensitive" } },
          select: { id: true },
          take: 50,
        }),
      ])
      where = {
        AND: [where, ticketSearchWhere(query, {
          companyIds: companies.map((company) => company.id),
          assigneeIds: assignees.map((user) => user.id),
        })],
      }
    }

    // The queue counters describe everything this caller may see in the
    // tenant, so a search or a status filter on the request never changes them.
    let queueCounts: TicketQueueCounts | undefined
    if (withCounts) {
      const visible = await applyRecordFilter(orgId, userId, role, "ticket", { organizationId: orgId }) as Prisma.TicketWhereInput
      const countWheres = ticketQueueCountWheres(visible, new Date())
      const [open, fresh, unassigned, slaBreached, escalated] = await Promise.all([
        prisma.ticket.count({ where: countWheres.open }),
        prisma.ticket.count({ where: countWheres.new }),
        prisma.ticket.count({ where: countWheres.unassigned }),
        prisma.ticket.count({ where: countWheres.slaBreached }),
        prisma.ticket.count({ where: countWheres.escalated }),
      ])
      queueCounts = { open, new: fresh, unassigned, slaBreached, escalated }
    }

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

    return NextResponse.json({
      success: true,
      data: { tickets: filteredTickets, total, page, limit, ...(queueCounts ? { queueCounts } : {}) },
    })
  } catch (e) {
    console.error("Tickets GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId, session }) => {
  const body = await req.json()
  const actor = createRestActorContext({ organizationId: orgId, userId: session?.userId, role: session?.role })
  try {
    // Одна команда с голосом (этап 4): права на поля, номер, SLA, назначение.
    const { entity: ticket } = await createTicketCommand(actor, body)
    return NextResponse.json({ success: true, data: ticket }, { status: 201 })
  } catch (e) {
    if (e instanceof CrmCommandError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof TicketingValidationError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
