import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { canManageFieldMasterData, contactScopeForActor } from "@/lib/mtm/field-scope"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { ContactDictionaryAssignmentDirectSchema, parseBody } from "@/lib/mtm-validators"
import {
  applyContactDictionaryAssignmentSet,
  ContactDictionaryAssignmentConflict,
  readContactDictionaryAssignmentState,
} from "@/lib/mtm/contact-dictionary-assignment"
import { writeMtmAudit } from "@/lib/mtm-audit"

type RouteContext = { params: Promise<{ id: string }> }

export const PUT = withRouteFieldRlsAuth<RouteContext>("write", async (req, auth, { params }) => {
  const { id: contactId } = await params
  const [actor, settings] = await Promise.all([
    resolveMtmRouteActor(prisma, {
      organizationId: auth.orgId,
      userId: auth.userId,
      webRole: auth.role,
      agentId: auth.agentId,
    }),
    getMtmSettings(auth.orgId),
  ])
  if (!actor || !canManageFieldMasterData(actor)) {
    return NextResponse.json({
      error: "Agents must request contact category changes",
      code: "MTM_CONTACT_APPROVAL_REQUIRED",
    }, { status: 403 })
  }

  const parsed = parseBody(ContactDictionaryAssignmentDirectSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const asOf = new Date(`${currentDateKey(new Date(), timezone)}T00:00:00.000Z`)
  const contact = await prisma.mtmContact.findFirst({
    where: {
      id: contactId,
      organizationId: auth.orgId,
      deletedAt: null,
      ...(actor.role === "ADMIN" ? {} : { AND: [contactScopeForActor(actor, asOf)] }),
    },
    select: { id: true, updatedAt: true },
  })
  if (!contact) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (body.expectedContactUpdatedAt && contact.updatedAt.toISOString() !== body.expectedContactUpdatedAt) {
    return NextResponse.json({
      error: "Contact changed since the form was opened",
      code: "MTM_CONTACT_CONFLICT",
      data: { updatedAt: contact.updatedAt },
    }, { status: 409 })
  }

  const before = await readContactDictionaryAssignmentState(prisma, auth.orgId, contactId)
  try {
    const result = await prisma.$transaction((tx: Prisma.TransactionClient) => (
      applyContactDictionaryAssignmentSet(tx, {
        organizationId: auth.orgId,
        contactId,
        input: body,
        source: actor.role === "ADMIN" ? "ADMIN" : "MANAGER",
        createdByUserId: auth.userId || null,
        approvedByUserId: auth.userId || null,
      })
    ), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: actor.agentId,
      action: "CONTACT_DICTIONARY_ASSIGNMENTS_UPDATE",
      entity: "contact_dictionary_assignment",
      entityId: contactId,
      metadataKind: "contact_dictionary_assignments",
      oldData: { stateHash: before.hash, assignments: before.rows },
      newData: { ...result, reason: body.reason },
      req,
    }).catch((error) => console.warn("[MTM/contact dictionary assignments PUT] audit failed", error))

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    if (error instanceof ContactDictionaryAssignmentConflict) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    throw error
  }
})
