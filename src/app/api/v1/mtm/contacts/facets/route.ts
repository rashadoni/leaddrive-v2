import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { contactScopeForActor } from "@/lib/mtm/field-scope"

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function strings<T>(rows: T[], read: (row: T) => string | null): string[] {
  return rows
    .map(read)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
}

/** Filter dictionaries for the contact explorer, scoped exactly like its list. */
export const GET = withRouteFieldRlsAuth("read", async (_req, auth) => {
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
  const contactWhere: Prisma.MtmContactWhereInput = {
    organizationId: auth.orgId,
    deletedAt: null,
    ...(actor.role === "ADMIN" ? {} : { AND: [contactScopeForActor(actor, asOf)] }),
  }
  const customerWhere: Prisma.MtmCustomerWhereInput = {
    organizationId: auth.orgId,
    deletedAt: null,
    objectType: { not: "DOCTOR" },
    contactWorkplaces: {
      some: {
        deletedAt: null,
        endedOn: null,
        contact: contactWhere,
      },
    },
  }

  const [
    specialties,
    profiles,
    qualifications,
    regions,
    administrativeDistricts,
    localities,
    cityDistricts,
    organizationKinds,
    objectTypes,
  ] = await Promise.all([
    prisma.mtmContact.findMany({
      where: { ...contactWhere, specialtyCode: { not: null } },
      distinct: ["specialtyCode"],
      select: { specialtyCode: true },
      orderBy: { specialtyCode: "asc" },
      take: 500,
    }),
    prisma.mtmContact.findMany({
      where: { ...contactWhere, profile: { not: null } },
      distinct: ["profile"],
      select: { profile: true },
      orderBy: { profile: "asc" },
      take: 500,
    }),
    prisma.mtmContact.findMany({
      where: { ...contactWhere, qualificationCategory: { not: null } },
      distinct: ["qualificationCategory"],
      select: { qualificationCategory: true },
      orderBy: { qualificationCategory: "asc" },
      take: 500,
    }),
    prisma.mtmCustomer.findMany({
      where: { ...customerWhere, region: { not: null } },
      distinct: ["region"],
      select: { region: true },
      orderBy: { region: "asc" },
      take: 500,
    }),
    prisma.mtmCustomer.findMany({
      where: { ...customerWhere, administrativeDistrict: { not: null } },
      distinct: ["administrativeDistrict"],
      select: { administrativeDistrict: true },
      orderBy: { administrativeDistrict: "asc" },
      take: 500,
    }),
    prisma.mtmCustomer.findMany({
      where: { ...customerWhere, locality: { not: null } },
      distinct: ["locality"],
      select: { locality: true },
      orderBy: { locality: "asc" },
      take: 500,
    }),
    prisma.mtmCustomer.findMany({
      where: { ...customerWhere, cityDistrict: { not: null } },
      distinct: ["cityDistrict"],
      select: { cityDistrict: true },
      orderBy: { cityDistrict: "asc" },
      take: 500,
    }),
    prisma.mtmCustomer.findMany({
      where: { ...customerWhere, organizationKind: { not: null } },
      distinct: ["organizationKind"],
      select: { organizationKind: true },
      orderBy: { organizationKind: "asc" },
      take: 500,
    }),
    prisma.mtmCustomer.findMany({
      where: customerWhere,
      distinct: ["objectType"],
      select: { objectType: true },
      orderBy: { objectType: "asc" },
      take: 500,
    }),
  ])

  return NextResponse.json({
    success: true,
    data: {
      specialtyCodes: strings(specialties, (row) => row.specialtyCode),
      profiles: strings(profiles, (row) => row.profile),
      qualificationCategories: strings(qualifications, (row) => row.qualificationCategory),
      regions: strings(regions, (row) => row.region),
      administrativeDistricts: strings(administrativeDistricts, (row) => row.administrativeDistrict),
      localities: strings(localities, (row) => row.locality),
      cityDistricts: strings(cityDistricts, (row) => row.cityDistrict),
      organizationKinds: strings(organizationKinds, (row) => row.organizationKind),
      objectTypes: strings(objectTypes, (row) => row.objectType),
      asOf: asOf.toISOString().slice(0, 10),
    },
  })
})
