import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { calculateDistance } from "@/lib/geo-utils"
import { MTM_CHECK_IN_ERROR, checkInErrorFromThrown, checkInErrorResponse } from "@/lib/mtm/check-in-errors"
import { hasMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { VisitCreateSchema, parseBody } from "@/lib/mtm-validators"
import { notifyAgent } from "@/lib/mtm-notify"
import { getMtmSettings } from "@/lib/mtm-settings"
import { addDateKeyDays, currentDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import {
  createVisitRequirementSnapshot,
  lockAndVerifyMtmRoutePointForCheckIn,
  lockMtmActiveVisitSlot,
} from "@/lib/mtm/visit-requirements"
import { validateMtmRouteTargets } from "@/lib/mtm/route-targets"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import {
  canMutateMtmVisit,
  canViewMtmVisitAtCheckIn,
  historicalVisitCandidateWhere,
  scopedVisitWhere,
} from "@/lib/mtm/visit-scope"
import {
  contactMutationScopeForActor,
  customerMutationScopeForActor,
} from "@/lib/mtm/field-scope"
import { mtmAlertMessageForCustomer } from "@/lib/mtm/alert-messages"

export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) {
    return NextResponse.json({ error: "MTM agent access required", code: "MTM_AGENT_ACCESS_REQUIRED" }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const agentId = searchParams.get("agentId") || ""
  const customerId = searchParams.get("customerId") || ""
  const from = searchParams.get("from") || ""
  const to = searchParams.get("to") || ""
  const requestedRange = searchParams.get("range")
  const range = requestedRange === "today" || requestedRange === "7d" || requestedRange === "30d" || requestedRange === "all"
    ? requestedRange
    : null
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50")))

  if (agentId && !isAgentInRouteScope(actor, agentId)) {
    return NextResponse.json({ error: "Not found", code: "MTM_VISIT_AGENT_NOT_FOUND" }, { status: 404 })
  }

  try {
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const candidateLimit = 2_000
    const filters: Prisma.MtmVisitWhereInput = {}
    if (agentId) filters.agentId = agentId
    if (customerId) filters.customerId = customerId
    if (from || to) {
      filters.checkInAt = {}
      if (from) filters.checkInAt.gte = new Date(from)
      if (to) filters.checkInAt.lte = new Date(to)
    } else if (range && range !== "all") {
      const today = currentDateKey(new Date(), timezone)
      const days = range === "today" ? 1 : range === "7d" ? 7 : 30
      const firstDay = addDateKeyDays(today, -(days - 1))
      filters.checkInAt = {
        gte: localDateKeyToUtc(firstDay, timezone),
        lt: localDateKeyToUtc(addDateKeyDays(today, 1), timezone),
      }
    }
    const include = {
      agent: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, address: true, latitude: true, longitude: true } },
      contact: { select: { id: true, displayName: true, type: true, specialtyName: true } },
      participants: {
        select: { agentId: true, role: true, joinedAt: true, leftAt: true },
      },
    } as const
    type VisitRow = Prisma.MtmVisitGetPayload<{ include: typeof include }>

    let visits: VisitRow[]
    let total: number | null
    let totalExact: boolean
    let sourceTruncated: boolean

    if (actor.role === "ADMIN") {
      const where = scopedVisitWhere(actor, auth.orgId, filters)
      const [rows, exactTotal] = await Promise.all([
        prisma.mtmVisit.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { checkInAt: "desc" },
          include,
        }),
        prisma.mtmVisit.count({ where }),
      ])
      visits = rows
      total = exactTotal
      totalExact = true
      sourceTruncated = false
    } else {
      // Participant visibility is evaluated at the immutable check-in time and
      // cannot be expressed as a correlated Prisma relation predicate. Read a
      // bounded candidate superset, post-filter it before pagination, and never
      // derive a "total" from hidden candidates.
      const candidates = await prisma.mtmVisit.findMany({
        where: historicalVisitCandidateWhere(actor, auth.orgId, filters),
        take: candidateLimit + 1,
        orderBy: { checkInAt: "desc" },
        include,
      })
      sourceTruncated = candidates.length > candidateLimit
      const visibleCandidates = candidates
        .slice(0, candidateLimit)
        .filter((visit) => canViewMtmVisitAtCheckIn(actor, visit))
      const offset = (page - 1) * limit
      visits = visibleCandidates.slice(offset, offset + limit)
      total = sourceTruncated ? null : visibleCandidates.length
      totalExact = !sourceTruncated
    }

    // Relation filters cannot compare participant timestamps with the parent
    // check-in column. Re-apply the immutable event-time boundary before any
    // candidate row or employee identity is serialized.
    const visibleVisits = visits.filter((visit) => canViewMtmVisitAtCheckIn(actor, visit))
    const publicVisits = visibleVisits.map((visit) => {
      const { participants: _authorizationEvidence, ...publicVisit } = visit
      const primaryAgentVisible = isAgentInRouteScope(actor, visit.agentId)
      return {
        ...publicVisit,
        agentId: primaryAgentVisible ? visit.agentId : null,
        agent: primaryAgentVisible ? visit.agent : null,
        primaryAgentHidden: !primaryAgentVisible,
        canMutate: canMutateMtmVisit(actor, visit.agentId),
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        visits: publicVisits,
        total,
        totalExact,
        sourceTruncated,
        candidateLimit: actor.role === "ADMIN" ? null : candidateLimit,
        page,
        limit,
        range,
        timezone,
      },
    })
  } catch (e) {
    console.error("[MTM/visits GET]", e)
    return NextResponse.json({ error: "Failed to load visits" }, { status: 500 })
  }
})

