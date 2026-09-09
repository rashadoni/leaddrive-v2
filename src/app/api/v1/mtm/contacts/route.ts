import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { ContactCreateSchema, parseBody } from "@/lib/mtm-validators"
import { getMtmSettings } from "@/lib/mtm-settings"
import { missingMtmContactRequiredFields } from "@/lib/mtm/contact-required-fields"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import {
  activeFieldAssignmentWindow,
  canManageFieldMasterData,
  contactDisplayName,
  contactScopeForActor,
} from "@/lib/mtm/field-scope"
import { contactTransferSyncScopeKey } from "@/lib/mtm/contact-transfer"
import { contactCoveragePeriod, contactCoverageState } from "@/lib/mtm/contact-list-coverage"
import { CoverageSnapshotExplanationSchema } from "@/lib/mtm/coverage-policy"
import { readGovernedCoverageMany } from "@/lib/mtm/coverage-read"
import { writeMtmAudit } from "@/lib/mtm-audit"

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function forbidden(code = "MTM_CONTACT_SCOPE_DENIED") {
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

  const settings = await getMtmSettings(auth.orgId)
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const asOf = utcDate(currentDateKey(new Date(), timezone))

  const params = new URL(req.url).searchParams
  const search = params.get("search")?.trim() ?? ""
  const type = params.get("type")
  const status = params.get("status")
  const specialtyCode = params.get("specialtyCode")
  const profile = params.get("profile")
  const qualificationCategory = params.get("qualificationCategory")
  const category = params.get("category")
  const customerId = params.get("customerId")
  const region = params.get("region")
  const administrativeDistrict = params.get("administrativeDistrict")
  const locality = params.get("locality")
  const cityDistrict = params.get("cityDistrict")
  const organizationKind = params.get("organizationKind")
  const objectType = params.get("objectType")
  const ownerAgentId = params.get("ownerAgentId")
  const assignmentState = params.get("assignmentState")
  const coveragePeriod = contactCoveragePeriod(params.get("coveragePeriod"), asOf.toISOString().slice(0, 10))
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1)
  const limit = Math.min(200, Math.max(1, Number.parseInt(params.get("limit") ?? "50", 10) || 50))

  const and: Prisma.MtmContactWhereInput[] = []
  if (actor.role !== "ADMIN") and.push(contactScopeForActor(actor, asOf))
  if (ownerAgentId) {
    if (!isAgentInRouteScope(actor, ownerAgentId)) return forbidden()
    and.push({
      agentAssignments: {
        some: { agentId: ownerAgentId, role: "PRIMARY", ...activeFieldAssignmentWindow(asOf) },
      },
    })
  }
  if (assignmentState === "UNASSIGNED") {
    and.push({ agentAssignments: { none: { role: "PRIMARY", ...activeFieldAssignmentWindow(asOf) } } })
  } else if (assignmentState === "ASSIGNED") {
    and.push({ agentAssignments: { some: { role: "PRIMARY", ...activeFieldAssignmentWindow(asOf) } } })
  }
  if (search) {
    and.push({
      OR: [
        { displayName: { contains: search, mode: "insensitive" } },
        { externalCode: { contains: search, mode: "insensitive" } },
        { specialtyName: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { mobilePhone: { contains: search, mode: "insensitive" } },
        { workPhone: { contains: search, mode: "insensitive" } },
        { whatsappPhone: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
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
                  { city: { contains: search, mode: "insensitive" } },
                  { district: { contains: search, mode: "insensitive" } },
                ],
              },
            },
          },
        },
      ],
    })
  }
  const workplaceCustomer: Prisma.MtmCustomerWhereInput = {
    ...(region ? { region } : {}),
    ...(administrativeDistrict ? { administrativeDistrict } : {}),
    ...(locality ? { locality } : {}),
    ...(cityDistrict ? { cityDistrict } : {}),
    ...(organizationKind ? { organizationKind } : {}),
    ...(objectType && ["PHARMACY", "CLINIC", "STORE", "OTHER"].includes(objectType)
      ? { objectType: objectType as "PHARMACY" | "CLINIC" | "STORE" | "OTHER" }
      : {}),
  }
  if (customerId || Object.keys(workplaceCustomer).length > 0) {
    and.push({
      workplaces: {
        some: {
          ...(customerId ? { customerId } : {}),
          deletedAt: null,
          endedOn: null,
          ...(Object.keys(workplaceCustomer).length > 0 ? { customer: workplaceCustomer } : {}),
        },
      },
    })
  }

  const where: Prisma.MtmContactWhereInput = {
    organizationId: auth.orgId,
    deletedAt: null,
    ...(type && ["DOCTOR", "PHARMACIST", "OTHER"].includes(type) ? { type: type as "DOCTOR" | "PHARMACIST" | "OTHER" } : {}),
    ...(status && ["ACTIVE", "INACTIVE", "PROSPECT", "DUPLICATE", "MERGED"].includes(status) ? { status: status as "ACTIVE" | "INACTIVE" | "PROSPECT" | "DUPLICATE" | "MERGED" } : {}),
    ...(specialtyCode ? { specialtyCode } : {}),
    ...(profile ? { profile } : {}),
    ...(qualificationCategory ? { qualificationCategory } : {}),
    ...(category && ["A", "B", "C", "D"].includes(category) ? { category: category as "A" | "B" | "C" | "D" } : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  }

  const [contacts, total, availableAgents] = await Promise.all([
    prisma.mtmContact.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      include: {
        workplaces: {
          where: { deletedAt: null, endedOn: null },
          orderBy: [{ isPrimary: "desc" }, { startedOn: "desc" }],
          include: { customer: { select: {
            id: true,
            code: true,
            name: true,
            objectType: true,
            category: true,
            address: true,
            city: true,
            district: true,
            phone: true,
            latitude: true,
            longitude: true,
          } } },
        },
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
          orderBy: { checkInAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            checkInAt: true,
            checkOutAt: true,
            outcome: true,
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
            },
          },
          orderBy: [{ route: { date: "asc" } }, { orderIndex: "asc" }],
          take: 1,
          select: {
            id: true,
            routeId: true,
            plannedTime: true,
            orderIndex: true,
            route: {
              select: {
                date: true,
                status: true,
              },
            },
          },
        },
      },
    }),
    prisma.mtmContact.count({ where }),
    prisma.mtmAgent.findMany({
      where: {
        organizationId: auth.orgId,
        role: "AGENT",
        ...(actor.scopedAgentIds === null ? {} : { id: { in: [...actor.scopedAgentIds] } }),
      },
      select: { id: true, name: true, role: true, status: true },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
  ])

  const coverageAgentIds = [...new Set(contacts.flatMap((contact) => {
    if (contact.type !== "DOCTOR") return []
    const owner = contact.agentAssignments.find((assignment) => assignment.role === "PRIMARY")
    return owner ? [owner.agentId] : []
  }))]
  const governedCoverageByAgent = await readGovernedCoverageMany(prisma, {
    organizationId: auth.orgId,
    agentIds: coverageAgentIds,
    periodStart: coveragePeriod.start,
    periodEnd: coveragePeriod.end,
    periodStartKey: coveragePeriod.startKey,
    periodEndKey: coveragePeriod.endKey,
  })
  const snapshotIds = [...new Set([...governedCoverageByAgent.values()]
    .filter((coverage) => coverage.available && coverage.snapshot)
    .map((coverage) => coverage.snapshot!.id))]
  const coverageRows = snapshotIds.length > 0 && contacts.length > 0
    ? await prisma.mtmCoverageSnapshotRow.findMany({
        where: {
          organizationId: auth.orgId,
          snapshotId: { in: snapshotIds },
          subjectType: "DOCTOR",
          subjectId: { in: contacts.map((contact) => contact.id) },
        },
        select: {
          snapshotId: true,
          subjectId: true,
          groupKey: true,
          groupLabel: true,
          requiredCoverage: true,
          actualMoi: true,
          target: true,
          actualCoverage: true,
          uncoveredMoi: true,
          explanation: true,
        },
      })
    : []
  const coverageRowBySnapshotAndContact = new Map(
    coverageRows.map((row) => [`${row.snapshotId}:${row.subjectId}`, row] as const),
  )
  const contactsWithCoverage = contacts.map((contact) => {
    const period = { key: coveragePeriod.key, start: coveragePeriod.startKey, end: coveragePeriod.endKey }
    if (contact.type !== "DOCTOR") {
      return { ...contact, coverage: { available: false, state: "NOT_APPLICABLE", period } }
    }
    const owner = contact.agentAssignments.find((assignment) => assignment.role === "PRIMARY")
    if (!owner) return { ...contact, coverage: { available: false, state: "NO_OWNER", period } }
    const governed = governedCoverageByAgent.get(owner.agentId)
    if (!governed || !governed.available || !governed.snapshot || !governed.policy) {
      return {
        ...contact,
        coverage: {
          available: false,
          state: governed?.state ?? "NO_COVERAGE_SNAPSHOT",
          period,
          policy: governed?.policy ? {
            version: governed.policy.version,
            approvalReference: governed.policy.approvalReference,
          } : null,
        },
      }
    }
    const row = coverageRowBySnapshotAndContact.get(`${governed.snapshot.id}:${contact.id}`)
    if (!row) {
      return {
        ...contact,
        coverage: {
          available: false,
          state: "NOT_IN_SNAPSHOT",
          period,
          policy: { version: governed.policy.version, approvalReference: governed.policy.approvalReference },
          snapshot: { id: governed.snapshot.id, frozenAt: governed.snapshot.frozenAt },
        },
      }
    }
    const explanation = CoverageSnapshotExplanationSchema.safeParse(row.explanation)
    const uncoveredMoi = row.uncoveredMoi.toString()
    const state = explanation.success
      ? contactCoverageState(uncoveredMoi)
      : "COVERAGE_ROW_EXPLANATION_INVALID"
    if (state === "COVERAGE_ROW_INVALID" || state === "COVERAGE_ROW_EXPLANATION_INVALID") {
      return { ...contact, coverage: { available: false, state, period } }
    }
    return {
      ...contact,
      coverage: {
        available: true,
        state,
        period,
        groupKey: row.groupKey,
        groupLabel: row.groupLabel,
        requiredCoverage: row.requiredCoverage.toString(),
        actualMoi: row.actualMoi.toString(),
        target: row.target.toString(),
        actualCoverage: row.actualCoverage.toString(),
        uncoveredMoi,
        explanation: explanation.data,
        policy: { version: governed.policy.version, approvalReference: governed.policy.approvalReference },
        snapshot: { id: governed.snapshot.id, frozenAt: governed.snapshot.frozenAt },
      },
    }
  })

  return NextResponse.json({
    success: true,
    data: {
      contacts: contactsWithCoverage,
      total,
      page,
      limit,
      asOf: asOf.toISOString().slice(0, 10),
      timezone,
      coveragePeriod: {
        key: coveragePeriod.key,
        start: coveragePeriod.startKey,
        end: coveragePeriod.endKey,
      },
      transferSyncScopeKey: contactTransferSyncScopeKey({
        organizationId: auth.orgId,
        userId: auth.userId,
        agentId: actor.agentId,
      }),
      availableAgents,
      capabilities: {
        canManage: canManageFieldMasterData(actor),
        canRequestChanges: actor.role === "AGENT" && actor.agentId !== null,
        canTransfer: canManageFieldMasterData(actor),
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
    return forbidden("MTM_CONTACT_APPROVAL_REQUIRED")
  }

  const parsed = parseBody(ContactCreateSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const settings = await getMtmSettings(auth.orgId)
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const asOf = utcDate(currentDateKey(new Date(), timezone))

  const missingRequiredFields = missingMtmContactRequiredFields(body, settings.contactRequiredFields)
  if (missingRequiredFields.length > 0) {
    return NextResponse.json({
      error: "Required contact fields are missing",
      code: "MTM_CONTACT_REQUIRED_FIELDS",
      data: { fields: missingRequiredFields },
    }, { status: 422 })
  }

  if (body.duplicateOfContactId) {
    const target = await prisma.mtmContact.findFirst({
      where: {
        id: body.duplicateOfContactId,
        organizationId: auth.orgId,
        deletedAt: null,
        ...(actor.role === "ADMIN" ? {} : { AND: [contactScopeForActor(actor, asOf)] }),
      },
      select: { id: true },
    })
    if (!target) return NextResponse.json({ error: "Duplicate target not found", code: "MTM_CONTACT_DUPLICATE_TARGET_INVALID" }, { status: 400 })
  }

  try {
    const contact = await prisma.mtmContact.create({
      data: {
        organizationId: auth.orgId,
        externalCode: body.externalCode ?? null,
        firstName: body.firstName,
        lastName: body.lastName,
        middleName: body.middleName ?? null,
        displayName: contactDisplayName(body),
        type: body.type ?? "DOCTOR",
        specialtyCode: body.specialtyCode ?? null,
        specialtyName: body.specialtyName ?? null,
        qualificationCategory: body.qualificationCategory ?? null,
        profile: body.profile ?? null,
        category: body.category ?? "B",
        status: body.status ?? "ACTIVE",
        birthDate: body.birthDate ? utcDate(body.birthDate) : null,
        gender: body.gender ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        messengerPhone: body.messengerPhone ?? null,
        workPhone: body.workPhone ?? null,
        homePhone: body.homePhone ?? null,
        mobilePhone: body.mobilePhone ?? null,
        viberPhone: body.viberPhone ?? null,
        whatsappPhone: body.whatsappPhone ?? null,
        telegramPhone: body.telegramPhone ?? null,
        postalCode: body.postalCode ?? null,
        addressRegion: body.addressRegion ?? null,
        addressLocality: body.addressLocality ?? null,
        addressDistrict: body.addressDistrict ?? null,
        addressStreet: body.addressStreet ?? null,
        productCategory: body.productCategory ?? null,
        verificationStatus: body.verificationStatus ?? "UNVERIFIED",
        consentStatus: body.consentStatus ?? "UNKNOWN",
        contactPreference: body.contactPreference ?? null,
        source: body.source ?? "ADMIN",
        verifiedAt: body.verificationStatus === "VERIFIED" ? new Date() : null,
        verifiedBy: body.verificationStatus === "VERIFIED" ? auth.userId || null : null,
        duplicateOfContactId: body.duplicateOfContactId ?? null,
        notes: body.notes ?? null,
      },
    })

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: actor.agentId,
      action: "CONTACT_CREATE",
      entity: "contact",
      entityId: contact.id,
      metadataKind: "contact_create",
      newData: contact,
      req,
    }).catch((error) => console.warn("[MTM/contacts POST] audit failed", error))

    return NextResponse.json({ success: true, data: contact }, { status: 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A contact with this external code already exists", code: "MTM_CONTACT_DUPLICATE" }, { status: 409 })
    }
    console.error("[MTM/contacts POST]", error)
    return NextResponse.json({ error: "Failed to create contact" }, { status: 500 })
  }
})
