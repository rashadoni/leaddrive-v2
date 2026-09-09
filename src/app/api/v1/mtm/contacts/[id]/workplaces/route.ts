import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { ContactWorkplaceUpsertSchema, parseBody } from "@/lib/mtm-validators"
import {
  canManageFieldMasterData,
  contactScopeForActor,
  customerScopeForActor,
} from "@/lib/mtm/field-scope"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { writeMtmAudit } from "@/lib/mtm-audit"

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

async function scopeDate(organizationId: string): Promise<Date> {
  const settings = await getMtmSettings(organizationId)
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  return utcDate(currentDateKey(new Date(), timezone))
}

export const GET = withRouteFieldRlsAuth("read", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id: contactId } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const asOf = await scopeDate(auth.orgId)

  const contact = await prisma.mtmContact.findFirst({
    where: {
      id: contactId,
      organizationId: auth.orgId,
      deletedAt: null,
      ...(actor.role === "ADMIN" ? {} : { AND: [contactScopeForActor(actor, asOf)] }),
    },
    select: { id: true },
  })
  if (!contact) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const workplaces = await prisma.mtmContactWorkplace.findMany({
    where: { organizationId: auth.orgId, contactId, deletedAt: null },
    orderBy: [{ endedOn: "asc" }, { isPrimary: "desc" }, { startedOn: "desc" }],
    include: { customer: true },
  })
  return NextResponse.json({ success: true, data: { workplaces, capabilities: { canManage: canManageFieldMasterData(actor) } } })
})

export const PUT = withRouteFieldRlsAuth("write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id: contactId } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || !canManageFieldMasterData(actor)) {
    return NextResponse.json({ error: "Agents must request workplace changes", code: "MTM_WORKPLACE_APPROVAL_REQUIRED" }, { status: 403 })
  }
  const parsed = parseBody(ContactWorkplaceUpsertSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const asOf = await scopeDate(auth.orgId)

  const [contact, customer, existing] = await Promise.all([
    prisma.mtmContact.findFirst({
      where: {
        id: contactId,
        organizationId: auth.orgId,
        deletedAt: null,
        ...(actor.role === "ADMIN" ? {} : { AND: [contactScopeForActor(actor, asOf)] }),
      },
      select: { id: true, displayName: true },
    }),
    prisma.mtmCustomer.findFirst({
      where: {
        id: body.customerId,
        organizationId: auth.orgId,
        deletedAt: null,
        objectType: { not: "DOCTOR" },
        ...(actor.role === "ADMIN" ? {} : { AND: [customerScopeForActor(actor, asOf)] }),
      },
      select: { id: true, name: true },
    }),
    body.id
      ? prisma.mtmContactWorkplace.findFirst({
          where: { id: body.id, organizationId: auth.orgId, contactId, deletedAt: null },
        })
      : Promise.resolve(null),
  ])
  if (!contact || !customer) {
    return NextResponse.json({ error: "Contact or organization not found", code: "MTM_WORKPLACE_REFERENCE_INVALID" }, { status: 400 })
  }
  if (body.id && !existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (existing && body.expectedUpdatedAt && existing.updatedAt.toISOString() !== body.expectedUpdatedAt) {
    return NextResponse.json({ error: "Workplace changed concurrently", code: "MTM_WORKPLACE_CONFLICT" }, { status: 409 })
  }

  const data = {
    customerId: customer.id,
    jobTitle: body.jobTitle ?? null,
    department: body.department ?? null,
    room: body.room ?? null,
    phone: body.phone ?? null,
    isPrimary: body.isPrimary ?? existing?.isPrimary ?? false,
    startedOn: body.startedOn ? utcDate(body.startedOn) : null,
    endedOn: body.endedOn ? utcDate(body.endedOn) : null,
    updatedBy: auth.userId || null,
  }

  try {
    const workplace = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (data.isPrimary && data.endedOn === null) {
        await tx.mtmContactWorkplace.updateMany({
          where: {
            organizationId: auth.orgId,
            contactId,
            deletedAt: null,
            endedOn: null,
            isPrimary: true,
            ...(existing ? { id: { not: existing.id } } : {}),
          },
          data: { isPrimary: false, updatedBy: auth.userId || null },
        })
      }
      return existing
        ? tx.mtmContactWorkplace.update({ where: { id: existing.id }, data })
        : tx.mtmContactWorkplace.create({
            data: {
              organizationId: auth.orgId,
              contactId,
              ...data,
              source: "ADMIN",
              createdBy: auth.userId || null,
            },
          })
    })

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: actor.agentId,
      action: existing ? "CONTACT_WORKPLACE_UPDATE" : "CONTACT_WORKPLACE_CREATE",
      entity: "contact_workplace",
      entityId: workplace.id,
      metadataKind: "contact_workplace",
      oldData: existing,
      newData: workplace,
      req,
    }).catch((error) => console.warn("[MTM/contact workplaces PUT] audit failed", error))

    return NextResponse.json({ success: true, data: workplace }, { status: existing ? 200 : 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "This active workplace already exists", code: "MTM_WORKPLACE_DUPLICATE" }, { status: 409 })
    }
    throw error
  }
})
