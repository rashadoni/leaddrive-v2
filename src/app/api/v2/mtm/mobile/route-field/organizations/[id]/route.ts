import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { customerScopeForActor } from "@/lib/mtm/field-scope"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { normalizeMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { LOCATION_REQUEST_ANSWER_SHOWN_DAYS, customerLocationRequestForAgent } from "@/lib/mtm/customer-location-request"

const ROUTE_FIELD_CONTACT_LIMIT = 50
const ROUTE_FIELD_VISIT_LIMIT = 15

/** Fixed allowlist for the standalone Route Field detail card. */
const routeFieldOrganizationSelect = (agentId: string) => ({
  id: true,
  code: true,
  name: true,
  objectType: true,
  category: true,
  status: true,
  address: true,
  locality: true,
  city: true,
  district: true,
  // Where the organization's pin stands: the card measures how far the agent
  // is from it, and offers «Клиент здесь» when the pin is evidently wrong.
  latitude: true,
  longitude: true,
  phone: true,
  // The person at the organization itself. Agents visit it and must know whom
  // to ask for; they still cannot change it (owner, 2026-10-02).
  contactPerson: true,
  contactWorkplaces: {
    where: { deletedAt: null, endedOn: null, contact: { deletedAt: null, status: "ACTIVE" } },
    orderBy: [{ isPrimary: "desc" }, { startedOn: "desc" }, { id: "asc" }],
    take: ROUTE_FIELD_CONTACT_LIMIT,
    select: {
      phone: true,
      isPrimary: true,
      jobTitle: true,
      contact: {
        select: {
          id: true,
          displayName: true,
          specialtyName: true,
          type: true,
        },
      },
    },
  },
  visits: {
    where: { deletedAt: null, agentId },
    orderBy: { checkInAt: "desc" },
    take: ROUTE_FIELD_VISIT_LIMIT,
    select: {
      id: true,
      status: true,
      checkInAt: true,
      outcome: true,
    },
  },
} satisfies Prisma.MtmCustomerSelect)

type RouteFieldOrganizationSource = Prisma.MtmCustomerGetPayload<{
  select: ReturnType<typeof routeFieldOrganizationSelect>
}>

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set("Cache-Control", "no-store")
  return NextResponse.json(body, { ...init, headers })
}

function projectRouteFieldOrganization(source: RouteFieldOrganizationSource) {
  return {
    id: source.id,
    code: source.code,
    name: source.name,
    objectType: source.objectType,
    category: source.category,
    status: source.status,
    address: source.address,
    locality: source.locality,
    city: source.city,
    district: source.district,
    // Both numbers or both null: 0,0 never reaches a phone as a place.
    ...normalizeMtmCoordinates(source),
    phone: source.phone,
    contactPerson: source.contactPerson,
    contacts: source.contactWorkplaces.map((workplace) => ({
      id: workplace.contact.id,
      name: workplace.contact.displayName,
      specialty: workplace.contact.specialtyName,
      type: workplace.contact.type,
      phone: workplace.phone,
      isPrimary: workplace.isPrimary,
      position: workplace.jobTitle,
    })),
    visits: source.visits.map((visit) => ({
      id: visit.id,
      status: visit.status,
      checkInAt: visit.checkInAt,
      outcome: visit.outcome,
    })),
  }
}

/**
 * GET /api/v2/mtm/mobile/route-field/organizations/:id
 *
 * Mobile-only, additive Route Field record view. It has no query switches,
 * does not mutate state, and never falls back to the broad legacy v1 detail.
 */
export const GET = withMobileRls(async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const permission = requireMobilePermission(auth, "ROUTE_EXECUTE")
  if (permission) {
    permission.headers.set("Cache-Control", "no-store")
    return permission
  }

  const { id: rawId } = await params
  const id = rawId.trim()
  if (!id) return noStoreJson({ error: "Organization id is required", code: "MTM_ROUTE_FIELD_ORGANIZATION_ID_REQUIRED" }, { status: 400 })

  const [actor, settings] = await Promise.all([
    resolveMtmRouteActor(prisma, {
      organizationId: auth.orgId,
      userId: auth.userId,
      webRole: auth.role,
      agentId: auth.agentId,
    }),
    getMtmSettings(auth.orgId),
  ])
  if (!actor || actor.role !== "AGENT" || !actor.agentId || actor.agentId !== auth.agentId) {
    return noStoreJson({ error: "Forbidden", code: "MTM_ROUTE_FIELD_AGENT_REQUIRED" }, { status: 403 })
  }

  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const asOf = new Date(`${currentDateKey(new Date(), timezone)}T00:00:00.000Z`)
  const organization = await prisma.mtmCustomer.findFirst({
    where: {
      id,
      organizationId: auth.orgId,
      deletedAt: null,
      status: "ACTIVE",
      objectType: { not: "DOCTOR" },
      AND: [customerScopeForActor(actor, asOf)],
    },
    select: routeFieldOrganizationSelect(actor.agentId),
  })
  if (!organization) return noStoreJson({ error: "Not found", code: "MTM_ROUTE_FIELD_ORGANIZATION_NOT_FOUND" }, { status: 404 })

  // «Клиент здесь»: the request that is waiting about this organization —
  // whoever sent it, so that a second agent at the same door is told — or,
  // failing that, the answer to this agent's own latest one, for a week.
  const locationRequestSelect = {
    id: true,
    status: true,
    requestedByAgentId: true,
    proposedLatitude: true,
    proposedLongitude: true,
    movedMeters: true,
    decisionComment: true,
    submittedAt: true,
    reviewedAt: true,
  } as const
  const answeredSince = new Date(Date.now() - LOCATION_REQUEST_ANSWER_SHOWN_DAYS * 24 * 60 * 60 * 1000)
  const locationRequest = await prisma.mtmCustomerLocationRequest.findFirst({
    where: { organizationId: auth.orgId, customerId: organization.id, status: "SUBMITTED" },
    orderBy: { submittedAt: "desc" },
    select: locationRequestSelect,
  }) ?? await prisma.mtmCustomerLocationRequest.findFirst({
    where: {
      organizationId: auth.orgId,
      customerId: organization.id,
      requestedByAgentId: actor.agentId,
      status: { in: ["APPROVED", "REJECTED"] },
      reviewedAt: { gte: answeredSince },
    },
    orderBy: { reviewedAt: "desc" },
    select: locationRequestSelect,
  })

  return noStoreJson({
    success: true,
    data: {
      organization: projectRouteFieldOrganization(organization),
      locationRequest: locationRequest ? customerLocationRequestForAgent(locationRequest, actor.agentId) : null,
      asOf: asOf.toISOString().slice(0, 10),
      timezone,
      contactLimit: ROUTE_FIELD_CONTACT_LIMIT,
      visitLimit: ROUTE_FIELD_VISIT_LIMIT,
    },
  })
}, { requiredCapability: "route-field" })
