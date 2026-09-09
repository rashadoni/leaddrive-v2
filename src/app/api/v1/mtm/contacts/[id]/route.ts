import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { ContactDirectUpdateSchema, parseBody } from "@/lib/mtm-validators"
import { buildContactUpdateData, utcDate } from "@/lib/mtm/contact-master-data"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import {
  canManageFieldMasterData,
  contactScopeForActor,
} from "@/lib/mtm/field-scope"
import { writeMtmAudit } from "@/lib/mtm-audit"
import {
  coerceMtmContactRequiredFields,
  mergedMtmContactState,
  missingMtmContactRequiredFields,
} from "@/lib/mtm/contact-required-fields"
import {
  CONTACT_MASTER_DICTIONARY_KINDS,
  contactDictionaryAssignmentStateHash,
  verifiedContactDictionaryEntries,
} from "@/lib/mtm/contact-dictionary-assignment"

function duplicateTargetId(payload: Prisma.JsonValue): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const value = (payload as Prisma.JsonObject).targetContactId
  return typeof value === "string" ? value : null
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
  return { actor, settings, timezone, asOf: utcDate(currentDateKey(new Date(), timezone)) }
}

export const GET = withRouteFieldRlsAuth("read", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { actor, settings, timezone, asOf } = await context(auth)
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const fieldPotentialAgentIds = actor.role === "ADMIN" || actor.scopedAgentIds === null
    ? null
    : actor.role === "AGENT"
      ? (actor.agentId ? [actor.agentId] : [])
      : [...actor.scopedAgentIds]

  const contact = await prisma.mtmContact.findFirst({
    where: {
      id,
      organizationId: auth.orgId,
      deletedAt: null,
      ...(actor.role === "ADMIN" ? {} : { AND: [contactScopeForActor(actor, asOf)] }),
    },
    include: {
      workplaces: {
        where: { deletedAt: null },
        orderBy: [{ endedOn: "asc" }, { isPrimary: "desc" }, { startedOn: "desc" }],
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
        where: { deletedAt: null },
        orderBy: [{ effectiveTo: "asc" }, { effectiveFrom: "desc" }],
        include: { agent: { select: { id: true, name: true, role: true, status: true } } },
      },
      fieldPotentials: {
        where: {
          deletedAt: null,
          ...(fieldPotentialAgentIds === null ? {} : { OR: [{ agentId: null }, { agentId: { in: fieldPotentialAgentIds } }] }),
        },
        orderBy: [{ periodStart: "desc" }, { updatedAt: "desc" }],
        take: 100,
        include: {
          agent: { select: { id: true, name: true } },
          enteredByAgent: { select: { id: true, name: true } },
          reviewedByAgent: { select: { id: true, name: true } },
          evidenceVisits: {
            include: { visit: { select: { id: true, checkInAt: true, checkOutAt: true, status: true, customer: { select: { id: true, name: true } } } } },
          },
        },
      },
      doctorAssessments: {
        orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
        take: 50,
        include: {
          formula: { select: {
            id: true,
            version: true,
            name: true,
            definition: true,
            definitionHash: true,
            glossarySchemaVersion: true,
            approvalReference: true,
            sourceSystem: true,
            sourceReference: true,
            sourceObservedAt: true,
            status: true,
            signedAt: true,
          } },
          enteredByAgent: { select: { id: true, name: true } },
          reviewedByAgent: { select: { id: true, name: true } },
        },
      },
      dictionaryAssignments: {
        orderBy: [{ effectiveTo: "asc" }, { effectiveFrom: "desc" }, { kind: "asc" }, { entryCode: "asc" }],
        take: 200,
        include: { dictionary: true },
      },
      duplicateOfContact: { select: { id: true, displayName: true, status: true } },
      changeRequests: {
        where: canManageFieldMasterData(actor)
          ? {}
          : { requestedByAgentId: actor.agentId ?? "__no_agent__" },
        orderBy: { submittedAt: "desc" },
        take: 20,
        include: { requestedByAgent: { select: { id: true, name: true } } },
      },
    },
  })
  if (!contact) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const activeDictionaryRows = await prisma.mtmContactDictionary.findMany({
    where: {
      organizationId: auth.orgId,
      kind: { in: [...CONTACT_MASTER_DICTIONARY_KINDS] },
      status: "ACTIVE",
      effectiveFrom: { lte: asOf },
    },
    orderBy: [{ kind: "asc" }, { version: "desc" }],
  })
  const availableContactDictionaries = activeDictionaryRows.flatMap((dictionary) => {
    const entries = verifiedContactDictionaryEntries(dictionary, { requireActive: true })
    return entries ? [{ ...dictionary, entries }] : []
  })
  const dictionaryAssignments = contact.dictionaryAssignments.map((assignment) => {
    const entries = verifiedContactDictionaryEntries(assignment.dictionary)
    const entry = entries?.find((candidate) => candidate.code === assignment.entryCode) ?? null
    const issue = assignment.dictionary.kind !== assignment.kind
      ? "KIND_MISMATCH"
      : !entries
        ? "DICTIONARY_SIGNATURE_INVALID"
        : !entry
          ? "ENTRY_NOT_IN_DICTIONARY"
          : null
    return {
      id: assignment.id,
      dictionaryId: assignment.dictionaryId,
      kind: assignment.kind,
      entryCode: assignment.entryCode,
      effectiveFrom: assignment.effectiveFrom,
      effectiveTo: assignment.effectiveTo,
      source: assignment.source,
      requestedByAgentId: assignment.requestedByAgentId,
      approvedByUserId: assignment.approvedByUserId,
      sourceRequestId: assignment.sourceRequestId,
      createdAt: assignment.createdAt,
      updatedAt: assignment.updatedAt,
      valid: issue === null,
      issue,
      entry,
      dictionary: {
        id: assignment.dictionary.id,
        kind: assignment.dictionary.kind,
        version: assignment.dictionary.version,
        nameRu: assignment.dictionary.nameRu,
        nameAz: assignment.dictionary.nameAz,
        nameEn: assignment.dictionary.nameEn,
        approvalReference: assignment.dictionary.approvalReference,
        signedAt: assignment.dictionary.signedAt,
        retiredAt: assignment.dictionary.retiredAt,
        status: assignment.dictionary.status,
      },
    }
  })
  const currentDictionaryAssignments = contact.dictionaryAssignments.filter((assignment) => assignment.effectiveTo === null)
  const dictionaryAssignmentStateHash = contactDictionaryAssignmentStateHash(currentDictionaryAssignments)

  const duplicateTargetIds = [...new Set(contact.changeRequests
    .filter((request) => request.kind === "DUPLICATE_REPORT")
    .map((request) => duplicateTargetId(request.payload))
    .filter((targetId): targetId is string => Boolean(targetId)))]
  const duplicateTargets = duplicateTargetIds.length > 0
    ? await prisma.mtmContact.findMany({
        where: {
          id: { in: duplicateTargetIds },
          organizationId: auth.orgId,
          deletedAt: null,
          status: { notIn: ["DUPLICATE", "MERGED"] },
          ...(actor.role === "ADMIN" ? {} : { AND: [contactScopeForActor(actor, asOf)] }),
        },
        select: { id: true, displayName: true, status: true, externalCode: true },
      })
    : []
  const duplicateTargetById = new Map(duplicateTargets.map((target) => [target.id, target]))
  const contactWithDuplicateTargets = {
    ...contact,
    dictionaryAssignments,
    changeRequests: contact.changeRequests.map((request) => {
      const targetId = request.kind === "DUPLICATE_REPORT" ? duplicateTargetId(request.payload) : null
      return { ...request, duplicateTarget: targetId ? duplicateTargetById.get(targetId) ?? null : null }
    }),
  }

  const history = await prisma.mtmAuditLog.findMany({
    where: {
      organizationId: auth.orgId,
      OR: [
        { entity: "contact", entityId: id },
        { entity: "contact_change_request", newData: { path: ["contactId"], equals: id } },
        { entity: "doctor_assessment", newData: { path: ["contactId"], equals: id } },
        { entity: "field_potential", newData: { path: ["contactId"], equals: id } },
        { entity: "contact_dictionary_assignment", entityId: id },
        { entity: "contact_workplace", entityId: { in: contact.workplaces.map((workplace: { id: string }) => workplace.id) } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      action: true,
      entity: true,
      entityId: true,
      metadataKind: true,
      oldData: true,
      newData: true,
      createdAt: true,
      agent: { select: { id: true, name: true } },
    },
  })

  const activeAssignments = contact.agentAssignments.filter((assignment: { effectiveFrom: Date; effectiveTo: Date | null }) => {
    return assignment.effectiveFrom <= asOf && (!assignment.effectiveTo || assignment.effectiveTo > asOf)
  })
  const scopedPotentialAgentIds = actor.role === "ADMIN" || actor.scopedAgentIds === null
    ? null
    : actor.role === "AGENT"
      ? (actor.agentId ? [actor.agentId] : [])
      : [...actor.scopedAgentIds]
  const [eligibleBrandPotentialVisits, brandPotentialAgents] = await Promise.all([
    prisma.mtmVisit.findMany({
      where: {
        organizationId: auth.orgId,
        contactId: id,
        deletedAt: null,
        status: "CHECKED_OUT",
        ...(scopedPotentialAgentIds === null ? {} : { agentId: { in: scopedPotentialAgentIds } }),
      },
      orderBy: { checkInAt: "desc" },
      take: 25,
      select: { id: true, checkInAt: true, checkOutAt: true, status: true, agentId: true, customer: { select: { id: true, name: true } } },
    }),
    settings.brandPotentialPerAgentEnabled
      ? prisma.mtmAgent.findMany({
        where: {
          organizationId: auth.orgId,
          status: "ACTIVE",
          ...(scopedPotentialAgentIds === null ? {} : { id: { in: scopedPotentialAgentIds } }),
        },
        orderBy: { name: "asc" },
        take: 200,
        select: { id: true, name: true, role: true },
      })
      : Promise.resolve([]),
  ])
  return NextResponse.json({
    success: true,
    data: {
      contact: contactWithDuplicateTargets,
      history,
      activeAssignments,
      eligibleBrandPotentialVisits,
      brandPotentialAgents,
      availableContactDictionaries,
      dictionaryAssignmentStateHash,
      contactPolicy: {
        requiredFields: coerceMtmContactRequiredFields(settings.contactRequiredFields),
      },
      asOf: asOf.toISOString().slice(0, 10),
      timezone,
      capabilities: {
        actorAgentId: actor.agentId,
        actorRole: actor.role,
        canManage: canManageFieldMasterData(actor),
        canRequestChanges: actor.role === "AGENT" && actor.agentId !== null,
        canRecordBrandPotential: actor.agentId !== null || actor.role === "ADMIN",
        canReviewBrandPotential: canManageFieldMasterData(actor),
        brandPotentialPerAgent: settings.brandPotentialPerAgentEnabled,
      },
    },
  })
})

export const PUT = withRouteFieldRlsAuth("write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { actor, settings, asOf } = await context(auth)
  if (!actor || !canManageFieldMasterData(actor)) {
    return NextResponse.json({ error: "Agents must request contact changes", code: "MTM_CONTACT_APPROVAL_REQUIRED" }, { status: 403 })
  }

  const parsed = parseBody(ContactDirectUpdateSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const before = await prisma.mtmContact.findFirst({
    where: {
      id,
      organizationId: auth.orgId,
      deletedAt: null,
      ...(actor.role === "ADMIN" ? {} : { AND: [contactScopeForActor(actor, asOf)] }),
    },
  })
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (body.expectedContactUpdatedAt && before.updatedAt.toISOString() !== body.expectedContactUpdatedAt) {
    return NextResponse.json({
      error: "Contact changed since the form was opened",
      code: "MTM_CONTACT_CONFLICT",
      data: { updatedAt: before.updatedAt },
    }, { status: 409 })
  }

  const missingRequiredFields = missingMtmContactRequiredFields(
    mergedMtmContactState(before as unknown as Record<string, unknown>, body),
    settings.contactRequiredFields,
  )
  if (missingRequiredFields.length > 0) {
    return NextResponse.json({
      error: "Required contact fields are missing",
      code: "MTM_CONTACT_REQUIRED_FIELDS",
      data: { fields: missingRequiredFields },
    }, { status: 422 })
  }

  if (body.duplicateOfContactId) {
    if (body.duplicateOfContactId === id) {
      return NextResponse.json({ error: "A contact cannot duplicate itself", code: "MTM_CONTACT_DUPLICATE_SELF" }, { status: 400 })
    }
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
  const data: Prisma.MtmContactUpdateManyMutationInput = buildContactUpdateData(body, before, auth.userId || null)

  try {
    const changed = await prisma.mtmContact.updateMany({
      where: { id, organizationId: auth.orgId, deletedAt: null, updatedAt: before.updatedAt },
      data,
    })
    if (changed.count !== 1) {
      return NextResponse.json({ error: "Contact changed concurrently", code: "MTM_CONTACT_CONFLICT" }, { status: 409 })
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A contact with this external code already exists", code: "MTM_CONTACT_DUPLICATE" }, { status: 409 })
    }
    throw error
  }

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: "CONTACT_UPDATE",
    entity: "contact",
    entityId: id,
    metadataKind: "contact_update",
    oldData: before,
    newData: data,
    req,
  }).catch((error) => console.warn("[MTM/contacts/[id] PUT] audit failed", error))

  return NextResponse.json({ success: true, data: { updatedAt: new Date().toISOString() } })
})

