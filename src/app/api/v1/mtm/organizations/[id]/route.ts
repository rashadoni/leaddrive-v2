import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { normalizeMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { isAgentInRouteScope, resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { CustomerUpdateSchema, parseBody } from "@/lib/mtm-validators"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import {
  activeFieldAssignmentWindow,
  canManageFieldMasterData,
  customerScopeForActor,
} from "@/lib/mtm/field-scope"
import { writeMtmAudit } from "@/lib/mtm-audit"

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function customerAccessForActor(actor: MtmRouteActor, asOf: Date): Prisma.MtmCustomerWhereInput {
  if (actor.role === "ADMIN") return {}
  const scoped = customerScopeForActor(actor, asOf)
  if (actor.role === "AGENT") return scoped
  return {
    OR: [
      scoped,
      { agentAssignments: { none: activeFieldAssignmentWindow(asOf) } },
    ],
  }
}

async function context(auth: { orgId: string; userId: string; role: string; agentId: string | null }) {
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
  return { actor, timezone, asOf: utcDate(currentDateKey(new Date(), timezone)) }
}

const detailSections = new Set(["summary", "contacts", "visits", "departments", "staff", "promotions", "files"])

export const GET = withRouteFieldRlsAuth("read", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { actor, timezone, asOf } = await context(auth)
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const requestedSection = new URL(req.url).searchParams.get("section")
  if (requestedSection && !detailSections.has(requestedSection)) {
    return NextResponse.json({ error: "Unsupported organization detail section" }, { status: 400 })
  }

  const where: Prisma.MtmCustomerWhereInput = {
    id,
    organizationId: auth.orgId,
    deletedAt: null,
    objectType: { not: "DOCTOR" },
    AND: [customerAccessForActor(actor, asOf)],
  }

  const agentSelect = { id: true, name: true, role: true, status: true } as const
  let organization
  let commercial: null | {
    month: string
    year: string
    monthTotals: Array<{ currency: string; amount: string }>
    yearTotals: Array<{ currency: string; amount: string }>
    latestSource: null | Record<string, unknown>
  } = null
  let coordinateVerification: null | Record<string, unknown> = null

  if (requestedSection === "summary") {
    organization = await prisma.mtmCustomer.findFirst({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        objectType: true,
        category: true,
        status: true,
        address: true,
        region: true,
        administrativeDistrict: true,
        locality: true,
        cityDistrict: true,
        city: true,
        district: true,
        specialization: true,
        organizationKind: true,
        territoryCode: true,
        polygon: true,
        latitude: true,
        longitude: true,
        phone: true,
        contactPerson: true,
        notes: true,
        geofenceRadius: true,
        createdAt: true,
        updatedAt: true,
        managingManager: { select: agentSelect },
        agentAssignments: {
          where: activeFieldAssignmentWindow(asOf),
          orderBy: [{ role: "asc" }, { effectiveFrom: "desc" }],
          include: { agent: { select: agentSelect } },
        },
        _count: {
          select: {
            contactWorkplaces: { where: { deletedAt: null, endedOn: null } },
            visits: { where: { deletedAt: null } },
          },
        },
        attributeFacts: {
          where: { package: { status: "ACTIVE" } },
          orderBy: { package: { activatedAt: "desc" } },
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
                sourceSystem: true,
                sourceReference: true,
                sourceObservedAt: true,
                effectiveFrom: true,
              },
            },
          },
        },
      },
    })
    if (organization) {
      const year = asOf.getUTCFullYear()
      const month = asOf.getUTCMonth()
      const yearStart = new Date(Date.UTC(year, 0, 1))
      const monthStart = new Date(Date.UTC(year, month, 1))
      const monthEnd = new Date(Date.UTC(year, month + 1, 1))
      const yearEnd = new Date(Date.UTC(year + 1, 0, 1))
      const salesWhere = { organizationId: auth.orgId, customerId: id, status: { not: "CANCELLED" as const } }
      const [monthTotals, yearTotals, latestSource, latestVerification] = await Promise.all([
        prisma.mtmExternalSalesDocument.groupBy({
          by: ["currency"],
          where: { ...salesWhere, documentDate: { gte: monthStart, lt: monthEnd } },
          _sum: { totalAmount: true },
          orderBy: { currency: "asc" },
        }),
        prisma.mtmExternalSalesDocument.groupBy({
          by: ["currency"],
          where: { ...salesWhere, documentDate: { gte: yearStart, lt: yearEnd } },
          _sum: { totalAmount: true },
          orderBy: { currency: "asc" },
        }),
        prisma.mtmExternalSalesDocument.findFirst({
          where: salesWhere,
          orderBy: [{ documentDate: "desc" }, { updatedAt: "desc" }],
          select: {
            externalDocumentNo: true,
            documentDate: true,
            status: true,
            currency: true,
            updatedAt: true,
            sourceImportJob: {
              select: {
                id: true,
                type: true,
                status: true,
                originalFileName: true,
                fileChecksum: true,
                appliedAt: true,
                createdAt: true,
              },
            },
          },
        }),
        prisma.mtmCustomerCoordinateVerification.findFirst({
          where: { organizationId: auth.orgId, customerId: id },
          orderBy: [{ verifiedAt: "desc" }, { createdAt: "desc" }],
          select: {
            id: true,
            latitude: true,
            longitude: true,
            status: true,
            accuracyMeters: true,
            sourceSystem: true,
            sourceReference: true,
            sourceObservedAt: true,
            decisionReason: true,
            verifiedByUserId: true,
            verifiedAt: true,
          },
        }),
      ])
      commercial = {
        month: `${year}-${String(month + 1).padStart(2, "0")}`,
        year: String(year),
        monthTotals: monthTotals.map((row) => ({ currency: row.currency, amount: row._sum.totalAmount?.toString() ?? "0" })),
        yearTotals: yearTotals.map((row) => ({ currency: row.currency, amount: row._sum.totalAmount?.toString() ?? "0" })),
        latestSource,
      }
      coordinateVerification = latestVerification
    }
  } else if (requestedSection === "contacts") {
    organization = await prisma.mtmCustomer.findFirst({
      where,
      select: {
        id: true,
        name: true,
        contactWorkplaces: {
          where: { deletedAt: null },
          orderBy: [{ endedOn: "asc" }, { isPrimary: "desc" }, { startedOn: "desc" }],
          include: { contact: true },
        },
      },
    })
  } else if (requestedSection === "visits") {
    organization = await prisma.mtmCustomer.findFirst({
      where,
      select: {
        id: true,
        name: true,
        visits: {
          where: { deletedAt: null },
          orderBy: { checkInAt: "desc" },
          take: 50,
          select: {
            id: true,
            status: true,
            checkInAt: true,
            checkOutAt: true,
            outcome: true,
            potential: true,
            resultNotes: true,
            agent: { select: { id: true, name: true } },
          },
        },
      },
    })
  } else if (requestedSection === "staff") {
    organization = await prisma.mtmCustomer.findFirst({
      where,
      select: {
        id: true,
        name: true,
        managingManager: { select: agentSelect },
        agentAssignments: {
          where: { deletedAt: null },
          orderBy: [{ effectiveFrom: "desc" }, { role: "asc" }],
          take: 100,
          include: { agent: { select: agentSelect } },
        },
        fieldPotentials: {
          where: { deletedAt: null },
          orderBy: [{ periodStart: "desc" }, { updatedAt: "desc" }],
          take: 100,
        },
      },
    })
  } else if (requestedSection === "departments") {
    organization = await prisma.mtmCustomer.findFirst({
      where,
      select: {
        id: true,
        name: true,
        departments: {
          where: { archivedAt: null },
          orderBy: [{ name: "asc" }, { createdAt: "desc" }],
          take: 200,
          select: {
            id: true,
            code: true,
            name: true,
            kind: true,
            phone: true,
            email: true,
            address: true,
            contactPerson: true,
            sourceSystem: true,
            sourceReference: true,
            sourceObservedAt: true,
            createdAt: true,
          },
        },
      },
    })
  } else if (requestedSection === "promotions") {
    organization = await prisma.mtmCustomer.findFirst({
      where,
      select: {
        id: true,
        name: true,
        pharmacyPromotionTargets: {
          orderBy: [{ createdAt: "desc" }],
          take: 100,
          select: {
            id: true,
            status: true,
            eligibilityStatus: true,
            planQuantity: true,
            unit: true,
            sourceSystem: true,
            sourceReference: true,
            sourceObservedAt: true,
            connectedAt: true,
            closedAt: true,
            assignedAgent: { select: { id: true, name: true } },
            promotionVersion: {
              select: {
                id: true,
                revision: true,
                nameRu: true,
                nameAz: true,
                nameEn: true,
                startsOn: true,
                endsOn: true,
                status: true,
                promotion: { select: { code: true } },
                type: { select: { code: true, nameRu: true, nameAz: true, nameEn: true } },
              },
            },
            executions: {
              orderBy: [{ createdAt: "desc" }],
              take: 1,
              select: {
                id: true,
                status: true,
                actualQuantity: true,
                factPointsPreview: true,
                rewardPointsPreview: true,
                differencePointsPreview: true,
                l1State: true,
                l2State: true,
                submittedAt: true,
                closedAt: true,
              },
            },
          },
        },
      },
    })
  } else if (requestedSection === "files") {
    organization = await prisma.mtmCustomer.findFirst({
      where,
      select: {
        id: true,
        name: true,
        documents: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: "desc" }],
          take: 100,
          select: {
            id: true,
            title: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            checksumSha256: true,
            sourceSystem: true,
            sourceReference: true,
            sourceObservedAt: true,
            uploadedByAgentId: true,
            uploadedByUserId: true,
            createdAt: true,
          },
        },
      },
    })
  } else {
    // Backwards-compatible full projection for existing API consumers.
    organization = await prisma.mtmCustomer.findFirst({
      where,
      include: {
        contactWorkplaces: {
          where: { deletedAt: null },
          orderBy: [{ endedOn: "asc" }, { isPrimary: "desc" }, { startedOn: "desc" }],
          include: { contact: true },
        },
        managingManager: { select: agentSelect },
        agentAssignments: {
          where: activeFieldAssignmentWindow(asOf),
          orderBy: [{ role: "asc" }, { effectiveFrom: "desc" }],
          include: { agent: { select: agentSelect } },
        },
        fieldPotentials: {
          where: { deletedAt: null },
          orderBy: [{ periodStart: "desc" }, { updatedAt: "desc" }],
        },
        visits: {
          where: { deletedAt: null },
          orderBy: { checkInAt: "desc" },
          take: 50,
          select: {
            id: true,
            status: true,
            checkInAt: true,
            checkOutAt: true,
            outcome: true,
            potential: true,
            agent: { select: { id: true, name: true } },
          },
        },
      },
    })
  }
  if (!organization) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({
    success: true,
    data: {
      organization,
      asOf: asOf.toISOString().slice(0, 10),
      timezone,
      section: requestedSection ?? "all",
      commercial,
      coordinateVerification,
      capabilities: {
        canManage: canManageFieldMasterData(actor),
        canRequestChanges: actor.agentId !== null,
      },
    },
  })
})

