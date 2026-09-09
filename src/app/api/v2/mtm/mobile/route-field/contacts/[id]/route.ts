import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { contactScopeForActor, customerScopeForActor } from "@/lib/mtm/field-scope"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"

const ROUTE_FIELD_WORKPLACE_LIMIT = 20

/**
 * Fixed privacy-minimised projection for the Route Field contact card.
 *
 * A contact can be visible through a direct agent assignment, but every
 * workplace returned here is independently restricted to a customer that is
 * currently in that same agent's field scope. This avoids leaking a contact's
 * other employers merely because one employer is route-scoped.
 */
const routeFieldContactSelect = (customerScope: Prisma.MtmCustomerWhereInput) => ({
  id: true,
  displayName: true,
  specialtyName: true,
  type: true,
  category: true,
  status: true,
  workplaces: {
    where: {
      deletedAt: null,
      endedOn: null,
      customer: {
        deletedAt: null,
        AND: [customerScope],
      },
    },
    orderBy: [{ isPrimary: "desc" }, { startedOn: "desc" }, { id: "asc" }],
    take: ROUTE_FIELD_WORKPLACE_LIMIT,
    select: {
      id: true,
      isPrimary: true,
      jobTitle: true,
      phone: true,
      customer: {
        select: {
          name: true,
          city: true,
          address: true,
        },
      },
    },
  },
} satisfies Prisma.MtmContactSelect)

type RouteFieldContactSource = Prisma.MtmContactGetPayload<{
  select: ReturnType<typeof routeFieldContactSelect>
}>

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set("Cache-Control", "no-store")
  return NextResponse.json(body, { ...init, headers })
}

function projectRouteFieldContact(source: RouteFieldContactSource) {
  return {
    id: source.id,
    name: source.displayName,
    specialty: source.specialtyName,
    type: source.type,
    category: source.category,
    status: source.status,
    workplaces: source.workplaces.map((workplace) => ({
      id: workplace.id,
      name: workplace.customer.name,
      city: workplace.customer.city,
      address: workplace.customer.address,
      isPrimary: workplace.isPrimary,
      jobTitle: workplace.jobTitle,
      phone: workplace.phone,
    })),
  }
}

/**
 * GET /api/v2/mtm/mobile/route-field/contacts/:id
 *
 * Additive, read-only Route Field contact detail. This endpoint intentionally
 * has no query switches and never falls back to the broad v1 contact detail.
 */
export const GET = withMobileRls(async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const permission = requireMobilePermission(auth, "ROUTE_EXECUTE")
  if (permission) {
    permission.headers.set("Cache-Control", "no-store")
    return permission
  }

  const { id: rawId } = await params
  const id = rawId.trim()
  if (!id) return noStoreJson({ error: "Contact id is required", code: "MTM_ROUTE_FIELD_CONTACT_ID_REQUIRED" }, { status: 400 })

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
  const contact = await prisma.mtmContact.findFirst({
    where: {
      id,
      organizationId: auth.orgId,
      deletedAt: null,
      // Route Field is an execution surface: inactive/prospect/merged contact
      // records stay available through legacy management/history views, not
      // through this active field catalog.
      status: "ACTIVE",
      AND: [contactScopeForActor(actor, asOf)],
    },
    select: routeFieldContactSelect(customerScopeForActor(actor, asOf)),
  })
  if (!contact) return noStoreJson({ error: "Not found", code: "MTM_ROUTE_FIELD_CONTACT_NOT_FOUND" }, { status: 404 })

  return noStoreJson({
    success: true,
    data: {
      contact: projectRouteFieldContact(contact),
      asOf: asOf.toISOString().slice(0, 10),
      timezone,
      workplaceLimit: ROUTE_FIELD_WORKPLACE_LIMIT,
    },
  })
}, { requiredCapability: "route-field" })
