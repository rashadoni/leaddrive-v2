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
import {
  issueRouteFieldContactPage,
  readRouteFieldContactPage,
  RouteFieldContactPageCursorError,
} from "@/lib/mtm/route-field-contact-page"

const ROUTE_FIELD_CONTACT_DEFAULT_PAGE_SIZE = 25
const ROUTE_FIELD_CONTACT_MAX_PAGE_SIZE = 50
const ROUTE_FIELD_CONTACT_SEARCH_MAX_LENGTH = 120

/** Fixed, no-manager-data projection for Route Field catalog cards. */
const routeFieldContactListSelect = (customerScope: Prisma.MtmCustomerWhereInput) => ({
  id: true,
  displayName: true,
  specialtyName: true,
  type: true,
  category: true,
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
    take: 1,
    select: {
      isPrimary: true,
      phone: true,
      customer: { select: { name: true } },
    },
  },
} satisfies Prisma.MtmContactSelect)

type RouteFieldContactListSource = Prisma.MtmContactGetPayload<{
  select: ReturnType<typeof routeFieldContactListSelect>
}>

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set("Cache-Control", "no-store")
  return NextResponse.json(body, { ...init, headers })
}

function normaliseSearch(value: string | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ")
}

function pageSize(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return ROUTE_FIELD_CONTACT_DEFAULT_PAGE_SIZE
  return Math.min(ROUTE_FIELD_CONTACT_MAX_PAGE_SIZE, Math.max(1, Number(value)))
}

function contactSearchWhere(search: string, customerScope: Prisma.MtmCustomerWhereInput): Prisma.MtmContactWhereInput | null {
  if (!search) return null
  return {
    OR: [
      { displayName: { contains: search, mode: "insensitive" } },
      { specialtyName: { contains: search, mode: "insensitive" } },
      {
        workplaces: {
          some: {
            deletedAt: null,
            endedOn: null,
            customer: {
              deletedAt: null,
              AND: [customerScope],
              name: { contains: search, mode: "insensitive" },
            },
          },
        },
      },
    ],
  }
}

function projectRouteFieldContactListItem(source: RouteFieldContactListSource) {
  const workplace = source.workplaces[0]
  return {
    id: source.id,
    name: source.displayName,
    specialty: source.specialtyName,
    type: source.type,
    category: source.category,
    workplace: workplace
      ? { name: workplace.customer.name, phone: workplace.phone }
      : null,
  }
}

/**
 * GET /api/v2/mtm/mobile/route-field/contacts
 *
 * Additive active-contact catalog for Route Field. The encrypted, short-lived
 * keyset page token is bound to the exact agent, tenant, field-work date and
 * normalized search query; current scope is always re-applied on every page.
 */
export const GET = withMobileRls(async (req, auth) => {
  const permission = requireMobilePermission(auth, "ROUTE_EXECUTE")
  if (permission) {
    permission.headers.set("Cache-Control", "no-store")
    return permission
  }

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

  const params = new URL(req.url).searchParams
  const search = normaliseSearch(params.get("search"))
  if (search.length > ROUTE_FIELD_CONTACT_SEARCH_MAX_LENGTH) {
    return noStoreJson({ error: "Search is too long", code: "MTM_ROUTE_FIELD_CONTACT_SEARCH_TOO_LONG" }, { status: 400 })
  }
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const asOf = currentDateKey(new Date(), timezone)
  const context = { organizationId: auth.orgId, agentId: actor.agentId, asOf, search }
  const rawPage = params.get("page")
  let page: ReturnType<typeof readRouteFieldContactPage> | null = null
  if (rawPage) {
    try {
      page = readRouteFieldContactPage(rawPage, context)
    } catch (error) {
      if (error instanceof RouteFieldContactPageCursorError) {
        return noStoreJson({ error: "Invalid contact page", code: "MTM_ROUTE_FIELD_CONTACT_PAGE_INVALID" }, { status: 400 })
      }
      throw error
    }
  }

  const asOfDate = new Date(`${asOf}T00:00:00.000Z`)
  const customerScope = customerScopeForActor(actor, asOfDate)
  const filters: Prisma.MtmContactWhereInput[] = [contactScopeForActor(actor, asOfDate)]
  const searchWhere = contactSearchWhere(search, customerScope)
  if (searchWhere) filters.push(searchWhere)
  if (page) {
    filters.push({
      OR: [
        { displayName: { gt: page.lastDisplayName } },
        { displayName: page.lastDisplayName, id: { gt: page.lastId } },
      ],
    })
  }

  const limit = pageSize(params.get("limit"))
  const rows = await prisma.mtmContact.findMany({
    where: {
      organizationId: auth.orgId,
      deletedAt: null,
      status: "ACTIVE",
      AND: filters,
    },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    take: limit + 1,
    select: routeFieldContactListSelect(customerScope),
  })
  const pageRows = rows.slice(0, limit)
  const last = pageRows.at(-1)
  const nextPage = rows.length > limit && last
    ? issueRouteFieldContactPage(context, { displayName: last.displayName, id: last.id })
    : null

  return noStoreJson({
    success: true,
    data: {
      contacts: pageRows.map(projectRouteFieldContactListItem),
      nextPage,
      limit,
      asOf,
      timezone,
    },
  })
}, { requiredCapability: "route-field" })