export const PUT = withRouteFieldRlsAuth("write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { actor, asOf } = await context(auth)
  if (!actor || !canManageFieldMasterData(actor)) {
    return NextResponse.json({ error: "Agents must request organization changes", code: "MTM_ORGANIZATION_APPROVAL_REQUIRED" }, { status: 403 })
  }
  const parsed = parseBody(CustomerUpdateSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  if (body.objectType === "DOCTOR") {
    return NextResponse.json({ error: "Doctors must be contacts", code: "MTM_CONTACT_REQUIRED" }, { status: 400 })
  }
  if (body.managingManagerId) {
    if (!isAgentInRouteScope(actor, body.managingManagerId)) {
      return NextResponse.json({ error: "Managing manager is outside your scope", code: "MTM_ORGANIZATION_MANAGER_SCOPE_DENIED" }, { status: 403 })
    }
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

  const before = await prisma.mtmCustomer.findFirst({
    where: {
      id,
      organizationId: auth.orgId,
      deletedAt: null,
      AND: [customerAccessForActor(actor, asOf)],
    },
  })
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const data: Prisma.MtmCustomerUpdateManyMutationInput = {}
  for (const key of [
    "code", "address", "region", "administrativeDistrict", "locality", "cityDistrict",
    "city", "district", "specialization", "organizationKind", "territoryCode",
    "managingManagerId", "phone", "contactPerson", "notes",
  ] as const) {
    if (body[key] !== undefined) Object.assign(data, { [key]: body[key] ?? null })
  }
  for (const key of ["name", "objectType", "category", "status"] as const) {
    if (body[key] !== undefined) Object.assign(data, { [key]: body[key] })
  }
  // The pair moves together: one axis alone is rejected by the validator, and
  // (0, 0) or a cleared axis stores NULL on both (src/lib/mtm/geo-coordinates.ts).
  if (body.latitude !== undefined || body.longitude !== undefined) Object.assign(data, normalizeMtmCoordinates(body))
  if (body.geofenceRadius !== undefined) data.geofenceRadius = body.geofenceRadius ?? null
  if (body.polygon !== undefined) data.polygon = body.polygon === null ? Prisma.JsonNull : body.polygon as Prisma.InputJsonValue

  try {
    const changed = await prisma.mtmCustomer.updateMany({
      where: { id, organizationId: auth.orgId, deletedAt: null, updatedAt: before.updatedAt },
      data,
    })
    if (changed.count !== 1) {
      return NextResponse.json({ error: "Organization changed concurrently", code: "MTM_ORGANIZATION_CONFLICT" }, { status: 409 })
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "An organization with this code already exists", code: "MTM_ORGANIZATION_DUPLICATE" }, { status: 409 })
    }
    throw error
  }

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: "FIELD_ORGANIZATION_UPDATE",
    entity: "customer",
    entityId: id,
    metadataKind: "field_organization_update",
    oldData: before,
    newData: data,
    req,
  }).catch((error) => console.warn("[MTM/organizations/[id] PUT] audit failed", error))
  return NextResponse.json({ success: true })
})

