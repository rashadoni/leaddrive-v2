import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { NextResponse, type NextRequest } from "next/server"
import type { z } from "zod"
import { prisma } from "@/lib/prisma"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"
import { contactScopeForActor, customerScopeForActor } from "@/lib/mtm/field-scope"
import type { ContactChangeRequestSchema } from "@/lib/mtm-validators"
import type { MtmSettingsShape } from "@/lib/mtm-settings"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { mergedMtmContactState, missingMtmContactRequiredFields } from "@/lib/mtm/contact-required-fields"
import {
  ContactDictionaryAssignmentConflict,
  readContactDictionaryAssignmentState,
  validateContactDictionaryAssignmentSet,
} from "@/lib/mtm/contact-dictionary-assignment"

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

/**
 * Store an agent's change request on a client — the one implementation behind
 * both doors: the website (`/api/v1/mtm/contacts/:id/change-requests`) and the
 * field app (`/api/v2/mtm/mobile/route-field/contacts/:id/change-requests`).
 *
 * The caller has already established WHO asks (an agent, acting as their own
 * card) and that the organization allows the request; everything about the
 * request itself is decided here, so the two doors cannot drift apart:
 * idempotent replay, the client being in the agent's scope and unchanged since
 * the form opened, the tenant's required fields, the references of each kind,
 * the notification to the manager and the audit entry.
 */