export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) {
    return NextResponse.json({ error: "MTM agent access required", code: "MTM_AGENT_ACCESS_REQUIRED" }, { status: 403 })
  }
  const orgId = auth.orgId

  try {
    const raw = await req.json()
    const parsed = parseBody(VisitCreateSchema, raw)
    if (!parsed.ok) return parsed.response
    const body = parsed.data
    const { agentId, customerId, notes, force } = body
    const latitude = body.latitude ?? null
    const longitude = body.longitude ?? null

    if (!canMutateMtmVisit(actor, agentId)) {
      return NextResponse.json({ error: "Not found", code: "MTM_VISIT_AGENT_NOT_FOUND" }, { status: 404 })
    }
    const targetAgent = await prisma.mtmAgent.findFirst({
      where: { id: agentId, organizationId: orgId, status: "ACTIVE" },
      select: { id: true },
    })
    if (!targetAgent) {
      return NextResponse.json({ error: "Visit agent is invalid", code: "MTM_VISIT_REFERENCE_INVALID" }, { status: 400 })
    }
    // Fast rejection keeps geofence alert/notification side effects out of the
    // common already-open case. The same check is repeated under the shared
    // cross-writer slot lock inside the create transaction for correctness.
    const existingActiveVisit = await prisma.mtmVisit.findFirst({
      where: { organizationId: orgId, agentId, status: "CHECKED_IN", deletedAt: null },
      select: { id: true },
    })
    if (existingActiveVisit) {
      return checkInErrorResponse(MTM_CHECK_IN_ERROR.ACTIVE_VISIT, { activeVisitId: existingActiveVisit.id })
    }

    const scopeAt = new Date()
    const scopedCustomer = await prisma.mtmCustomer.findFirst({
      where: {
        id: customerId,
        organizationId: orgId,
        deletedAt: null,
        AND: [customerMutationScopeForActor(actor, scopeAt)],
      },
      select: { id: true, name: true, latitude: true, longitude: true, geofenceRadius: true },
    })
    if (!scopedCustomer) return checkInErrorResponse(MTM_CHECK_IN_ERROR.CUSTOMER_MISSING)
    // Owner decision 2 (field UX audit 2026-09-05): a customer without
    // coordinates cannot be visited by anyone, force included. The fix is on
    // the organization card, not in the field.
    if (!hasMtmCoordinates(scopedCustomer)) {
      return checkInErrorResponse(MTM_CHECK_IN_ERROR.NO_COORDINATES, { customerId })
    }
    if (body.contactId) {
      const scopedContact = await prisma.mtmContact.findFirst({
        where: {
          id: body.contactId,
          organizationId: orgId,
          deletedAt: null,
          status: { not: "INACTIVE" },
          AND: [
            contactMutationScopeForActor(actor, scopeAt),
            {
              workplaces: {
                some: {
                  organizationId: orgId,
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
        return checkInErrorResponse(MTM_CHECK_IN_ERROR.CONTACT_MISSING)
      }
    }

    // Force is authorized from the caller's freshly resolved MTM role. The
    // target agent's role must never be usable as a privilege proxy.
    if (force && !new Set(["ADMIN", "MANAGER", "SUPERVISOR"]).has(actor.role)) {
      return checkInErrorResponse(MTM_CHECK_IN_ERROR.FORCE_FORBIDDEN, { actorRole: actor.role })
    }

    // Track whether the geofence was bypassed so audit log can reflect it.
    let forceOverrideMeta: { distanceMeters: number; geofenceRadius: number } | null = null
    let deferredForceAlert: {
      customerName: string
      distanceMeters: number
      geofenceRadius: number
      customerLatitude: number
      customerLongitude: number
    } | null = null
    // Geofence validation when the agent provides GPS coordinates. A missing
    // agent fix does not block the check-in; a missing customer pair was
    // already refused above with NO_COORDINATES.
    if (latitude != null && longitude != null) {
      const customer = scopedCustomer
      const orgSettings = await getMtmSettings(orgId)
      // F-22: prefer per-customer override, fall back to org-level setting (default 100m)
      const geofenceRadius =
        customer.geofenceRadius != null ? customer.geofenceRadius : orgSettings.geofenceRadius

      const distanceMeters = calculateDistance(
        latitude,
        longitude,
        customer.latitude,
        customer.longitude
      )

      if (distanceMeters > geofenceRadius) {
        // Create an OUT_OF_ZONE alert regardless of force flag —
        // unless the org turned geofence alerts off (alertOutOfZone).
        if (!force && agentId && orgSettings.alertOutOfZone) {
          await prisma.mtmAlert.create({
            data: {
              organizationId: orgId,
              agentId,
              type: "OUT_OF_ZONE",
              category: "WARNING",
              title: `Geofence violation at ${customer.name}`,
              description: `Agent checked in ${Math.round(distanceMeters)}m away (max ${geofenceRadius}m)`,
              metadata: {
                customerId,
                distanceMeters: Math.round(distanceMeters),
                geofenceRadius,
                agentLat: latitude,
                agentLng: longitude,
                customerLat: customer.latitude,
                customerLng: customer.longitude,
                ...mtmAlertMessageForCustomer("geofenceViolation", customer.name, {
                  distanceMeters: Math.round(distanceMeters),
                  geofenceRadius,
                }),
              },
            },
          }).catch((err: unknown) => console.warn("[MTM/visits POST] alert create failed", err))
          // F-09: notify the agent so they know their check-in was flagged
          notifyAgent({
            organizationId: orgId,
            agentId,
            type: "warning",
            title: "Out of zone check-in",
            body: `Your check-in at ${customer.name} was ${Math.round(distanceMeters)}m from the customer (max ${geofenceRadius}m).`,
            metadata: {
              customerId,
              distanceMeters: Math.round(distanceMeters),
              geofenceRadius,
              ...mtmAlertMessageForCustomer("agentOutOfZoneCheckIn", customer.name, {
                distanceMeters: Math.round(distanceMeters),
                geofenceRadius,
              }),
            },
          }).catch((err: unknown) => console.warn("[MTM/visits POST] notify failed", err))
        }

        // Block unless force override
        if (!force) {
          return checkInErrorResponse(MTM_CHECK_IN_ERROR.TOO_FAR, {
            distanceMeters: Math.round(distanceMeters),
            geofenceRadius,
          })
        }
        // F-17: remember override metadata for audit log below
        forceOverrideMeta = { distanceMeters: Math.round(distanceMeters), geofenceRadius }
        if (orgSettings.alertOutOfZone) {
          deferredForceAlert = {
            customerName: customer.name,
            distanceMeters: Math.round(distanceMeters),
            geofenceRadius,
            customerLatitude: customer.latitude,
            customerLongitude: customer.longitude,
          }
        }
      }
    }

    const checkInAt = new Date()
    const visit = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await lockMtmActiveVisitSlot(tx, { organizationId: orgId, agentId })
      const activeVisit = await tx.mtmVisit.findFirst({
        where: { organizationId: orgId, agentId, status: "CHECKED_IN", deletedAt: null },
        select: { id: true },
      })
      if (activeVisit) throw new Error(MTM_CHECK_IN_ERROR.ACTIVE_VISIT)

      const routePoint = await tx.mtmRoutePoint.findFirst({
        where: {
          ...(body.routePointId ? { id: body.routePointId } : {}),
          ...(body.routeId ? { routeId: body.routeId } : {}),
          customerId,
          ...(body.contactId ? { contactId: body.contactId } : {}),
          status: "PENDING",
          deletedAt: null,
          route: {
            organizationId: orgId,
            status: { in: ["PLANNED", "IN_PROGRESS"] },
            deletedAt: null,
            OR: [
              { agentId },
              { assignments: { some: { agentId, removedAt: null, role: { not: "OBSERVER" } } } },
            ],
          },
        },
        orderBy: { route: { date: "desc" } },
        select: {
          id: true,
          routeId: true,
          contactId: true,
          route: {
            select: {
              status: true,
              assignments: {
                where: { removedAt: null },
                select: { agentId: true, role: true },
              },
            },
          },
        },
      })
      if ((body.routeId || body.routePointId) && !routePoint) {
        throw new Error(MTM_CHECK_IN_ERROR.ROUTE_POINT_NOT_AVAILABLE)
      }

      const contactId = routePoint?.contactId ?? body.contactId ?? null
      const targetValidation = await validateMtmRouteTargets(tx, {
        organizationId: orgId,
        routeDate: checkInAt,
        points: [{ customerId, contactId }],
      })
      if (!targetValidation.ok) throw new Error(MTM_CHECK_IN_ERROR.ROUTE_TARGET_INVALID)

      if (routePoint) {
        const pointAvailable = await lockAndVerifyMtmRoutePointForCheckIn(tx, {
          organizationId: orgId,
          agentId,
          routePointId: routePoint.id,
          routeId: routePoint.routeId,
          customerId,
          contactId,
        })
        if (!pointAvailable) throw new Error(MTM_CHECK_IN_ERROR.ROUTE_POINT_NOT_AVAILABLE)
        const activePointVisit = await tx.mtmVisit.findFirst({
          where: { organizationId: orgId, routePointId: routePoint.id, status: "CHECKED_IN", deletedAt: null },
          select: { id: true },
        })
        if (activePointVisit) throw new Error(MTM_CHECK_IN_ERROR.ROUTE_POINT_ALREADY_ACTIVE)
      }

      const created = await tx.mtmVisit.create({
        data: {
          organizationId: orgId,
          agentId,
          customerId,
          contactId,
          routeId: routePoint?.routeId ?? null,
          routePointId: routePoint?.id ?? null,
          checkInAt,
          checkInLat: latitude,
          checkInLng: longitude,
          notes: notes || null,
        },
      })

      await createVisitRequirementSnapshot(tx, {
        organizationId: orgId,
        visitId: created.id,
        agentId,
        customerId,
        visitType: body.visitType,
        at: checkInAt,
      })

      if (routePoint) {
        const participants = routePoint.route.assignments.filter((assignment) => assignment.agentId !== agentId)
        if (participants.length) {
          await tx.mtmVisitParticipant.createMany({
            data: participants.map((assignment) => ({
              organizationId: orgId,
              visitId: created.id,
              agentId: assignment.agentId,
              role: assignment.role,
              joinedAt: checkInAt,
            })),
            skipDuplicates: true,
          })
        }
        if (routePoint.route.status === "PLANNED") {
          await tx.mtmRoute.updateMany({
            where: { id: routePoint.routeId, organizationId: orgId, status: "PLANNED", deletedAt: null },
            data: { status: "IN_PROGRESS", startedAt: checkInAt },
          })
        }
      }
      return created
    })

    // Authorized force alerts happen only after the locked create commits. A
    // concurrent winner can therefore reject this request without producing a
    // false geofence incident or notification for a visit that never existed.
    if (deferredForceAlert) {
      const alert = deferredForceAlert
      prisma.mtmAlert.create({
        data: {
          organizationId: orgId,
          agentId,
          type: "OUT_OF_ZONE",
          category: "WARNING",
          title: `Geofence violation at ${alert.customerName}`,
          description: `Agent checked in ${alert.distanceMeters}m away (max ${alert.geofenceRadius}m)`,
          metadata: {
            customerId,
            distanceMeters: alert.distanceMeters,
            geofenceRadius: alert.geofenceRadius,
            agentLat: latitude,
            agentLng: longitude,
            customerLat: alert.customerLatitude,
            customerLng: alert.customerLongitude,
            forceOverride: true,
            ...mtmAlertMessageForCustomer("geofenceViolation", alert.customerName, {
              distanceMeters: alert.distanceMeters,
              geofenceRadius: alert.geofenceRadius,
            }),
          },
        },
      }).catch((err: unknown) => console.warn("[MTM/visits POST] forced alert create failed", err))
      notifyAgent({
        organizationId: orgId,
        agentId,
        type: "warning",
        title: "Out of zone check-in",
        body: `Your check-in at ${alert.customerName} was ${alert.distanceMeters}m from the customer (max ${alert.geofenceRadius}m).`,
        metadata: {
          customerId,
          distanceMeters: alert.distanceMeters,
          geofenceRadius: alert.geofenceRadius,
          forceOverride: true,
          ...mtmAlertMessageForCustomer("agentOutOfZoneCheckIn", alert.customerName, {
            distanceMeters: alert.distanceMeters,
            geofenceRadius: alert.geofenceRadius,
          }),
        },
      }).catch((err: unknown) => console.warn("[MTM/visits POST] forced notify failed", err))
    }

    // Audit log — non-blocking
    // F-17: include force-override metadata if geofence was bypassed
    // F-29 follow-up: set metadataKind="force_checkin" on overrides so the
    // existing (organizationId, metadataKind) index can serve queries
    // like "show me every supervisor geofence-override last quarter"
    // without a JSON path scan on newData.
    writeMtmAudit({
      organizationId: orgId,
      agentId,
      action: forceOverrideMeta ? "CHECK_IN_FORCED" : "CHECK_IN",
      entity: "visit",
      entityId: visit.id,
      metadataKind: forceOverrideMeta ? "force_checkin" : null,
      newData: {
        customerId,
        contactId: visit.contactId,
        latitude,
        longitude,
        notes,
        ...(forceOverrideMeta ? { forceOverride: true, ...forceOverrideMeta } : {}),
      },
      req,
    }).catch((err) => console.warn("[MTM/visits POST] audit failed", err))

    return NextResponse.json({ success: true, data: visit }, { status: 201 })
  } catch (e: unknown) {
    // Refusals raised inside the locked transaction carry their contract code
    // as the message; everything else stays a generic 400.
    const contractCode = checkInErrorFromThrown(e)
    if (contractCode) return checkInErrorResponse(contractCode)
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to create visit" }, { status: 400 })
  }
})
