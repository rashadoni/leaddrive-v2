import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { FieldPotentialUpsertSchema, parseBody } from "@/lib/mtm-validators"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import {
  canManageFieldMasterData,
  contactScopeForActor,
  customerScopeForActor,
} from "@/lib/mtm/field-scope"
import { writeMtmAudit } from "@/lib/mtm-audit"

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

async function actorContext(auth: { orgId: string; userId: string; role: string; agentId: string | null }) {
  const [actor, settings] = await Promise.all([
    resolveMtmRouteActor(prisma, {
      organizationId: auth.orgId,
      userId: auth.userId,
      webRole: auth.role,
      agentId: auth.agentId,
    }),
    getMtmSettings(auth.orgId),
  ])
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const asOf = utcDate(currentDateKey(new Date(), timezone))
  return { actor, timezone, asOf }
}

export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const { actor, timezone, asOf } = await actorContext(auth)
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const params = new URL(req.url).searchParams
  const subjectType = params.get("subjectType")
  const subjectId = params.get("subjectId")
  const brandExternalId = params.get("brandExternalId")
  const productExternalId = params.get("productExternalId")

  const and: Prisma.MtmFieldPotentialWhereInput[] = []
  if (actor.role !== "ADMIN") {
    and.push({
      OR: [
        { customer: customerScopeForActor(actor, asOf) },
        { contact: contactScopeForActor(actor, asOf) },
      ],
    })
  }
  if (!subjectType && subjectId) {
    and.push({ OR: [{ customerId: subjectId }, { contactId: subjectId }] })
  }
  const where: Prisma.MtmFieldPotentialWhereInput = {
    organizationId: auth.orgId,
    deletedAt: null,
    ...(subjectType === "ORGANIZATION" ? { customerId: subjectId ?? { not: null }, contactId: null } : {}),
    ...(subjectType === "CONTACT" ? { contactId: subjectId ?? { not: null }, customerId: null } : {}),
    ...(brandExternalId ? { brandExternalId } : {}),
    ...(productExternalId ? { productExternalId } : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  }

  const potentials = await prisma.mtmFieldPotential.findMany({
    where,
    orderBy: [{ periodStart: "desc" }, { updatedAt: "desc" }],
    take: 1000,
    include: {
      customer: { select: { id: true, name: true, objectType: true } },
      contact: { select: { id: true, displayName: true, type: true, specialtyName: true } },
    },
  })
  return NextResponse.json({
    success: true,
    data: {
      potentials,
      asOf: asOf.toISOString().slice(0, 10),
      timezone,
      capabilities: { canManage: canManageFieldMasterData(actor) },
    },
  })
})

export const PUT = withRouteFieldRlsAuth("write", async (req, auth) => {
  const { actor, asOf } = await actorContext(auth)
  if (!actor || !canManageFieldMasterData(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const parsed = parseBody(FieldPotentialUpsertSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const subject = body.subjectType === "ORGANIZATION"
    ? await prisma.mtmCustomer.findFirst({
        where: {
          id: body.subjectId,
          organizationId: auth.orgId,
          deletedAt: null,
          ...(actor.role === "ADMIN" ? {} : { AND: [customerScopeForActor(actor, asOf)] }),
        },
        select: { id: true },
      })
    : await prisma.mtmContact.findFirst({
        where: {
          id: body.subjectId,
          organizationId: auth.orgId,
          deletedAt: null,
          ...(actor.role === "ADMIN" ? {} : { AND: [contactScopeForActor(actor, asOf)] }),
        },
        select: { id: true },
      })
  if (!subject) {
    return NextResponse.json({ error: "Potential subject is outside your scope", code: "MTM_POTENTIAL_REFERENCE_INVALID" }, { status: 400 })
  }
  const existing = body.id
    ? await prisma.mtmFieldPotential.findFirst({ where: { id: body.id, organizationId: auth.orgId, deletedAt: null } })
    : null
  if (body.id && !existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const data = {
    customerId: body.subjectType === "ORGANIZATION" ? body.subjectId : null,
    contactId: body.subjectType === "CONTACT" ? body.subjectId : null,
    brandExternalId: body.brandExternalId ?? null,
    productExternalId: body.productExternalId ?? null,
    category: body.category ?? null,
    potentialValue: new Prisma.Decimal(body.potentialValue),
    coverageValue: new Prisma.Decimal(body.coverageValue ?? 0),
    periodStart: body.periodStart ? utcDate(body.periodStart) : null,
    periodEnd: body.periodEnd ? utcDate(body.periodEnd) : null,
    formulaVersion: body.formulaVersion ?? null,
  }
  const potential = existing
    ? await prisma.mtmFieldPotential.update({ where: { id: existing.id }, data })
    : await prisma.mtmFieldPotential.create({
        data: { organizationId: auth.orgId, ...data, source: "ADMIN" },
      })

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: existing ? "FIELD_POTENTIAL_UPDATE" : "FIELD_POTENTIAL_CREATE",
    entity: "field_potential",
    entityId: potential.id,
    metadataKind: "field_potential",
    oldData: existing,
    newData: potential,
    req,
  }).catch((error) => console.warn("[MTM/field-potentials PUT] audit failed", error))
  return NextResponse.json({ success: true, data: potential }, { status: existing ? 200 : 201 })
})
