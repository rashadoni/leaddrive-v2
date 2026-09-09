import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { VisitUpdateSchema, parseBody } from "@/lib/mtm-validators"
import { completeMtmVisit } from "@/lib/mtm/visit-requirements"
import { validateMtmRouteTargets } from "@/lib/mtm/route-targets"
import { notifyMtmAgentOfVisitChange } from "@/lib/mtm/notify-visit-change"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import {
  canMutateMtmVisit,
  canViewMtmVisitAtCheckIn,
  historicalVisitCandidateWhere,
  mutableVisitWhere,
} from "@/lib/mtm/visit-scope"
import { contactScopeForActor, customerScopeForActor } from "@/lib/mtm/field-scope"

export const GET = withRouteFieldRlsAuth("read", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) {
    return NextResponse.json({ error: "MTM agent access required", code: "MTM_AGENT_ACCESS_REQUIRED" }, { status: 403 })
  }

  try {
    const visit = await prisma.mtmVisit.findFirst({
      where: historicalVisitCandidateWhere(actor, auth.orgId, { id }),
      include: {
        agent: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
        contact: { select: { id: true, displayName: true, type: true, specialtyName: true } },
        participants: {
          select: { agentId: true, role: true, joinedAt: true, leftAt: true },
        },
      },
    })
    if (!visit || !canViewMtmVisitAtCheckIn(actor, visit)) {
      return NextResponse.json({ error: "Not found", code: "MTM_VISIT_NOT_FOUND" }, { status: 404 })
    }
    const { participants: _authorizationEvidence, ...publicVisit } = visit
    const primaryAgentVisible = isAgentInRouteScope(actor, visit.agentId)
    return NextResponse.json({
      success: true,
      data: {
        ...publicVisit,
        agentId: primaryAgentVisible ? visit.agentId : null,
        agent: primaryAgentVisible ? visit.agent : null,
        primaryAgentHidden: !primaryAgentVisible,
        canMutate: canMutateMtmVisit(actor, visit.agentId),
      },
    })
  } catch (e) {
    console.error("[MTM/visits/[id] GET]", e)
    return NextResponse.json({ error: "Failed to fetch visit" }, { status: 500 })
  }
})

