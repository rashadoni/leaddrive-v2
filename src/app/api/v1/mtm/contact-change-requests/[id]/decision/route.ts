import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { canManageFieldMasterData, contactScopeForActor, customerScopeForActor } from "@/lib/mtm/field-scope"
import {
  ContactChangeDecisionSchema,
  ContactDictionaryAssignmentSetSchema,
  ContactUpdateSchema,
  ContactWorkplaceUpsertSchema,
  parseBody,
} from "@/lib/mtm-validators"
import { buildContactUpdateData, utcDate } from "@/lib/mtm/contact-master-data"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { mergedMtmContactState, missingMtmContactRequiredFields } from "@/lib/mtm/contact-required-fields"
import {
  applyContactDictionaryAssignmentSet,
  ContactDictionaryAssignmentConflict,
} from "@/lib/mtm/contact-dictionary-assignment"

type RouteContext = { params: Promise<{ id: string }> }

class ContactChangeConflict extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) {
    super(message)
  }
}

export const POST = withRouteFieldRlsAuth<RouteContext>("write", async (req, auth, { params }) => {
  const { id } = await params
  const [actor, settings] = await Promise.all([
    resolveMtmRouteActor(prisma, {
      organizationId: auth.orgId,
      userId: auth.userId,
      webRole: auth.role,
      agentId: auth.agentId,
    }),
    getMtmSettings(auth.orgId),
  ])
  if (!actor || !canManageFieldMasterData(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const asOf = new Date(`${currentDateKey(new Date(), timezone)}T00:00:00.000Z`)

  const parsed = parseBody(ContactChangeDecisionSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const changeRequest = await prisma.mtmContactChangeRequest.findFirst({
    where: {
      id,
      organizationId: auth.orgId,
      contact: actor.role === "ADMIN" ? {} : contactScopeForActor(actor, asOf),
    },
    include: { contact: true, requestedByAgent: { select: { id: true, name: true } } },
  })
  if (!changeRequest) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (actor.agentId === changeRequest.requestedByAgentId) {
    return NextResponse.json({ error: "A requester cannot review their own change", code: "MTM_SELF_REVIEW_DENIED" }, { status: 403 })
  }

  if (["APPROVED", "REJECTED", "CANCELLED"].includes(changeRequest.status)) {
    if (changeRequest.status === body.decision) {
      return NextResponse.json({ success: true, data: changeRequest, idempotent: true })
    }
    return NextResponse.json({ error: "Request already decided", code: "MTM_CONTACT_REQUEST_DECIDED" }, { status: 409 })
  }

  const now = new Date()
  let result: Record<string, unknown> = {}
  try {
    result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const current = await tx.mtmContact.findFirst({
        where: { id: changeRequest.contactId, organizationId: auth.orgId, deletedAt: null },
      })
      if (!current) throw new ContactChangeConflict("MTM_CONTACT_NOT_FOUND", "Contact no longer exists")

      if (body.decision === "APPROVED" && current.updatedAt.getTime() !== changeRequest.expectedContactUpdatedAt.getTime()) {
        throw new ContactChangeConflict("MTM_CONTACT_CONFLICT", "Contact changed after the request was submitted")
      }

      const claimed = await tx.mtmContactChangeRequest.updateMany({
        where: { id, organizationId: auth.orgId, status: { in: ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] } },
        data: { status: "IN_REVIEW", reviewedBy: auth.userId || null, decisionComment: body.comment },
      })
      if (claimed.count !== 1) throw new ContactChangeConflict("MTM_CONTACT_REQUEST_CONFLICT", "Request changed concurrently")

      let applied: Record<string, unknown> = {}
      if (body.decision === "APPROVED") {
        if (changeRequest.kind === "CONTACT_UPDATE") {
          const payload = ContactUpdateSchema.parse(changeRequest.payload)
          const missingRequiredFields = missingMtmContactRequiredFields(
            mergedMtmContactState(current as unknown as Record<string, unknown>, payload),
            settings.contactRequiredFields,
          )
          if (missingRequiredFields.length > 0) {
            throw new ContactChangeConflict(
              "MTM_CONTACT_REQUIRED_FIELDS",
              JSON.stringify(missingRequiredFields),
              422,
            )
          }
          if (payload.duplicateOfContactId) {
            const duplicate = payload.duplicateOfContactId === current.id ? null : await tx.mtmContact.findFirst({
              where: { id: payload.duplicateOfContactId, organizationId: auth.orgId, deletedAt: null },
              select: { id: true },
            })
            if (!duplicate) throw new ContactChangeConflict("MTM_CONTACT_DUPLICATE_TARGET_INVALID", "Duplicate target is invalid")
          }
          const data = buildContactUpdateData(payload, current, auth.userId || null, now)
          const changed = await tx.mtmContact.updateMany({
            where: { id: current.id, organizationId: auth.orgId, deletedAt: null, updatedAt: current.updatedAt },
            data,
          })
          if (changed.count !== 1) throw new ContactChangeConflict("MTM_CONTACT_CONFLICT", "Contact changed concurrently")
          applied = { contactId: current.id, fields: Object.keys(data) }
        } else if (changeRequest.kind === "WORKPLACE_UPSERT") {
          const payload = ContactWorkplaceUpsertSchema.parse(changeRequest.payload)
          const [customer, existing] = await Promise.all([
            tx.mtmCustomer.findFirst({
              where: {
                id: payload.customerId,
                organizationId: auth.orgId,
                deletedAt: null,
                objectType: { not: "DOCTOR" },
                ...(actor.role === "ADMIN" ? {} : { AND: [customerScopeForActor(actor, asOf)] }),
              },
              select: { id: true },
            }),
            payload.id
              ? tx.mtmContactWorkplace.findFirst({ where: { id: payload.id, contactId: current.id, organizationId: auth.orgId, deletedAt: null } })
              : Promise.resolve(null),
          ])
          if (!customer || (payload.id && !existing)) throw new ContactChangeConflict("MTM_WORKPLACE_REFERENCE_INVALID", "Workplace reference is invalid")
          if (existing && payload.expectedUpdatedAt && existing.updatedAt.toISOString() !== payload.expectedUpdatedAt) {
            throw new ContactChangeConflict("MTM_WORKPLACE_CONFLICT", "Workplace changed after the request was submitted")
          }
          const data = {
            customerId: customer.id,
            jobTitle: payload.jobTitle ?? null,
            department: payload.department ?? null,
            room: payload.room ?? null,
            phone: payload.phone ?? null,
            isPrimary: payload.isPrimary ?? existing?.isPrimary ?? false,
            startedOn: payload.startedOn ? utcDate(payload.startedOn) : null,
            endedOn: payload.endedOn ? utcDate(payload.endedOn) : null,
            updatedBy: auth.userId || null,
          }
          if (data.isPrimary && data.endedOn === null) {
            await tx.mtmContactWorkplace.updateMany({
              where: {
                organizationId: auth.orgId,
                contactId: current.id,
                deletedAt: null,
                endedOn: null,
                isPrimary: true,
                ...(existing ? { id: { not: existing.id } } : {}),
              },
              data: { isPrimary: false, updatedBy: auth.userId || null },
            })
          }
          const workplace = existing
            ? await tx.mtmContactWorkplace.update({ where: { id: existing.id }, data })
            : await tx.mtmContactWorkplace.create({
                data: {
                  organizationId: auth.orgId,
                  contactId: current.id,
                  ...data,
                  source: "AGENT_REQUEST",
                  createdBy: changeRequest.requestedByAgentId,
                },
              })
          applied = { contactId: current.id, workplaceId: workplace.id }
        } else if (changeRequest.kind === "WORKPLACE_END") {
          const payload = changeRequest.payload as { workplaceId?: unknown; endedOn?: unknown; expectedWorkplaceUpdatedAt?: unknown }
          if (typeof payload.workplaceId !== "string" || typeof payload.endedOn !== "string") {
            throw new ContactChangeConflict("MTM_CONTACT_REQUEST_INVALID", "Stored workplace payload is invalid")
          }
          const changed = await tx.mtmContactWorkplace.updateMany({
            where: { id: payload.workplaceId, contactId: current.id, organizationId: auth.orgId, deletedAt: null, ...(typeof payload.expectedWorkplaceUpdatedAt === "string" ? { updatedAt: new Date(payload.expectedWorkplaceUpdatedAt) } : {}) },
            data: { endedOn: utcDate(payload.endedOn), isPrimary: false, updatedBy: auth.userId || null },
          })
          if (changed.count !== 1) throw new ContactChangeConflict("MTM_WORKPLACE_CONFLICT", "Workplace changed concurrently")
          applied = { contactId: current.id, workplaceId: payload.workplaceId, endedOn: payload.endedOn }
        } else if (changeRequest.kind === "DICTIONARY_ASSIGNMENTS") {
          const payload = ContactDictionaryAssignmentSetSchema.parse(changeRequest.payload)
          const dictionaryResult = await applyContactDictionaryAssignmentSet(tx, {
            organizationId: auth.orgId,
            contactId: current.id,
            input: payload,
            source: "AGENT_REQUEST",
            createdByUserId: auth.userId || null,
            requestedByAgentId: changeRequest.requestedByAgentId,
            approvedByUserId: auth.userId || null,
            sourceRequestId: changeRequest.id,
            now,
          })
          applied = { contactId: current.id, ...dictionaryResult }
        } else {
          const payload = changeRequest.payload as { targetContactId?: unknown }
          if (typeof payload.targetContactId !== "string" || payload.targetContactId === current.id) {
            throw new ContactChangeConflict("MTM_CONTACT_DUPLICATE_TARGET_INVALID", "Duplicate target is invalid")
          }
          const target = await tx.mtmContact.findFirst({
            where: {
              id: payload.targetContactId,
              organizationId: auth.orgId,
              deletedAt: null,
              status: { notIn: ["DUPLICATE", "MERGED"] },
              ...(actor.role === "ADMIN" ? {} : { AND: [contactScopeForActor(actor, asOf)] }),
            },
            select: { id: true },
          })
          if (!target) throw new ContactChangeConflict("MTM_CONTACT_DUPLICATE_TARGET_INVALID", "Duplicate target is invalid")
          const changed = await tx.mtmContact.updateMany({
            where: { id: current.id, organizationId: auth.orgId, deletedAt: null, updatedAt: current.updatedAt },
            data: { status: "DUPLICATE", duplicateOfContactId: target.id },
          })
          if (changed.count !== 1) throw new ContactChangeConflict("MTM_CONTACT_CONFLICT", "Contact changed concurrently")
          applied = { contactId: current.id, duplicateOfContactId: target.id }
        }
      }

      const terminal = await tx.mtmContactChangeRequest.update({
        where: { id },
        data: {
          status: body.decision,
          reviewedBy: auth.userId || null,
          decisionComment: body.comment,
          reviewedAt: now,
          result: applied as Prisma.InputJsonValue,
        },
      })
      await tx.mtmNotification.create({
        data: {
          organizationId: auth.orgId,
          agentId: changeRequest.requestedByAgentId,
          title: body.decision === "APPROVED" ? "Contact change approved" : body.decision === "REJECTED" ? "Contact change rejected" : "Contact change needs information",
          body: body.comment,
          type: body.decision === "APPROVED" ? "info" : "task",
          metadata: { contactChangeRequestId: id, contactId: changeRequest.contactId, decision: body.decision },
        },
      })
      return { requestId: terminal.id, contactId: changeRequest.contactId, status: terminal.status, ...applied }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    if (error instanceof ContactDictionaryAssignmentConflict) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    if (error instanceof ContactChangeConflict) {
      if (error.code === "MTM_CONTACT_REQUIRED_FIELDS") {
        return NextResponse.json({
          error: "Required contact fields are missing",
          code: error.code,
          data: { fields: JSON.parse(error.message) },
        }, { status: error.status })
      }
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "The requested master-data value conflicts with an existing record", code: "MTM_CONTACT_DUPLICATE" }, { status: 409 })
    }
    throw error
  }

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: "CONTACT_CHANGE_REQUEST_DECISION",
    entity: "contact_change_request",
    entityId: id,
    metadataKind: "contact_change_decision",
    oldData: { status: changeRequest.status },
    newData: { contactId: changeRequest.contactId, decision: body.decision, result },
    req,
  }).catch((error) => console.warn("[MTM/contact change decision] audit failed", error))

  return NextResponse.json({ success: true, data: result })
})