export const DELETE = withRouteFieldRlsAuth("write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { actor, asOf } = await context(auth)
  if (!actor || !canManageFieldMasterData(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const before = await prisma.mtmCustomer.findFirst({
    where: {
      id,
      organizationId: auth.orgId,
      deletedAt: null,
      AND: [customerAccessForActor(actor, asOf)],
    },
  })
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const deletedAt = new Date()
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const changed = await tx.mtmCustomer.updateMany({
      where: { id, organizationId: auth.orgId, deletedAt: null, updatedAt: before.updatedAt },
      data: { deletedAt },
    })
    if (changed.count !== 1) throw new Error("Organization changed concurrently")
    await tx.mtmCustomerAgentAssignment.updateMany({
      where: { organizationId: auth.orgId, customerId: id, deletedAt: null, effectiveTo: null },
      data: { effectiveTo: asOf },
    })
    await tx.mtmContactWorkplace.updateMany({
      where: { organizationId: auth.orgId, customerId: id, deletedAt: null, endedOn: null },
      data: { endedOn: asOf, isPrimary: false, updatedBy: auth.userId || null },
    })
  })

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: "FIELD_ORGANIZATION_DELETE",
    entity: "customer",
    entityId: id,
    metadataKind: "field_organization_delete",
    oldData: before,
    newData: { deletedAt },
    req,
  }).catch((error) => console.warn("[MTM/organizations/[id] DELETE] audit failed", error))
  return NextResponse.json({ success: true })
})
