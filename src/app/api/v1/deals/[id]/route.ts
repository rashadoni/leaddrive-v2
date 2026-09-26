import { NextResponse } from "next/server"
import { prisma, logAudit } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { getFieldPermissions, filterEntityFields, filterWritableFields } from "@/lib/field-filter"
import { fireWebhooks } from "@/lib/webhooks"
import { normalizeDealRow } from "@/lib/prisma-decimal"
import { clearTaskRelations } from "@/lib/tasks/clear-task-relations"
import { updateDealCommand, DealStageValidationError, dealInclude } from "@/lib/crm-commands/deal/update-deal"
import { createRestActorContext } from "@/lib/crm-commands/actor-context"
import { CrmCommandError } from "@/lib/crm-commands/errors"
import type { Role } from "@/lib/permissions"

export const GET = withRls(async (_req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  const role = session?.role || "admin"
  const { id } = await params

  try {
    const deal = await prisma.deal.findFirst({
      where: { id, organizationId: orgId },
      include: dealInclude,
    })

    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })

    // Enrich team members with user info
    const userIds = deal.teamMembers.map((m: any) => m.userId)
    const users = userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds }, organizationId: orgId },
          select: { id: true, name: true, email: true, avatar: true, role: true },
        })
      : []
    const userMap = Object.fromEntries(users.map((u: any) => [u.id, u]))

    const enrichedTeam = deal.teamMembers.map((m: any) => ({
      ...m,
      user: userMap[m.userId] || { id: m.userId, name: null, email: "", avatar: null, role: null },
    }))

    // Enrich contact info if contactId exists
    let contact = null
    if (deal.contactId) {
      contact = await prisma.contact.findFirst({
        where: { id: deal.contactId, organizationId: orgId },
        select: { id: true, fullName: true, position: true, email: true, phone: true, avatar: true, companyId: true },
      })
    }

    // Load contact roles separately
    const contactRoles = await prisma.dealContactRole.findMany({
      where: { dealId: id, deal: { organizationId: orgId } },
      orderBy: { createdAt: "asc" },
    })

    // Enrich contact roles with contact info
    const roleContactIds = contactRoles.map((r: any) => r.contactId)
    const roleContacts = roleContactIds.length > 0
      ? await prisma.contact.findMany({
          where: { id: { in: roleContactIds }, organizationId: orgId },
          select: { id: true, fullName: true, position: true, email: true, phone: true },
        })
      : []
    const roleContactMap = Object.fromEntries(roleContacts.map((c: any) => [c.id, c]))
    const enrichedRoles = contactRoles.map((r: any) => ({
      ...r,
      contact: roleContactMap[r.contactId] || { id: r.contactId, fullName: "Unknown", position: null, email: null, phone: null },
    }))

    const fieldPerms = await getFieldPermissions(orgId, role, "deal")
    const dealNorm = { ...normalizeDealRow(deal), teamMembers: enrichedTeam, contact, contactRoles: enrichedRoles }
    const filteredDeal = filterEntityFields(dealNorm, fieldPerms, role)

    return NextResponse.json({ success: true, data: filteredDeal })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message?.substring(0, 300) || "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRls(async (req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  const role = session?.role || "admin"
  const { id } = await params
  const body = await req.json()
  // REST keeps its historical contract: fields the role may not write are
  // dropped, not refused. The command itself is the single implementation
  // shared with voice receipts (roadmap C1.13).
  const fieldPerms = await getFieldPermissions(orgId, role, "deal")
  const filtered = filterWritableFields(body, fieldPerms, role)

  try {
    const result = await updateDealCommand(createRestActorContext({
      organizationId: orgId,
      userId: session?.userId ?? null,
      role: (session?.role as Role | undefined) ?? null,
      requestId: req.headers.get("x-request-id"),
    }), id, filtered)
    return NextResponse.json({ success: true, data: normalizeDealRow(result.entity) })
  } catch (error) {
    if (error instanceof DealStageValidationError) {
      return NextResponse.json({
        success: false,
        error: "Stage transition blocked by validation rules",
        validationErrors: error.validationErrors,
      }, { status: 422 })
    }
    if (error instanceof CrmCommandError) {
      if (error.status === 403) {
        return NextResponse.json({ error: "Forbidden", message: error.message }, { status: 403 })
      }
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error(error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// PATCH = partial-update alias of PUT (inline-edit consumers use PATCH verb).
// PUT already does partial updates; only fields present in the body are written.
export const PATCH = PUT

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const existing = await prisma.deal.findFirst({ where: { id, organizationId: orgId }, select: { name: true } })
    const result = await prisma.deal.deleteMany({
      where: { id, organizationId: orgId },
    })

    if (result.count === 0) return NextResponse.json({ error: "Deal not found" }, { status: 404 })
    // Null out tasks that linked to this now-deleted deal (no FK → not auto-nulled).
    await clearTaskRelations(orgId, "deal", id)
    logAudit(orgId, "delete", "deal", id, existing?.name || "")
    fireWebhooks(orgId, "deal.deleted", { id, name: existing?.name }).catch(() => {})
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
