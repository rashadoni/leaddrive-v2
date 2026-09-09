import { MtmCustomerCategory, MtmCustomerStatus, type Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { normalizeMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { CustomerCreateSchema, parseBody } from "@/lib/mtm-validators"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { customerScopeForActor } from "@/lib/mtm/field-scope"

export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const orgId = auth.orgId
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const settings = await getMtmSettings(orgId)
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const asOf = new Date(`${currentDateKey(new Date(), timezone)}T00:00:00.000Z`)

  const { searchParams } = new URL(req.url)
  const search = (searchParams.get("search") || "").trim()
  const category = searchParams.get("category") || ""
  const status = searchParams.get("status") || ""
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50")))

  try {
    const where: Prisma.MtmCustomerWhereInput = { organizationId: orgId, deletedAt: null }
    if (actor.role !== "ADMIN") where.AND = [customerScopeForActor(actor, asOf)]
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
        { address: { contains: search, mode: "insensitive" } },
        { city: { contains: search, mode: "insensitive" } },
        { district: { contains: search, mode: "insensitive" } },
        { territoryCode: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { contactPerson: { contains: search, mode: "insensitive" } },
      ]
    }
    if (Object.values(MtmCustomerCategory).includes(category as MtmCustomerCategory)) {
      where.category = category as MtmCustomerCategory
    }
    if (Object.values(MtmCustomerStatus).includes(status as MtmCustomerStatus)) {
      where.status = status as MtmCustomerStatus
    }

    const [customers, total] = await Promise.all([
      prisma.mtmCustomer.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { name: "asc" } }),
      prisma.mtmCustomer.count({ where }),
    ])

    return NextResponse.json({ success: true, data: { customers, total, page, limit } })
  } catch (e) {
    console.error("[MTM/customers GET]", e)
    return NextResponse.json({ error: "Failed to load customers" }, { status: 500 })
  }
})

export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || actor.role === "AGENT") {
    return NextResponse.json({
      error: "Agents must use the customer creation request workflow",
      code: "CUSTOMER_APPROVAL_REQUIRED",
    }, { status: 403 })
  }
  const orgId = auth.orgId

  try {
    const raw = await req.json()
    const parsed = parseBody(CustomerCreateSchema, raw)
    if (!parsed.ok) return parsed.response
    const body = parsed.data

    const customer = await prisma.mtmCustomer.create({
      data: {
        organizationId: orgId,
        code: body.code ?? null,
        name: body.name,
        objectType: body.objectType ?? "STORE",
        category: body.category ?? "B",
        status: body.status ?? "ACTIVE",
        address: body.address ?? null,
        city: body.city ?? null,
        district: body.district ?? null,
        ...normalizeMtmCoordinates(body),
        phone: body.phone ?? null,
        contactPerson: body.contactPerson ?? null,
        notes: body.notes ?? null,
        geofenceRadius: body.geofenceRadius ?? null,
      },
    })

    await writeMtmAudit({
      organizationId: orgId,
      agentId: null,
      action: "CUSTOMER_CREATE",
      entity: "customer",
      entityId: customer.id,
      metadataKind: "customer_create",
      newData: { name: customer.name, code: customer.code, category: customer.category },
      req,
    }).catch((e) => console.warn("[MTM/customers POST] audit failed", e))

    return NextResponse.json({ success: true, data: customer }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create customer" }, { status: 400 })
  }
})