export async function submitMtmContactChangeRequest(input: {
  req: NextRequest
  auth: { orgId: string }
  actor: MtmRouteActor & { agentId: string }
  settings: Pick<MtmSettingsShape, "contactRequiredFields" | "contactHiddenFields">
  asOf: Date
  contactId: string
  body: z.infer<typeof ContactChangeRequestSchema>
}): Promise<NextResponse> {
  const { req, auth, actor, settings, asOf, contactId, body } = input
  const hash = requestHash({ contactId, ...body })

  const replay = await prisma.mtmContactChangeRequest.findUnique({
    where: { organizationId_idempotencyKey: { organizationId: auth.orgId, idempotencyKey: body.idempotencyKey } },
  })
  if (replay) {
    if (replay.requestHash !== hash) {
      return NextResponse.json({ error: "Idempotency key already used for another request", code: "MTM_IDEMPOTENCY_CONFLICT" }, { status: 409 })
    }
    return NextResponse.json({ success: true, data: replay, idempotent: true })
  }

  const contact = await prisma.mtmContact.findFirst({
    where: {
      id: contactId,
      organizationId: auth.orgId,
      deletedAt: null,
      AND: [contactScopeForActor(actor, asOf)],
    },
  })
  if (!contact) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (contact.updatedAt.toISOString() !== body.expectedContactUpdatedAt) {
    return NextResponse.json({ error: "Contact changed since the form was opened", code: "MTM_CONTACT_CONFLICT", data: { updatedAt: contact.updatedAt } }, { status: 409 })
  }

  if (body.kind === "CONTACT_UPDATE") {
    const missingRequiredFields = missingMtmContactRequiredFields(
      mergedMtmContactState(contact as unknown as Record<string, unknown>, body.payload),
      settings.contactRequiredFields,
      settings.contactHiddenFields,
    )
    if (missingRequiredFields.length > 0) {
      return NextResponse.json({
        error: "Required contact fields are missing",
        code: "MTM_CONTACT_REQUIRED_FIELDS",
        data: { fields: missingRequiredFields },
      }, { status: 422 })
    }
  }

  if (body.kind === "WORKPLACE_UPSERT") {
    const [customer, workplace] = await Promise.all([
      prisma.mtmCustomer.findFirst({
        where: {
          id: body.payload.customerId,
          organizationId: auth.orgId,
          deletedAt: null,
          objectType: { not: "DOCTOR" },
          AND: [customerScopeForActor(actor, asOf)],
        },
        select: { id: true },
      }),
      body.payload.id
        ? prisma.mtmContactWorkplace.findFirst({ where: { id: body.payload.id, contactId, organizationId: auth.orgId, deletedAt: null }, select: { id: true } })
        : Promise.resolve(null),
    ])
    if (!customer || (body.payload.id && !workplace)) {
      return NextResponse.json({ error: "Workplace reference is outside the Agent scope", code: "MTM_WORKPLACE_REFERENCE_INVALID" }, { status: 400 })
    }
  } else if (body.kind === "WORKPLACE_END") {
    const workplace = await prisma.mtmContactWorkplace.findFirst({
      where: { id: body.payload.workplaceId, contactId, organizationId: auth.orgId, deletedAt: null },
      select: { id: true },
    })
    if (!workplace) return NextResponse.json({ error: "Workplace not found", code: "MTM_WORKPLACE_REFERENCE_INVALID" }, { status: 400 })
  } else if (body.kind === "DUPLICATE_REPORT") {
    const duplicate = body.payload.targetContactId === contactId ? null : await prisma.mtmContact.findFirst({
      where: {
        id: body.payload.targetContactId,
        organizationId: auth.orgId,
        deletedAt: null,
        status: { notIn: ["DUPLICATE", "MERGED"] },
        AND: [contactScopeForActor(actor, asOf)],
      },
      select: { id: true },
    })
    if (!duplicate) return NextResponse.json({ error: "Duplicate target not found", code: "MTM_CONTACT_DUPLICATE_TARGET_INVALID" }, { status: 400 })
  } else if (body.kind === "DICTIONARY_ASSIGNMENTS") {
    if (body.payload.reason !== body.reason) {
      return NextResponse.json({
        error: "Category assignment reason must match the review request reason",
        code: "MTM_CONTACT_DICTIONARY_REASON_MISMATCH",
      }, { status: 400 })
    }
    try {
      const current = await readContactDictionaryAssignmentState(prisma, auth.orgId, contactId)
      if (current.hash !== body.payload.expectedStateHash) {
        return NextResponse.json({
          error: "Contact categories changed since the form was opened",
          code: "MTM_CONTACT_DICTIONARY_ASSIGNMENT_CONFLICT",
        }, { status: 409 })
      }
      await validateContactDictionaryAssignmentSet(prisma, auth.orgId, body.payload)
    } catch (error) {
      if (error instanceof ContactDictionaryAssignmentConflict) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
      }
      throw error
    }
  }

  const requester = await prisma.mtmAgent.findFirst({
    where: { id: actor.agentId, organizationId: auth.orgId, status: "ACTIVE" },
    select: { id: true, name: true, managerId: true },
  })
  if (!requester) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  let created
  try {
    created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const changeRequest = await tx.mtmContactChangeRequest.create({
        data: {
          organizationId: auth.orgId,
          contactId,
          requestedByAgentId: requester.id,
          kind: body.kind,
          idempotencyKey: body.idempotencyKey,
          requestHash: hash,
          reason: body.reason,
          expectedContactUpdatedAt: new Date(body.expectedContactUpdatedAt),
          payload: body.payload as Prisma.InputJsonValue,
        },
        include: { requestedByAgent: { select: { id: true, name: true } } },
      })
      if (requester.managerId) {
        await tx.mtmNotification.create({
          data: {
            organizationId: auth.orgId,
            agentId: requester.managerId,
            title: "Contact change needs review",
            body: `${requester.name} requested a change to ${contact.displayName}.`,
            type: "task",
            metadata: { contactChangeRequestId: changeRequest.id, contactId },
          },
        })
      }
      return changeRequest
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const concurrent = await prisma.mtmContactChangeRequest.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: auth.orgId, idempotencyKey: body.idempotencyKey } },
      })
      if (concurrent?.requestHash === hash) return NextResponse.json({ success: true, data: concurrent, idempotent: true })
      return NextResponse.json({ error: "Idempotency key conflict", code: "MTM_IDEMPOTENCY_CONFLICT" }, { status: 409 })
    }
    throw error
  }

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: requester.id,
    action: "CONTACT_CHANGE_REQUEST_SUBMIT",
    entity: "contact_change_request",
    entityId: created.id,
    metadataKind: "contact_change_request",
    newData: { contactId, kind: body.kind, status: "SUBMITTED", reason: body.reason },
    req,
  }).catch((error) => console.warn("[MTM/contact change request POST] audit failed", error))

  return NextResponse.json({ success: true, data: created }, { status: 201 })
}
