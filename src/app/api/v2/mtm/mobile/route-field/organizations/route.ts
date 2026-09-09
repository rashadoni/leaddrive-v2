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
import {
  issueRouteFieldOrganizationPage,
  readRouteFieldOrganizationPage,
  RouteFieldOrganizationPageCursorError,
} from "@/lib/mtm/route-field-organization-page"

const ROUTE_FIELD_ORGANIZATION_DEFAULT_PAGE_SIZE = 25
const ROUTE_FIELD_ORGANIZATION_MAX_PAGE_SIZE = 50
const ROUTE_FIELD_ORGANIZATION_SEARCH_MAX_LENGTH = 120
const ROUTE_FIELD_ORGANIZATION_KIND_MAX_LENGTH = 120
const ROUTE_FIELD_ORGANIZATION_OBJECT_TYPES = new Set(["PHARMACY", "CLINIC", "STORE", "OTHER"])

/** Fixed, no-manager-data projection for Route Field organization cards. */
const routeFieldOrganizationListSelect = {
  id: true,
  code: true,
  name: true,
  objectType: true,
  category: true,
  address: true,
  phone: true,
  _count: {
    select: {
      contactWorkplaces: {
        where: {
          deletedAt: null,
          endedOn: null,
          contact: { deletedAt: null, status: "ACTIVE" },
        },
      },
    },
  },
} satisfies Prisma.MtmCustomerSelect

type RouteFieldOrganizationListSource = Prisma.MtmCustomerGetPayload<{
  select: typeof routeFieldOrganizationListSelect
}>

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set("Cache-Control", "no-store")
  return NextResponse.json(body, { ...init, headers })
}

function normaliseSearch(value: string | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ")
}

function optionalObjectType(value: string | null): "PHARMACY" | "CLINIC" | "STORE" | "OTHER" | null {
  return value && ROUTE_FIELD_ORGANIZATION_OBJECT_TYPES.has(value)
    ? value as "PHARMACY" | "CLINIC" | "STORE" | "OTHER"
    : null
}

function pageSize(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return ROUTE_FIELD_ORGANIZATION_DEFAULT_PAGE_SIZE
  return Math.min(ROUTE_FIELD_ORGANIZATION_MAX_PAGE_SIZE, Math.max(1, Number(value)))
}

function organizationSearchWhere(search: string): Prisma.MtmCustomerWhereInput | null {
  if (!search) return null
  return {
    OR: [
      { name: { contains: search, mode: "insensitive" } },
      { code: { contains: search, mode: "insensitive" } },
      { address: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
    ],
  }
}

function projectRouteFieldOrganizationListItem(source: RouteFieldOrganizationListSource) {
  return {
    id: source.id,
    code: source.code,
    name: source.name,
    objectType: source.objectType,
    category: source.category,
    address: source.address,
    phone: source.phone,
    contactsCount: source._count.contactWorkplaces,
  }
}

/**
 * GET /api/v2/mtm/mobile/route-field/organizations
 *
 * Additive active-organization catalog for Route Field. It deliberately has
 * no offset, total/count, manager filters or response expansion. Its encrypted
 * cursor is bound to the exact AGENT scope and fixed catalog filters, while
 * current server scope is re-applied on every page.
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
  if (search.length > ROUTE_FIELD_ORGANIZATION_SEARCH_MAX_LENGTH) {
    return noStoreJson({ error: "Search is too long", code: "MTM_ROUTE_FIELD_ORGANIZATION_SEARCH_TOO_LONG" }, { status: 400 })
  }
  const organizationKind = normaliseSearch(params.get("organizationKind")) || null
  if (organizationKind && organizationKind.length > ROUTE_FIELD_ORGANIZATION_KIND_MAX_LENGTH) {
    return noStoreJson({ error: "Organization kind is too long", code: "MTM_ROUTE_FIELD_ORGANIZATION_KIND_TOO_LONG" }, { status: 400 })
  }
  const objectType = optionalObjectType(params.get("objectType"))
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const asOf = currentDateKey(new Date(), timezone)
  const context = {
    organizationId: auth.orgId,
    agentId: actor.agentId,
    asOf,
    search,
    objectType,
    organizationKind,
  }
  const rawPage = params.get("page")
  let page: ReturnType<typeof readRouteFieldOrganizationPage> | null = null
  if (rawPage) {
    try {
      page = readRouteFieldOrganizationPage(rawPage, context)
    } catch (error) {
      if (error instanceof RouteFieldOrganizationPageCursorError) {
        return noStoreJson({ error: "Invalid organization page", code: "MTM_ROUTE_FIELD_ORGANIZATION_PAGE_INVALID" }, { status: 400 })
      }
      throw error
    }
  }

  const asOfDate = new Date(`${asOf}T00:00:00.000Z`)
  const filters: Prisma.MtmCustomerWhereInput[] = [customerScopeForActor(actor, asOfDate)]
  const searchWhere = organizationSearchWhere(search)
  if (searchWhere) filters.push(searchWhere)
  if (organizationKind) {
    filters.push({ organizationKind: { equals: organizationKind, mode: "insensitive" } })
  }
  if (page) {
    filters.push({
      OR: [
        { name: { gt: page.lastName } },
        { name: page.lastName, id: { gt: page.lastId } },
      ],
    })
  }

  const limit = pageSize(params.get("limit"))
  const rows = await prisma.mtmCustomer.findMany({
    where: {
      organizationId: auth.orgId,
      deletedAt: null,
      status: "ACTIVE",
      objectType: objectType ?? { not: "DOCTOR" },
      AND: filters,
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit + 1,
    select: routeFieldOrganizationListSelect,
  })
  const pageRows = rows.slice(0, limit)
  const last = pageRows.at(-1)
  const nextPage = rows.length > limit && last
    ? issueRouteFieldOrganizationPage(context, { name: last.name, id: last.id })
    : null

  return noStoreJson({
    success: true,
    data: {
      organizations: pageRows.map(projectRouteFieldOrganizationListItem),
      nextPage,
      limit,
      asOf,
      timezone,
    },
  })
}, { requiredCapability: "route-field" })