export const PUT = withRouteFieldRlsAuth("write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) {
    return NextResponse.json({ error: "MTM agent access required", code: "MTM_AGENT_ACCESS_REQUIRED" }, { status: 403 })
  }

  try {
    const raw = await req.json()
    const parsed = parseBody(VisitUpdateSchema, raw)
    if (!parsed.ok) return parsed.response
    const body = parsed.data
    const current = await prisma.mtmVisit.findFirst({
      where: mutableVisitWhere(actor, auth.orgId, { id }),
      select: { agentId: true, customerId: true, contactId: true, checkInAt: true, status: true },
    })
    if (!current) {
      return NextResponse.json({ error: "Not found", code: "MTM_VISIT_NOT_FOUND" }, { status: 404 })
    }

    if (body.agentId !== undefined) {
      if (!canMutateMtmVisit(actor, body.agentId)) {
        return NextResponse.json({ error: "Not found", code: "MTM_VISIT_AGENT_NOT_FOUND" }, { status: 404 })
      }
      const targetAgent = await prisma.mtmAgent.findFirst({
        where: { id: body.agentId, organizationId: auth.orgId, status: "ACTIVE" },
        select: { id: true },
      })
      if (!targetAgent) {
        return NextResponse.json({ error: "Visit agent is invalid", code: "MTM_VISIT_REFERENCE_INVALID" }, { status: 400 })
      }
    }

    if (body.customerId !== undefined || body.contactId !== undefined) {
      const customerId = body.customerId ?? current.customerId
      const contactId = body.contactId !== undefined ? body.contactId : current.contactId
      const scopeAt = new Date()
      const scopedCustomer = await prisma.mtmCustomer.findFirst({
        where: {
          id: customerId,
          organizationId: auth.orgId,
          deletedAt: null,
          AND: [customerScopeForActor(actor, scopeAt)],
        },
        select: { id: true },
      })
      if (!scopedCustomer) {
        return NextResponse.json({ error: "Not found", code: "MTM_VISIT_CUSTOMER_NOT_FOUND" }, { status: 404 })
      }
      if (contactId) {
        const scopedContact = await prisma.mtmContact.findFirst({
          where: {
            id: contactId,
            organizationId: auth.orgId,
            deletedAt: null,
            status: { not: "INACTIVE" },
            AND: [
              contactScopeForActor(actor, scopeAt),
              {
                workplaces: {
                  some: {
                    organizationId: auth.orgId,
                    customerId,
                    deletedAt: null,
                    AND: [
                      { OR: [{ startedOn: null }, { startedOn: { lte: scopeAt } }] },
                      { OR: [{ endedOn: null }, { endedOn: { gt: scopeAt } }] },
                    ],
                  },
                },
              },
            ],
          },
          select: { id: true },
        })
        if (!scopedContact) {
          return NextResponse.json({ error: "Not found", code: "MTM_VISIT_CONTACT_NOT_FOUND" }, { status: 404 })
        }
      }
      const targetValidation = await validateMtmRouteTargets(prisma, {
        organizationId: auth.orgId,
        routeDate: current.checkInAt,
        points: [{
          customerId,
          contactId,
        }],
      })
      if (!targetValidation.ok) {
        return NextResponse.json({ error: "Visit target is invalid", code: "MTM_ROUTE_REFERENCE_INVALID", details: targetValidation }, { status: 400 })
      }
    }
    const data: Prisma.MtmVisitUncheckedUpdateManyInput = {}
    if (body.agentId) data.agentId = body.agentId
    if (body.customerId) data.customerId = body.customerId
    if (body.contactId !== undefined) data.contactId = body.contactId
    if (body.notes !== undefined) data.notes = body.notes ?? null
    if (body.status && body.status !== "CHECKED_OUT") data.status = body.status

    // Handle check-out: save checkout GPS + auto-set checkOutAt + calculate duration
    if (body.status === "CHECKED_OUT") {
      const result = await prisma.$transaction((tx: Prisma.TransactionClient) => completeMtmVisit(tx, {
        organizationId: auth.orgId,
        visitId: id,
        expectedAgentId: current.agentId,
        checkOutAt: body.checkOutAt ? new Date(body.checkOutAt) : undefined,
        latitude: body.latitude,
        longitude: body.longitude,
      }))
      if (result.status === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 })
      if (result.status === "invalid_status") {
        return NextResponse.json({ error: "Visit cannot be completed from its current status", code: "MTM_VISIT_STATUS_INVALID" }, { status: 409 })
      }
      if (result.status === "missing_requirements") {
        return NextResponse.json({
          error: "Required visit actions are incomplete",
          code: "MTM_VISIT_REQUIREMENTS_INCOMPLETE",
          missing: result.missing,
        }, { status: 422 })
      }

      await writeMtmAudit({
        organizationId: auth.orgId,
        agentId: result.visit.agentId,
        action: "CHECK_OUT",
        entity: "visit",
        entityId: id,
        metadataKind: "check_out",
        newData: {
          duration: result.visit.duration,
          latitude: body.latitude,
          longitude: body.longitude,
          idempotent: result.idempotent,
        },
        req,
      }).catch((e) => console.warn("[MTM/visits/[id] PUT] CHECK_OUT audit failed", e))
      return NextResponse.json({ success: true, data: result.visit, idempotent: result.idempotent })
    } else {
      // Non-checkout update: lat/lng goes to checkInLat/Lng
      if (body.latitude != null) data.checkInLat = body.latitude
      if (body.longitude != null) data.checkInLng = body.longitude
    }

    // G — capture the pre-update agent/status so we can push the affected agent
    // when a manager (not the agent) reassigns or cancels their visit.
    const before = body.agentId || body.status === "CANCELLED" ? current : null

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const changed = await tx.mtmVisit.updateMany({
        where: mutableVisitWhere(actor, auth.orgId, { id }),
        data,
      })
      if (changed.count === 0) return null
      return changed
    })
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // G — route-change push (best-effort; never breaks the update).
    if (before) {
      const actorUserId = auth.userId || null
      if (body.agentId && body.agentId !== before.agentId) {
        await notifyMtmAgentOfVisitChange({ organizationId: auth.orgId, actorUserId, agentId: body.agentId, change: "assigned", visitId: id })
        await notifyMtmAgentOfVisitChange({ organizationId: auth.orgId, actorUserId, agentId: before.agentId, change: "unassigned", visitId: id })
      }
      if (body.status === "CANCELLED" && before.status !== "CANCELLED") {
        // the agent may have just been reassigned above; notify whoever now holds it
        await notifyMtmAgentOfVisitChange({ organizationId: auth.orgId, actorUserId, agentId: body.agentId ?? before.agentId, change: "cancelled", visitId: id })
      }
    }

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: body.agentId ?? null,
      action: "VISIT_UPDATE",
      entity: "visit",
      entityId: id,
      metadataKind: "visit_update",
      newData: data,
      req,
    }).catch((e) => console.warn("[MTM/visits/[id] PUT] VISIT_UPDATE audit failed", e))

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to update" }, { status: 400 })
  }
})

export const DELETE = withRouteFieldRlsAuth("delete", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) {
    return NextResponse.json({ error: "MTM agent access required", code: "MTM_AGENT_ACCESS_REQUIRED" }, { status: 403 })
  }

  try {
    const before = await prisma.mtmVisit.findFirst({
      where: mutableVisitWhere(actor, auth.orgId, { id }),
      select: { id: true, agentId: true, customerId: true, status: true },
    })
    if (!before) {
      return NextResponse.json({ error: "Not found", code: "MTM_VISIT_NOT_FOUND" }, { status: 404 })
    }
    const deleted = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const changed = await tx.mtmVisit.updateMany({
        where: mutableVisitWhere(actor, auth.orgId, { id }),
        data: { deletedAt: new Date() },
      })
      if (changed.count === 0) return null
      return changed
    })
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 })

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: before?.agentId,
      action: "VISIT_DELETE",
      entity: "visit",
      entityId: id,
      metadataKind: "visit_delete",
      oldData: before,
      req,
    }).catch((e) => console.warn("[MTM/visits/[id] DELETE] audit failed", e))

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to delete" }, { status: 400 })
  }
})
