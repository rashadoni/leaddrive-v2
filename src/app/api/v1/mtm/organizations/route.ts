import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isMtmContactClass } from "@/lib/mtm/contact-classes"
import { normalizeMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { CustomerCreateSchema, parseBody } from "@/lib/mtm-validators"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey, isDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import {
  activeFieldAssignmentWindow,
  canManageFieldMasterData,
  customerScopeForActor,
} from "@/lib/mtm/field-scope"
import { writeMtmAudit } from "@/lib/mtm-audit"
import {
  organizationAddressFilter,
  organizationAreaFilter,
  organizationNameFilter,
} from "@/lib/mtm/list-field-filters"
import {
  mtmClientCategoryCounts,
  mtmClientPendingRoutePoint,
  mtmClientQuickFilter,
  mtmClientVisitInMonth,
  mtmClientVisitMonth,
  type MtmClientQuickCounts,
  type MtmClientQuickFilter,
} from "@/lib/mtm/client-list-quick"

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function forbidden(code = "MTM_ORGANIZATION_SCOPE_DENIED") {
  return NextResponse.json({ error: "Forbidden", code }, { status: 403 })
}

export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return forbidden()

  const params = new URL(req.url).searchParams
  const settings = await getMtmSettings(auth.orgId)
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const requestedAsOf = params.get("asOf")?.trim() ?? ""
  if (requestedAsOf && !isDateKey(requestedAsOf)) {
    return NextResponse.json({
      error: "asOf must be a valid YYYY-MM-DD date",
      code: "MTM_ORGANIZATION_AS_OF_INVALID",
    }, { status: 400 })
  }
  const asOfKey = requestedAsOf || currentDateKey(new Date(), timezone)
  const asOf = utcDate(asOfKey)
  const requestedScope = params.get("scope")
  const search = params.get("search")?.trim() ?? ""
  const category = params.get("category")
  const status = params.get("status")
  const objectType = params.get("objectType")
  const city = params.get("city")?.trim()
  const territoryCode = params.get("territoryCode")?.trim()
  const medicalCategoryCode = params.get("medicalCategoryCode")?.trim()
  const licenseStatus = params.get("licenseStatus")?.trim()
  const polygonCode = params.get("polygonCode")?.trim()
  const region = params.get("region")?.trim()
  const administrativeDistrict = params.get("administrativeDistrict")?.trim()
  const locality = params.get("locality")?.trim()
  const cityDistrict = params.get("cityDistrict")?.trim()
  const specialization = params.get("specialization")?.trim()
  const organizationKind = params.get("organizationKind")?.trim()
  const managingManagerId = params.get("managingManagerId")?.trim()
  const assignedAgentId = params.get("assignedAgentId")?.trim()
  const assignmentState = params.get("assignmentState")
  const quick = mtmClientQuickFilter(params.get("quick"))
  const withCounts = params.get("withCounts") === "1"
  // «Без часов приёма» (customer-hours.ts): its own chip, beside the quick views.
  const hoursMissing = params.get("hours") === "missing" || params.get("quick") === "NO_HOURS"
  const sort = params.get("sort")
  const direction = params.get("direction") === "desc" ? "desc" : "asc"
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1)
  const limit = Math.min(200, Math.max(1, Number.parseInt(params.get("limit") ?? "50", 10) || 50))
  if ((assignmentState === "UNASSIGNED" || quick === "UNASSIGNED") && !canManageFieldMasterData(actor)) {
    return forbidden("MTM_ORGANIZATION_ASSIGNMENT_SEARCH_FORBIDDEN")
  }
  const routeAgentIds = actor.scopedAgentIds === null
    ? null
    : actor.role === "AGENT"
      ? actor.agentId ? [actor.agentId] : []
      : [...actor.scopedAgentIds]
  const activeAttributePackage = {
    status: "ACTIVE" as const,
    effectiveFrom: { lte: asOf },
  }
  const hasAttributeFilter = Boolean(medicalCategoryCode || polygonCode
    || (licenseStatus && ["LICENSED", "UNLICENSED", "NOT_REQUIRED"].includes(licenseStatus)))

  const and: Prisma.MtmCustomerWhereInput[] = []
  if (actor.role === "AGENT") {
    and.push(customerScopeForActor(actor, asOf))
  } else if (actor.role !== "ADMIN") {
    // Managers may assign previously free organizations, but assigned records
    // remain limited to the manager's resolved team/region scope.
    and.push({
      OR: [
        customerScopeForActor(actor, asOf),
        { agentAssignments: { none: activeFieldAssignmentWindow(asOf) } },
      ],
    })
  }
  const effectiveScope = requestedScope === "MINE"
    ? "MINE"
    : requestedScope === "ALL"
      ? "ALL"
      : actor.role === "AGENT"
        ? "MINE"
        : "ALL"
  if (effectiveScope === "MINE") {
    and.push(actor.agentId ? {
      agentAssignments: {
        some: {
          agentId: actor.agentId,
          ...activeFieldAssignmentWindow(asOf),
        },
      },
    } : { id: "__no_actor_assignment__" })
  }
  if (search) {
    and.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
        { address: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { city: { contains: search, mode: "insensitive" } },
        { district: { contains: search, mode: "insensitive" } },
      ],
    })
  }
  and.push(
    ...organizationNameFilter(params.get("name")),
    ...organizationAddressFilter(params.get("address")),
    ...organizationAreaFilter(params.get("area")),
  )

  // The routes this reader sees — the same scope as «Следующий визит» below.
  const routeScope: Prisma.MtmRouteWhereInput = routeAgentIds === null
    ? {}
    : routeAgentIds.length > 0
      ? {
          OR: [
            { agentId: { in: routeAgentIds } },
            { assignments: { some: { agentId: { in: routeAgentIds }, removedAt: null } } },
          ],
        }
      : { id: "__no_route_scope__" }
  // The quick views (chips over the list): one at a time, on top of the fields.
  const visitMonth = mtmClientVisitMonth(asOf)
  const quickWhere: Record<MtmClientQuickFilter, Prisma.MtmCustomerWhereInput> = {
    NOT_VISITED: { visits: { none: mtmClientVisitInMonth(auth.orgId, visitMonth) } },
    NOT_PLANNED: { routePoints: { none: mtmClientPendingRoutePoint(auth.orgId, asOf, routeScope) } },
    UNASSIGNED: { agentAssignments: { none: activeFieldAssignmentWindow(asOf) } },
  }
  const organizationWhere = (extra: Prisma.MtmCustomerWhereInput[], withCategory = true): Prisma.MtmCustomerWhereInput => ({
    organizationId: auth.orgId,
    deletedAt: null,
    objectType: objectType && ["PHARMACY", "CLINIC", "STORE", "OTHER"].includes(objectType)
      ? objectType as "PHARMACY" | "CLINIC" | "STORE" | "OTHER"
      : { not: "DOCTOR" },
    ...(withCategory && isMtmContactClass(category) ? { category } : {}),
    ...(status && ["ACTIVE", "INACTIVE", "PROSPECT"].includes(status) ? { status: status as "ACTIVE" | "INACTIVE" | "PROSPECT" } : {}),
    ...(city ? { city: { equals: city, mode: "insensitive" } } : {}),
    ...(region ? { region: { equals: region, mode: "insensitive" } } : {}),
    ...(administrativeDistrict ? { administrativeDistrict: { equals: administrativeDistrict, mode: "insensitive" } } : {}),
    ...(locality ? { locality: { equals: locality, mode: "insensitive" } } : {}),
    ...(cityDistrict ? { cityDistrict: { equals: cityDistrict, mode: "insensitive" } } : {}),
    ...(specialization ? { specialization: { equals: specialization, mode: "insensitive" } } : {}),
    ...(organizationKind ? { organizationKind: { equals: organizationKind, mode: "insensitive" } } : {}),
    ...(territoryCode ? { territoryCode } : {}),
    ...(hasAttributeFilter ? {
      attributeFacts: {
        some: {
          ...(medicalCategoryCode ? { medicalCategoryCode } : {}),
          ...(licenseStatus && ["LICENSED", "UNLICENSED", "NOT_REQUIRED"].includes(licenseStatus) ? { licenseStatus } : {}),
          ...(polygonCode ? { polygonCode } : {}),
          package: activeAttributePackage,
        },
      },
    } : {}),
    ...(managingManagerId ? { managingManagerId } : {}),
    ...(assignedAgentId ? {
      agentAssignments: { some: { agentId: assignedAgentId, ...activeFieldAssignmentWindow(asOf) } },
    } : assignmentState === "UNASSIGNED" ? {
      agentAssignments: { none: activeFieldAssignmentWindow(asOf) },
    } : assignmentState === "ASSIGNED" ? {
      agentAssignments: { some: activeFieldAssignmentWindow(asOf) },
    } : {}),
    ...(and.length + extra.length > 0 ? { AND: [...and, ...extra] } : {}),
  })
  const noHoursWhere: Prisma.MtmCustomerWhereInput = { workingHours: { equals: Prisma.AnyNull } }
  const quickExtra = [...(quick ? [quickWhere[quick]] : []), ...(hoursMissing ? [noHoursWhere] : [])]
  const where = organizationWhere(quickExtra)

  // How many each chip holds — asked for by the Institutions page only.
  const canSeeUnassigned = canManageFieldMasterData(actor)
  const quickCountsRead: Promise<MtmClientQuickCounts | null> = withCounts
    ? Promise.all([
        prisma.mtmCustomer.count({ where: organizationWhere([]) }),
        prisma.mtmCustomer.count({ where: organizationWhere([quickWhere.NOT_VISITED]) }),
        prisma.mtmCustomer.count({ where: organizationWhere([quickWhere.NOT_PLANNED]) }),
        canSeeUnassigned ? prisma.mtmCustomer.count({ where: organizationWhere([quickWhere.UNASSIGNED]) }) : Promise.resolve(null),
        prisma.mtmCustomer.groupBy({ by: ["category"], where: organizationWhere(quickExtra, false), _count: { _all: true } }),
      ]).then(([all, notVisited, notPlanned, unassigned, categories]) => ({
        all,
        NOT_VISITED: notVisited,
        NOT_PLANNED: notPlanned,
        UNASSIGNED: unassigned,
        categories: mtmClientCategoryCounts(categories),
      }))
    : Promise.resolve(null)

  const hoursMissingCountRead: Promise<number | null> = withCounts
    ? prisma.mtmCustomer.count({ where: organizationWhere([noHoursWhere]) })
    : Promise.resolve(null)

  const [organizations, total, quickCounts, hoursMissingCount] = await Promise.all([
    prisma.mtmCustomer.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [
        sort === "updatedAt" ? { updatedAt: direction }
          : sort === "city" ? { city: direction }
            : sort === "category" ? { category: direction }
              : sort === "status" ? { status: direction }
                : { name: direction },
        { id: "asc" },
      ],
      include: {
        managingManager: { select: { id: true, name: true, role: true, status: true } },
        agentAssignments: {
          where: activeFieldAssignmentWindow(asOf),
          include: { agent: { select: { id: true, name: true, role: true } } },
          orderBy: [{ role: "asc" }, { effectiveFrom: "desc" }],
        },
        visits: {
          where: {
            organizationId: auth.orgId,
            deletedAt: null,
            status: "CHECKED_OUT",
          },
          orderBy: [{ checkInAt: "desc" }, { id: "desc" }],
          take: 1,
          select: {
            id: true,
            checkInAt: true,
            agent: { select: { id: true, name: true } },
          },
        },
        routePoints: {
          where: {
            deletedAt: null,
            status: "PENDING",
            route: {
              organizationId: auth.orgId,
              deletedAt: null,
              status: { in: ["PLANNED", "IN_PROGRESS"] },
              date: { gte: asOf },
              ...routeScope,
            },
          },
          orderBy: [{ route: { date: "asc" } }, { orderIndex: "asc" }],
          take: 1,
          select: {
            id: true,
            routeId: true,
            plannedTime: true,
            orderIndex: true,
            route: { select: { date: true, status: true } },
          },
        },
        attributeFacts: {
          where: { package: activeAttributePackage },
          orderBy: { id: "asc" },
          take: 1,
          select: {
            medicalCategoryCode: true,
            medicalCategoryLabels: true,
            licenseStatus: true,
            licenseLabels: true,
            polygonCode: true,
            polygonLabels: true,
            package: {
              select: {
                version: true,
                rowsHash: true,
                approvalReference: true,
                sourceSystem: true,
                sourceReference: true,
                sourceObservedAt: true,
                effectiveFrom: true,
                signedAt: true,
              },
            },
          },
        },
        _count: {
          select: {
            contactWorkplaces: { where: { deletedAt: null, endedOn: null } },
            visits: { where: { deletedAt: null } },
          },
        },
      },
    }),
    prisma.mtmCustomer.count({ where }),
    quickCountsRead,
    hoursMissingCountRead,
  ])

  return NextResponse.json({
    success: true,
    data: {
      organizations,
      total,
      page,
      limit,
      asOf: asOf.toISOString().slice(0, 10),
      timezone,
      effectiveScope,
      quick: { filter: quick, month: visitMonth.key, counts: quickCounts },
      hours: { missing: hoursMissing, missingCount: hoursMissingCount },
      capabilities: {
        canManage: canManageFieldMasterData(actor),
        canRequestChanges: actor.agentId !== null,
        actorAgentId: actor.agentId,
        actorRole: actor.role,
      },
    },
  })
})

