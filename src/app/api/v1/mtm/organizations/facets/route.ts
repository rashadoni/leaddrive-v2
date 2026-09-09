import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { activeFieldAssignmentWindow, customerScopeForActor } from "@/lib/mtm/field-scope"

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

const SCALAR_FACETS = [
  "region", "administrativeDistrict", "locality", "cityDistrict", "city",
  "specialization", "organizationKind", "territoryCode",
] as const

type ScalarFacet = (typeof SCALAR_FACETS)[number]
type AttributeFacet = "medicalCategoryCode" | "licenseStatus" | "polygonCode"

/**
 * Filter dictionaries for the organization explorer. Each dictionary applies
 * every active list filter except its own value, so dependent geography and
 * classification controls never offer combinations that cannot return rows.
 */
export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const [actor, settings] = await Promise.all([
    resolveMtmRouteActor(prisma, {
      organizationId: auth.orgId,
      userId: auth.userId,
      webRole: auth.role,
      agentId: auth.agentId,
    }),
    getMtmSettings(auth.orgId),
  ])
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const asOf = utcDate(currentDateKey(new Date(), timezone))
  const actorScope = actor.role === "ADMIN"
    ? {}
    : actor.role === "AGENT"
      ? customerScopeForActor(actor, asOf)
      : {
          OR: [
            customerScopeForActor(actor, asOf),
            { agentAssignments: { none: activeFieldAssignmentWindow(asOf) } },
          ],
        }
  const params = new URL(req.url).searchParams
  const search = params.get("search")?.trim() ?? ""
  const category = params.get("category")
  const status = params.get("status")
  const objectType = params.get("objectType")
  const managingManagerId = params.get("managingManagerId")?.trim()
  const assignedAgentId = params.get("assignedAgentId")?.trim()
  const assignmentState = params.get("assignmentState")
  const requestedScope = params.get("scope")
  const effectiveScope = requestedScope === "MINE"
    ? "MINE"
    : requestedScope === "ALL"
      ? "ALL"
      : actor.role === "AGENT" ? "MINE" : "ALL"
  const scalarValues = Object.fromEntries(SCALAR_FACETS.map((field) => [field, params.get(field)?.trim() ?? ""])) as Record<ScalarFacet, string>
  const attributeValues: Record<AttributeFacet, string> = {
    medicalCategoryCode: params.get("medicalCategoryCode")?.trim() ?? "",
    licenseStatus: params.get("licenseStatus")?.trim() ?? "",
    polygonCode: params.get("polygonCode")?.trim() ?? "",
  }
  const activeAttributePackage = { status: "ACTIVE" as const, effectiveFrom: { lte: asOf } }

  const baseAnd: Prisma.MtmCustomerWhereInput[] = [actorScope]
  if (effectiveScope === "MINE") {
    baseAnd.push(actor.agentId ? {
      agentAssignments: { some: { agentId: actor.agentId, ...activeFieldAssignmentWindow(asOf) } },
    } : { id: "__no_actor_assignment__" })
  }
  if (search) {
    baseAnd.push({
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

  const attributeSelection = (omit?: AttributeFacet) => ({
    ...(omit !== "medicalCategoryCode" && attributeValues.medicalCategoryCode
      ? { medicalCategoryCode: attributeValues.medicalCategoryCode }
      : {}),
    ...(omit !== "licenseStatus" && ["LICENSED", "UNLICENSED", "NOT_REQUIRED"].includes(attributeValues.licenseStatus)
      ? { licenseStatus: attributeValues.licenseStatus as "LICENSED" | "UNLICENSED" | "NOT_REQUIRED" }
      : {}),
    ...(omit !== "polygonCode" && attributeValues.polygonCode
      ? { polygonCode: attributeValues.polygonCode }
      : {}),
    package: activeAttributePackage,
  })

  const customerWhere = (
    omitScalar?: ScalarFacet,
    omitAttribute?: AttributeFacet,
    includeAttributeFilters = true,
  ): Prisma.MtmCustomerWhereInput => {
    const scalarFilters: Prisma.MtmCustomerWhereInput = {}
    for (const field of SCALAR_FACETS) {
      const value = scalarValues[field]
      if (field === omitScalar || !value) continue
      Object.assign(scalarFilters, {
        [field]: field === "territoryCode" ? value : { equals: value, mode: "insensitive" },
      })
    }
    const selectedAttributes = attributeSelection(omitAttribute)
    const hasAttributeFilter = Object.keys(selectedAttributes).some((key) => key !== "package")
    return {
      organizationId: auth.orgId,
      deletedAt: null,
      objectType: objectType && ["PHARMACY", "CLINIC", "STORE", "OTHER"].includes(objectType)
        ? objectType as "PHARMACY" | "CLINIC" | "STORE" | "OTHER"
        : { not: "DOCTOR" },
      ...(category && ["A", "B", "C", "D"].includes(category) ? { category: category as "A" | "B" | "C" | "D" } : {}),
      ...(status && ["ACTIVE", "INACTIVE", "PROSPECT"].includes(status) ? { status: status as "ACTIVE" | "INACTIVE" | "PROSPECT" } : {}),
      ...scalarFilters,
      ...(includeAttributeFilters && hasAttributeFilter ? { attributeFacts: { some: selectedAttributes } } : {}),
      ...(managingManagerId ? { managingManagerId } : {}),
      ...(assignedAgentId ? {
        agentAssignments: { some: { agentId: assignedAgentId, ...activeFieldAssignmentWindow(asOf) } },
      } : assignmentState === "UNASSIGNED" ? {
        agentAssignments: { none: activeFieldAssignmentWindow(asOf) },
      } : assignmentState === "ASSIGNED" ? {
        agentAssignments: { some: activeFieldAssignmentWindow(asOf) },
      } : {}),
      AND: baseAnd,
    }
  }

  const values = await Promise.all(SCALAR_FACETS.map(async (field) => {
    const rows = await prisma.mtmCustomer.findMany({
      where: { ...customerWhere(field), [field]: { not: null } },
      distinct: [field],
      select: { [field]: true },
      orderBy: { [field]: "asc" },
      take: 500,
    })
    return [
      field,
      rows
        .map((row: Partial<Record<typeof field, string | null>>) => row[field])
        .filter((value: string | null | undefined): value is string => Boolean(value)),
    ] as const
  }))

  const agents = await prisma.mtmAgent.findMany({
    where: {
      organizationId: auth.orgId,
      status: "ACTIVE",
      ...(actor.scopedAgentIds ? { id: { in: [...actor.scopedAgentIds] } } : {}),
    },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  })
  const attributeCustomerWhere = (omitAttribute: AttributeFacet) => (
    customerWhere(undefined, omitAttribute, false)
  )
  const [medicalCategoryFacts, licenseFacts, polygonFacts] = await Promise.all([
    prisma.mtmOrganizationAttributeFact.findMany({
      where: {
        organizationId: auth.orgId,
        ...attributeSelection("medicalCategoryCode"),
        medicalCategoryCode: { not: null },
        customer: attributeCustomerWhere("medicalCategoryCode"),
      },
      distinct: ["medicalCategoryCode"],
      select: { medicalCategoryCode: true, medicalCategoryLabels: true },
      orderBy: { medicalCategoryCode: "asc" },
      take: 500,
    }),
    prisma.mtmOrganizationAttributeFact.findMany({
      where: {
        organizationId: auth.orgId,
        ...attributeSelection("licenseStatus"),
        licenseStatus: { not: null },
        customer: attributeCustomerWhere("licenseStatus"),
      },
      distinct: ["licenseStatus"],
      select: { licenseStatus: true, licenseLabels: true },
      orderBy: { licenseStatus: "asc" },
      take: 500,
    }),
    prisma.mtmOrganizationAttributeFact.findMany({
      where: {
        organizationId: auth.orgId,
        ...attributeSelection("polygonCode"),
        polygonCode: { not: null },
        customer: attributeCustomerWhere("polygonCode"),
      },
      distinct: ["polygonCode"],
      select: { polygonCode: true, polygonLabels: true },
      orderBy: { polygonCode: "asc" },
      take: 500,
    }),
  ])
  return NextResponse.json({
    success: true,
    data: {
      ...Object.fromEntries(values),
      managers: agents.filter((agent: { role: string }) => agent.role !== "AGENT"),
      assignableAgents: agents.filter((agent: { role: string }) => agent.role === "AGENT"),
      medicalCategories: medicalCategoryFacts
        .filter((fact) => fact.medicalCategoryCode)
        .map((fact) => ({ code: fact.medicalCategoryCode!, labels: fact.medicalCategoryLabels })),
      licenseStatuses: licenseFacts
        .filter((fact) => fact.licenseStatus)
        .map((fact) => ({ code: fact.licenseStatus!, labels: fact.licenseLabels })),
      polygons: polygonFacts
        .filter((fact) => fact.polygonCode)
        .map((fact) => ({ code: fact.polygonCode!, labels: fact.polygonLabels })),
      asOf: asOf.toISOString().slice(0, 10),
    },
  })
})