export const DELETE = withRouteFieldRlsAuth("write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { actor, asOf } = await context(auth)
  if (!actor || !canManageFieldMasterData(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const before = await prisma.mtmContact.findFirst({
    where: {
      id,
      organizationId: auth.orgId,
      deletedAt: null,
      ...(actor.role === "ADMIN" ? {} : { AND: [contactScopeForActor(actor, asOf)] }),
    },
  })
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const deletedAt = new Date()
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const changed = await tx.mtmContact.updateMany({
      where: { id, organizationId: auth.orgId, deletedAt: null, updatedAt: before.updatedAt },
      data: { deletedAt },
    })
    if (changed.count !== 1) throw new Error("Contact changed concurrently")
    await tx.mtmContactAgentAssignment.updateMany({
      where: { organizationId: auth.orgId, contactId: id, deletedAt: null, effectiveTo: null },
      data: { effectiveTo: asOf },
    })
    await tx.mtmContactWorkplace.updateMany({
      where: { organizationId: auth.orgId, contactId: id, deletedAt: null, endedOn: null },
      data: { endedOn: asOf, isPrimary: false, updatedBy: auth.userId || null },
    })
  })

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: "CONTACT_DELETE",
    entity: "contact",
    entityId: id,
    metadataKind: "contact_delete",
    oldData: before,
    newData: { deletedAt },
    req,
  }).catch((error) => console.warn("[MTM/contacts/[id] DELETE] audit failed", error))

  return NextResponse.json({ success: true })
})