export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || !canManageFieldMasterData(actor)) {
    return forbidden("MTM_ORGANIZATION_APPROVAL_REQUIRED")
  }

  const parsed = parseBody(CustomerCreateSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  if (body.objectType === "DOCTOR") {
    return NextResponse.json({
      error: "Doctors must be created as contacts",
      code: "MTM_CONTACT_REQUIRED",
    }, { status: 400 })
  }

  if (body.managingManagerId) {
    if (!isAgentInRouteScope(actor, body.managingManagerId)) return forbidden("MTM_ORGANIZATION_MANAGER_SCOPE_DENIED")
    const manager = await prisma.mtmAgent.findFirst({
      where: {
        id: body.managingManagerId,
        organizationId: auth.orgId,
        status: "ACTIVE",
        role: { in: ["ADMIN", "MANAGER", "SUPERVISOR"] },
      },
      select: { id: true },
    })
    if (!manager) return NextResponse.json({ error: "Managing manager is invalid", code: "MTM_ORGANIZATION_MANAGER_INVALID" }, { status: 400 })
  }

  try {
    const organization = await prisma.mtmCustomer.create({
      data: {
        organizationId: auth.orgId,
        code: body.code ?? null,
        name: body.name,
        objectType: body.objectType ?? "STORE",
        category: body.category ?? "B",
        status: body.status ?? "ACTIVE",
        address: body.address ?? null,
        region: body.region ?? null,
        administrativeDistrict: body.administrativeDistrict ?? null,
        locality: body.locality ?? null,
        cityDistrict: body.cityDistrict ?? null,
        city: body.city ?? null,
        district: body.district ?? null,
        specialization: body.specialization ?? null,
        organizationKind: body.organizationKind ?? null,
        territoryCode: body.territoryCode ?? null,
        polygon: body.polygon === null ? Prisma.JsonNull : body.polygon as Prisma.InputJsonValue | undefined,
        managingManagerId: body.managingManagerId ?? null,
        ...normalizeMtmCoordinates(body),
        phone: body.phone ?? null,
        contactPerson: body.contactPerson ?? null,
        notes: body.notes ?? null,
        geofenceRadius: body.geofenceRadius ?? null,
      },
    })
    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: actor.agentId,
      action: "FIELD_ORGANIZATION_CREATE",
      entity: "customer",
      entityId: organization.id,
      metadataKind: "field_organization_create",
      newData: organization,
      req,
    }).catch((error) => console.warn("[MTM/organizations POST] audit failed", error))
    return NextResponse.json({ success: true, data: organization }, { status: 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "An organization with this code already exists", code: "MTM_ORGANIZATION_DUPLICATE" }, { status: 409 })
    }
    console.error("[MTM/organizations POST]", error)
    return NextResponse.json({ error: "Failed to create organization" }, { status: 500 })
  }
})
