import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  activeFieldAssignmentWindow,
  canManageFieldMasterData,
  contactScopeForActor,
  customerScopeForActor,
} from "@/lib/mtm/field-scope"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"

type Direction = "DOCTOR" | "PHARMACY" | "ORGANIZATION"

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/
const defaultLimit = 20
const maximumLimit = 50

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function forbidden(code = "MTM_ROUTE_ASSIGNMENT_FORBIDDEN") {
  return NextResponse.json({ error: "Forbidden", code }, { status: 403 })
}

function limitedValue(params: URLSearchParams): number {
  const parsed = Number.parseInt(params.get("limit") ?? "", 10)
  if (!Number.isFinite(parsed)) return defaultLimit
  return Math.min(maximumLimit, Math.max(1, parsed))
}

function currentPrimaryOwner(assignments: Array<{
  role: string
  agent: { id: string; name: string }
}>) {
  const owner = assignments.find((assignment) => assignment.role === "PRIMARY")
  return owner ? { id: owner.agent.id, name: owner.agent.name } : null
}

/**
 * A deliberately narrow picker for the route builder.
 *
 * It is not a second field catalogue: managers only see records they already
 * manage today or records with no current primary owner. This intentionally
 * mirrors the field-assignment mutation boundary while showing ownership for
 * the selected route date, and lets a manager complete a route without the
 * old redirect-to-catalogue detour.
 */
export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || !canManageFieldMasterData(actor)) return forbidden()

  const params = new URL(req.url).searchParams
  const agentId = params.get("agentId")?.trim() ?? ""
  const date = params.get("date")?.trim() ?? ""
  const requestedDirection = params.get("direction")
  const direction: Direction = requestedDirection === "DOCTOR" || requestedDirection === "PHARMACY"
    ? requestedDirection
    : "ORGANIZATION"
  const search = params.get("search")?.trim() ?? ""
  const limit = limitedValue(params)

  if (!agentId || !dateKeyPattern.test(date)) {
    return NextResponse.json({
      error: "agentId and a valid date are required",
      code: "MTM_ROUTE_ASSIGNABLE_INPUT_INVALID",
    }, { status: 400 })
  }
  if (!isAgentInRouteScope(actor, agentId)) return forbidden("MTM_ROUTE_SCOPE_DENIED")

  const targetAgent = await prisma.mtmAgent.findFirst({
    where: { id: agentId, organizationId: auth.orgId, status: "ACTIVE" },
    select: { id: true, name: true },
  })
  if (!targetAgent) {
    return NextResponse.json({
      error: "Agent is inactive or unavailable",
      code: "MTM_PLANNING_AGENT_INVALID",
    }, { status: 404 })
  }

  const effectiveDate = utcDate(date)
  const activeAssignment = activeFieldAssignmentWindow(effectiveDate)
  const settings = await getMtmSettings(auth.orgId)
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const authorizationDate = utcDate(currentDateKey(new Date(), timezone))
  const authorizationAssignment = activeFieldAssignmentWindow(authorizationDate)
  const readLimit = limit + 1

  if (direction === "DOCTOR") {
    const and: Prisma.MtmContactWhereInput[] = []
    if (actor.role !== "ADMIN" && actor.scopedAgentIds !== null) {
      and.push({
        OR: [
          contactScopeForActor(actor, authorizationDate),
          { agentAssignments: { none: { role: "PRIMARY", ...authorizationAssignment } } },
        ],
      })
    }
    if (search) {
      and.push({
        OR: [
          { displayName: { contains: search, mode: "insensitive" } },
          { externalCode: { contains: search, mode: "insensitive" } },
          { specialtyName: { contains: search, mode: "insensitive" } },
          {
            workplaces: {
              some: {
                deletedAt: null,
                endedOn: null,
                customer: {
                  OR: [
                    { name: { contains: search, mode: "insensitive" } },
                    { code: { contains: search, mode: "insensitive" } },
                    { address: { contains: search, mode: "insensitive" } },
                  ],
                },
              },
            },
          },
        ],
      })
    }

    const contacts = await prisma.mtmContact.findMany({
      where: {
        organizationId: auth.orgId,
        deletedAt: null,
        type: "DOCTOR",
        status: "ACTIVE",
        ...(and.length ? { AND: and } : {}),
      },
      take: readLimit,
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      include: {
        workplaces: {
          where: {
            deletedAt: null,
            endedOn: null,
            customer: { organizationId: auth.orgId, deletedAt: null, status: "ACTIVE" },
          },
          orderBy: [{ isPrimary: "desc" }, { startedOn: "desc" }],
          take: 1,
          include: {
            customer: {
              select: {
                id: true,
                name: true,
                code: true,
                address: true,
                city: true,
                district: true,
                territoryCode: true,
                phone: true,
                contactPerson: true,
                latitude: true,
                longitude: true,
              },
            },
          },
        },
        agentAssignments: {
          where: activeAssignment,
          orderBy: [{ role: "asc" }, { effectiveFrom: "desc" }],
          include: { agent: { select: { id: true, name: true } } },
        },
      },
    })
    const items = contacts.flatMap((contact) => {
      const workplace = contact.workplaces[0]
      if (!workplace) return []
      return [{
        id: contact.id,
        subjectType: "CONTACT" as const,
        kind: "DOCTOR" as const,
        name: contact.displayName,
        code: contact.externalCode,
        specialtyName: contact.specialtyName,
        currentOwner: currentPrimaryOwner(contact.agentAssignments),
        customer: workplace.customer,
        contact: {
          id: contact.id,
          displayName: contact.displayName,
          specialtyName: contact.specialtyName,
        },
      }]
    })
    return NextResponse.json({
      success: true,
      data: {
        targetAgent,
        direction,
        items: items.slice(0, limit),
        limited: contacts.length > limit,
      },
    })
  }

  const and: Prisma.MtmCustomerWhereInput[] = []
  if (actor.role !== "ADMIN" && actor.scopedAgentIds !== null) {
    and.push({
      OR: [
        customerScopeForActor(actor, authorizationDate),
        { agentAssignments: { none: { role: "PRIMARY", ...authorizationAssignment } } },
      ],
    })
  }
  if (search) {
    and.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
        { address: { contains: search, mode: "insensitive" } },
        { city: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ],
    })
  }

  const customers = await prisma.mtmCustomer.findMany({
    where: {
      organizationId: auth.orgId,
      deletedAt: null,
      status: "ACTIVE",
      ...(direction === "PHARMACY" ? { objectType: "PHARMACY" } : {}),
      ...(and.length ? { AND: and } : {}),
    },
    take: readLimit,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    include: {
      agentAssignments: {
        where: activeAssignment,
        orderBy: [{ role: "asc" }, { effectiveFrom: "desc" }],
        include: { agent: { select: { id: true, name: true } } },
      },
    },
  })
  const items = customers.map((customer) => ({
    id: customer.id,
    subjectType: "ORGANIZATION" as const,
    kind: direction,
    name: customer.name,
    code: customer.code,
    specialtyName: null,
    currentOwner: currentPrimaryOwner(customer.agentAssignments),
    customer: {
      id: customer.id,
      name: customer.name,
      code: customer.code,
      address: customer.address,
      city: customer.city,
      district: customer.district,
      territoryCode: customer.territoryCode,
      phone: customer.phone,
      contactPerson: customer.contactPerson,
      latitude: customer.latitude,
      longitude: customer.longitude,
    },
    contact: null,
  }))

  return NextResponse.json({
    success: true,
    data: {
      targetAgent,
      direction,
      items: items.slice(0, limit),
      limited: customers.length > limit,
    },
  })
})
