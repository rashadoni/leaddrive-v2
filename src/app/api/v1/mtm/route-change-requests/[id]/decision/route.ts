import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { RouteChangeDecisionSchema, parseBody } from "@/lib/mtm-validators"
import { canReviewMtmRouteRequest, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { MTM_ROUTE_AUDIT_ACTION } from "@/lib/mtm/route-audit"
import { validateMtmRouteTargets } from "@/lib/mtm/route-targets"
import { getMtmSettings } from "@/lib/mtm-settings"
import { resolveWorkCalendarDay, type WorkCalendarOverride } from "@/lib/mtm/work-calendar"
import {
  appendMtmRouteChangeEvidenceOutcome,
  readMtmRouteChangeEvidence,
  snapshotMtmRouteForChangeEvidence,
  snapshotMtmRoutePointForChangeEvidence,
} from "@/lib/mtm/route-change-evidence"
import { enqueueMtmRouteNotification } from "@/lib/mtm/route-notification-outbox"

type RouteContext = { params: Promise<{ id: string }> }

class RouteChangeConflict extends Error {}

function payloadCustomerId(payload: Prisma.JsonValue | null): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const value = payload.customerId
  return typeof value === "string" ? value : null
}

function payloadContactId(payload: Prisma.JsonValue | null): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const value = payload.contactId
  return typeof value === "string" ? value : null
}

function payloadRecord(payload: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, Prisma.JsonValue>
    : {}
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function rescheduledPlannedTime(original: Date | null, targetDate: string): Date | null {
  if (!original) return null
  return new Date(`${targetDate}T${original.toISOString().slice(11)}`)
}

export const POST = withRouteFieldRlsAuth<RouteContext>("write", async (req, auth, { params }) => {
  const { id } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" }, { status: 403 })

  const parsed = parseBody(RouteChangeDecisionSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const changeRequest = await prisma.mtmRouteChangeRequest.findFirst({
    where: { id, organizationId: auth.orgId },
    include: {
      route: {
        select: {
          id: true,
          agentId: true,
          date: true,
          status: true,
          version: true,
          publishedVersion: true,
          totalPoints: true,
          assignments: {
            where: { removedAt: null },
            select: { agentId: true },
          },
        },
      },
      routePoint: {
        select: {
          id: true,
          status: true,
          customerId: true,
          contactId: true,
          orderIndex: true,
          plannedTime: true,
          notes: true,
          deletedAt: true,
          visits: { where: { deletedAt: null }, select: { id: true }, take: 1 },
        },
      },
    },
  })
  if (!changeRequest) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!canReviewMtmRouteRequest(actor, changeRequest.requestedByAgentId)) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" }, { status: 403 })
  }

  const storedPayload = payloadRecord(changeRequest.payload)
  const terminalStatus = body.decision === "RESCHEDULE" ? "APPROVED" : body.decision
  const storedResolution = typeof storedPayload.resolution === "string" ? storedPayload.resolution : null
  if (["APPROVED", "REJECTED", "CANCELLED"].includes(changeRequest.status)) {
    const sameDecision = body.decision === "RESCHEDULE"
      ? changeRequest.status === "APPROVED" && storedResolution === "RESCHEDULE"
      : changeRequest.status === terminalStatus && storedResolution !== "RESCHEDULE"
    if (sameDecision) {
      return NextResponse.json({ success: true, data: changeRequest, idempotent: true })
    }
    return NextResponse.json({ error: "Request already decided", code: "APPROVAL_ALREADY_DECIDED" }, { status: 409 })
  }
  if (body.decision === "RESCHEDULE") {
    if (changeRequest.changeType !== "REMOVE_STOP") {
      return NextResponse.json({ error: "Only stop cancellations can be rescheduled", code: "MTM_RESCHEDULE_TYPE_INVALID" }, { status: 409 })
    }
    const originalDate = dateKey(changeRequest.route.date)
    const targetDate = body.rescheduleDate!
    const latestDate = new Date(changeRequest.route.date)
    latestDate.setUTCDate(latestDate.getUTCDate() + 180)
    if (targetDate <= originalDate || targetDate > dateKey(latestDate)) {
      return NextResponse.json({ error: "Reschedule date must be within 180 days after the original route", code: "MTM_RESCHEDULE_DATE_INVALID" }, { status: 400 })
    }
    if (!changeRequest.routePoint) {
      return NextResponse.json({ error: "The route stop is no longer available", code: "ROUTE_POINT_NOT_FOUND" }, { status: 409 })
    }
    const targetValidation = await validateMtmRouteTargets(prisma, {
      organizationId: auth.orgId,
      routeDate: new Date(`${targetDate}T00:00:00.000Z`),
      points: [{
        customerId: changeRequest.routePoint.customerId,
        contactId: changeRequest.routePoint.contactId,
      }],
    })
    if (!targetValidation.ok) {
      return NextResponse.json({ error: "The route subject is not valid on the reschedule date", code: "MTM_ROUTE_REFERENCE_INVALID", details: targetValidation }, { status: 409 })
    }
    const settings = await getMtmSettings(auth.orgId)
    if (settings.enforceWorkCalendarForRoutes) {
      const primaryAgent = await prisma.mtmAgent.findFirst({
        where: {
          id: changeRequest.route.agentId,
          organizationId: auth.orgId,
          status: "ACTIVE",
        },
        select: { id: true, teamId: true },
      })
      if (!primaryAgent) {
        return NextResponse.json({ error: "The route agent is not active", code: "MTM_ROUTE_REFERENCE_INVALID" }, { status: 409 })
      }
      const routeDate = new Date(`${targetDate}T00:00:00.000Z`)
      const calendarOverrides = await prisma.mtmWorkCalendarDay.findMany({
        where: {
          organizationId: auth.orgId,
          date: routeDate,
          deletedAt: null,
          OR: [
            { teamId: null, agentId: null },
            ...(primaryAgent.teamId ? [{ teamId: primaryAgent.teamId, agentId: null }] : []),
            { teamId: null, agentId: primaryAgent.id },
          ],
        },
        select: {
          id: true,
          date: true,
          kind: true,
          name: true,
          teamId: true,
          agentId: true,
          movedToDate: true,
          routePlanningAllowed: true,
        },
      })
      const calendarDay = resolveWorkCalendarDay({
        date: targetDate,
        overrides: calendarOverrides as WorkCalendarOverride[],
        teamId: primaryAgent.teamId,
        agentId: primaryAgent.id,
      })
      if (!calendarDay.routePlanningAllowed) {
        return NextResponse.json({
          error: "Route planning is not allowed on this calendar day",
          code: "MTM_ROUTE_NON_WORKING_DAY",
          calendarDay,
        }, { status: 409 })
      }
    }
  }
  if (
    terminalStatus === "APPROVED" &&
    changeRequest.changeType === "REMOVE_STOP" &&
    (changeRequest.routePoint?.visits?.length ?? 0) > 0
  ) {
    return NextResponse.json({ error: "A stop with a started visit cannot be removed", code: "ROUTE_POINT_VISIT_STARTED" }, { status: 409 })
  }
  if (
    terminalStatus === "APPROVED" &&
    changeRequest.changeType === "REMOVE_STOP" &&
    changeRequest.routePoint?.status !== "PENDING"
  ) {
    return NextResponse.json({ error: "The route stop was already resolved", code: "ROUTE_POINT_ALREADY_RESOLVED" }, { status: 409 })
  }

  const addCustomerId = changeRequest.changeType === "ADD_STOP" ? payloadCustomerId(changeRequest.payload) : null
  const addContactId = changeRequest.changeType === "ADD_STOP" ? payloadContactId(changeRequest.payload) : null
  if (body.decision === "APPROVED" && changeRequest.changeType === "ADD_STOP") {
    if (!addCustomerId) {
      return NextResponse.json({ error: "Customer is missing from the request", code: "MTM_ROUTE_REFERENCE_INVALID" }, { status: 409 })
    }
    if (changeRequest.route.status !== "PLANNED" && changeRequest.route.status !== "IN_PROGRESS") {
      return NextResponse.json({ error: "Route cannot accept new stops", code: "ROUTE_TRANSITION_INVALID" }, { status: 409 })
    }
    const [targetValidation, existingPoint] = await Promise.all([
      validateMtmRouteTargets(prisma, {
        organizationId: auth.orgId,
        routeDate: changeRequest.route.date,
        points: [{ customerId: addCustomerId, contactId: addContactId }],
      }),
      prisma.mtmRoutePoint.findFirst({
        where: {
          routeId: changeRequest.routeId,
          customerId: addCustomerId,
          contactId: addContactId,
          deletedAt: null,
          route: { organizationId: auth.orgId },
        },
        select: { id: true },
      }),
    ])
    if (!targetValidation.ok) return NextResponse.json({ error: "Route target is invalid", code: "MTM_ROUTE_REFERENCE_INVALID", details: targetValidation }, { status: 409 })
    if (existingPoint) return NextResponse.json({ error: "Customer or contact is already in the route", code: "ROUTE_TARGET_DUPLICATE" }, { status: 409 })
  }

  const now = new Date()
  let responseEvidence = readMtmRouteChangeEvidence(changeRequest.payload)
  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const decided = await tx.mtmRouteChangeRequest.updateMany({
      where: {
        id: changeRequest.id,
        organizationId: auth.orgId,
        status: { in: ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] },
      },
      data: {
        status: terminalStatus,
        reviewedBy: auth.userId,
        decisionComment: body.comment ?? null,
        reviewedAt: now,
      },
    })
    if (decided.count !== 1) throw new RouteChangeConflict("Request changed concurrently")

    let rescheduled: { routeId: string; routePointId: string; date: string } | null = null
    let evidenceRoute = snapshotMtmRouteForChangeEvidence(changeRequest.route)
    let evidencePoint = snapshotMtmRoutePointForChangeEvidence(changeRequest.routePoint)
    if (terminalStatus === "APPROVED" && changeRequest.changeType === "REMOVE_STOP") {
      if (!changeRequest.routePoint || changeRequest.routePoint.deletedAt) {
        throw new RouteChangeConflict("Route stop is no longer active")
      }
      const removed = await tx.mtmRoutePoint.updateMany({
        where: {
          id: changeRequest.routePoint.id,
          routeId: changeRequest.routeId,
          status: "PENDING",
          deletedAt: null,
          route: { organizationId: auth.orgId },
        },
        data: { deletedAt: now, version: { increment: 1 } },
      })
      if (removed.count !== 1) throw new RouteChangeConflict("Route stop changed concurrently")
      const totalPoints = await tx.mtmRoutePoint.count({
        where: { routeId: changeRequest.routeId, deletedAt: null },
      })
      const updatedRoute = await tx.mtmRoute.updateMany({
        where: {
          id: changeRequest.routeId,
          organizationId: auth.orgId,
          version: changeRequest.route.version,
          deletedAt: null,
        },
        data: {
          totalPoints,
          version: { increment: 1 },
          publishedVersion: changeRequest.route.version + 1,
        },
      })
      if (updatedRoute.count !== 1) throw new RouteChangeConflict("Route changed concurrently")
      evidenceRoute = {
        ...evidenceRoute,
        version: changeRequest.route.version + 1,
        publishedVersion: changeRequest.route.version + 1,
        totalPoints,
      }
      evidencePoint = evidencePoint ? { ...evidencePoint, deletedAt: now.toISOString() } : null

      if (body.decision === "RESCHEDULE" && changeRequest.routePoint) {
        const targetDate = body.rescheduleDate!
        const targetDateValue = new Date(`${targetDate}T00:00:00.000Z`)
        const destination = await tx.mtmRoute.findFirst({
          where: {
            organizationId: auth.orgId,
            agentId: changeRequest.route.agentId,
            date: targetDateValue,
            status: "DRAFT",
            deletedAt: null,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, version: true },
        })
        const destinationRoute = destination ?? await tx.mtmRoute.create({
          data: {
            organizationId: auth.orgId,
            agentId: changeRequest.route.agentId,
            date: targetDateValue,
            name: `Rescheduled ${targetDate}`,
            status: "DRAFT",
            totalPoints: 1,
            notes: `Created from cancellation request ${changeRequest.id}`,
            // Preserve the additive multi-agent compatibility invariant even
            // for a draft synthesized from a legacy route change request:
            // MtmRoute.agentId remains the primary owner and an active PRIMARY
            // assignment mirrors it from the first persisted row.
            assignments: {
              create: {
                organizationId: auth.orgId,
                agentId: changeRequest.route.agentId,
                role: "PRIMARY",
                assignedBy: auth.userId || null,
              },
            },
          },
          select: { id: true, version: true },
        })
        const duplicate = await tx.mtmRoutePoint.findFirst({
          where: {
            routeId: destinationRoute.id,
            customerId: changeRequest.routePoint.customerId,
            contactId: changeRequest.routePoint.contactId,
            deletedAt: null,
          },
          select: { id: true },
        })
        if (duplicate) throw new RouteChangeConflict("The destination route already contains this subject")
        const order = destination ? await tx.mtmRoutePoint.aggregate({
          where: { routeId: destinationRoute.id, deletedAt: null },
          _max: { orderIndex: true },
        }) : { _max: { orderIndex: -1 } }
        const replacement = await tx.mtmRoutePoint.create({
          data: {
            organizationId: auth.orgId,
            routeId: destinationRoute.id,
            customerId: changeRequest.routePoint.customerId,
            contactId: changeRequest.routePoint.contactId,
            orderIndex: (order._max.orderIndex ?? -1) + 1,
            plannedTime: rescheduledPlannedTime(changeRequest.routePoint.plannedTime, targetDate),
            notes: changeRequest.routePoint.notes,
          },
          select: { id: true },
        })
        if (destination) {
          const destinationTotal = await tx.mtmRoutePoint.count({ where: { routeId: destinationRoute.id, deletedAt: null } })
          const updatedDestination = await tx.mtmRoute.updateMany({
            where: {
              id: destinationRoute.id,
              organizationId: auth.orgId,
              version: destinationRoute.version,
              status: "DRAFT",
              deletedAt: null,
            },
            data: { totalPoints: destinationTotal, version: { increment: 1 } },
          })
          if (updatedDestination.count !== 1) throw new RouteChangeConflict("Destination route changed concurrently")
        }
        rescheduled = { routeId: destinationRoute.id, routePointId: replacement.id, date: targetDate }
      }
    } else if (body.decision === "APPROVED" && changeRequest.changeType === "ADD_STOP" && addCustomerId) {
      const order = await tx.mtmRoutePoint.aggregate({
        where: { routeId: changeRequest.routeId, deletedAt: null },
        _max: { orderIndex: true },
      })
      const addedPoint = await tx.mtmRoutePoint.create({
        data: {
          organizationId: auth.orgId,
          routeId: changeRequest.routeId,
          customerId: addCustomerId,
          contactId: addContactId,
          orderIndex: (order._max.orderIndex ?? -1) + 1,
        },
        select: {
          id: true,
          customerId: true,
          contactId: true,
          orderIndex: true,
          status: true,
          plannedTime: true,
          deletedAt: true,
        },
      })
      const totalPoints = await tx.mtmRoutePoint.count({
        where: { routeId: changeRequest.routeId, deletedAt: null },
      })
      const updatedRoute = await tx.mtmRoute.updateMany({
        where: {
          id: changeRequest.routeId,
          organizationId: auth.orgId,
          version: changeRequest.route.version,
          deletedAt: null,
        },
        data: {
          totalPoints,
          version: { increment: 1 },
          publishedVersion: changeRequest.route.version + 1,
        },
      })
      if (updatedRoute.count !== 1) throw new RouteChangeConflict("Route changed concurrently")
      evidenceRoute = {
        ...evidenceRoute,
        version: changeRequest.route.version + 1,
        publishedVersion: changeRequest.route.version + 1,
        totalPoints,
      }
      evidencePoint = snapshotMtmRoutePointForChangeEvidence(addedPoint)
    }

    const payloadWithResolution = rescheduled
      ? {
          ...storedPayload,
          resolution: "RESCHEDULE",
          rescheduleDate: rescheduled.date,
          rescheduledRouteId: rescheduled.routeId,
          rescheduledRoutePointId: rescheduled.routePointId,
        }
      : storedPayload
    const payloadWithEvidence = appendMtmRouteChangeEvidenceOutcome({
      payload: payloadWithResolution,
      decision: body.decision,
      status: terminalStatus,
      recordedAt: now,
      route: evidenceRoute,
      routePoint: evidencePoint,
      rescheduled,
    })
    const payloadToStore = payloadWithEvidence ?? (rescheduled ? payloadWithResolution : null)
    if (payloadToStore) {
      await tx.mtmRouteChangeRequest.update({
        where: { id: changeRequest.id },
        data: { payload: payloadToStore as Prisma.InputJsonValue },
      })
      responseEvidence = readMtmRouteChangeEvidence(payloadToStore)
    }
    await enqueueMtmRouteNotification(tx, {
      organizationId: auth.orgId,
      agentId: changeRequest.requestedByAgentId,
      dedupeKey: `route-change-request:${changeRequest.id}:decision:${changeRequest.status}:${body.decision}:${changeRequest.requestedByAgentId}`,
      title: `Route change ${body.decision === "RESCHEDULE" ? "rescheduled" : body.decision === "APPROVED" ? "approved" : body.decision === "REJECTED" ? "rejected" : "needs information"}`,
      body: body.comment ?? null,
      type: terminalStatus === "APPROVED" ? "info" : "task",
      metadata: { routeId: changeRequest.routeId, requestId: changeRequest.id, decision: body.decision, rescheduled },
    })
    if (terminalStatus === "APPROVED" && ["REMOVE_STOP", "ADD_STOP"].includes(changeRequest.changeType)) {
      const otherAssignedAgentIds = [...new Set([
        changeRequest.route.agentId,
        ...(changeRequest.route.assignments ?? []).map((assignment: { agentId: string }) => assignment.agentId),
      ])].filter((agentId) => agentId !== changeRequest.requestedByAgentId)
      if (otherAssignedAgentIds.length > 0) {
        for (const agentId of otherAssignedAgentIds) {
          await enqueueMtmRouteNotification(tx, {
            organizationId: auth.orgId,
            agentId,
            dedupeKey: `route-change-request:${changeRequest.id}:published-update:${changeRequest.route.version + 1}:${agentId}`,
            title: "Published route updated",
            body: "An approved change was applied to your route.",
            type: "info",
            metadata: {
              routeId: changeRequest.routeId,
              requestId: changeRequest.id,
              publishedVersion: changeRequest.route.version + 1,
              event: "route_published_update",
            },
          })
        }
      }
    }
    await tx.mtmAuditLog.create({
      data: {
        organizationId: auth.orgId,
        agentId: changeRequest.requestedByAgentId,
        action: changeRequest.changeType === "REMOVE_STOP"
          ? MTM_ROUTE_AUDIT_ACTION.ROUTE_REMOVAL_DECISION
          : changeRequest.changeType === "ADD_STOP"
            ? MTM_ROUTE_AUDIT_ACTION.ROUTE_ADDITION_DECISION
            : MTM_ROUTE_AUDIT_ACTION.ROUTE_CONFLICT_OVERRIDE,
        entity: "route_change_request",
        entityId: changeRequest.id,
        metadataKind: changeRequest.changeType === "REMOVE_STOP"
          ? "route_removal_decision"
          : changeRequest.changeType === "ADD_STOP"
            ? "route_addition_decision"
            : "route_conflict_decision",
        oldData: { status: changeRequest.status } as Prisma.InputJsonValue,
        newData: {
          status: terminalStatus,
          resolution: body.decision,
          comment: body.comment ?? null,
          reviewedBy: auth.userId,
          impact: changeRequest.changeType === "REMOVE_STOP" && terminalStatus === "APPROVED"
            ? {
                plannedStops: -1,
                eligibleStops: -1,
                routeVersion: changeRequest.route.version + 1,
                ...(rescheduled ? { rescheduled } : {}),
              }
            : null,
          evidence: responseEvidence.evidence,
          legacySnapshot: responseEvidence.legacySnapshot,
        } as Prisma.InputJsonValue,
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent") || null,
      },
    })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    if (error instanceof RouteChangeConflict || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")) {
      return NextResponse.json({ error: "The request or route changed concurrently", code: "MTM_ROUTE_CHANGE_CONFLICT" }, { status: 409 })
    }
    throw error
  }

  return NextResponse.json({
    success: true,
    data: {
      id: changeRequest.id,
      status: terminalStatus,
      resolution: body.decision,
      reviewedAt: now,
      ...responseEvidence,
    },
  })
})
