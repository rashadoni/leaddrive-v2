import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { mtmTaskScopeWhere } from "@/lib/mtm/task-access"
import { canViewMtmVisitAtCheckIn, historicalVisitCandidateWhere } from "@/lib/mtm/visit-scope"
import { effectiveGeofenceRadius, isOwnVisitExecution } from "@/lib/mtm/visit-review"
import { isValidTimezone } from "@/lib/timezone"

const OPEN_TASK_STATUSES = ["PENDING", "IN_PROGRESS", "OVERDUE"] as const
const REVIEW_PHOTO_LIMIT = 30

/**
 * Read-only review of one visit for the office (/mtm/visits?visitId=…).
 *
 * The execution workspace is scoped to mutation (primary agent only, open
 * visits only), so a supervisor opening a finished visit got nothing back.
 * This endpoint uses the same visibility as the exact detail endpoint —
 * primary agent in scope, or a participant at check-in — and returns what
 * happened: times, both GPS fixes against the customer's geofence, photos,
 * signature, the agent's note and the saved result. It never mutates.
 */
export const GET = withRouteFieldRlsAuth("read", async (
  _req,
  auth,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return NextResponse.json({ error: "MTM agent access required", code: "MTM_AGENT_ACCESS_REQUIRED" }, { status: 403 })

  try {
    const visit = await prisma.mtmVisit.findFirst({
      where: historicalVisitCandidateWhere(actor, auth.orgId, { id }),
      select: {
        id: true,
        agentId: true,
        customerId: true,
        status: true,
        checkInAt: true,
        checkOutAt: true,
        duration: true,
        checkInLat: true,
        checkInLng: true,
        checkOutLat: true,
        checkOutLng: true,
        checkInCustomerLat: true,
        checkInCustomerLng: true,
        checkInGeofenceRadius: true,
        notes: true,
        outcome: true,
        potential: true,
        resultNotes: true,
        nextActionDueAt: true,
        agent: { select: { id: true, name: true } },
        customer: {
          select: { id: true, name: true, address: true, city: true, latitude: true, longitude: true, geofenceRadius: true },
        },
        contact: { select: { id: true, displayName: true } },
        route: { select: { id: true, name: true, date: true } },
        routePoint: { select: { id: true, orderIndex: true } },
        participants: { select: { agentId: true, role: true, joinedAt: true, leftAt: true } },
        requirementSnapshot: {
          select: { requirements: { select: { id: true, actionKey: true, mode: true, minCount: true } } },
        },
        actionResults: {
          orderBy: { createdAt: "asc" },
          select: { id: true, actionKey: true, status: true, evidence: true, completedAt: true },
        },
        presentationSessions: {
          orderBy: { openedAt: "asc" },
          select: {
            id: true,
            openedAt: true,
            lastViewedAt: true,
            closedAt: true,
            activeDurationSeconds: true,
            openLat: true,
            openLng: true,
            closeLat: true,
            closeLng: true,
            pageCount: true,
            lastPage: true,
            pagesViewed: true,
            pageEvents: true,
            presentationVersion: true,
            product: {
              select: { id: true, name: true, group: { select: { id: true, name: true } } },
            },
            document: { select: { id: true, title: true, fileName: true, mimeType: true } },
          },
        },
        // The grid shows the first photos; the count and the PHOTO step use _count.
        _count: { select: { photos: true } },
        photos: {
          orderBy: { createdAt: "asc" },
          take: REVIEW_PHOTO_LIMIT,
          select: { id: true, url: true, thumbnailUrl: true, status: true, createdAt: true },
        },
      },
    })
    if (!visit || !canViewMtmVisitAtCheckIn(actor, visit)) {
      return NextResponse.json({ error: "Not found", code: "MTM_VISIT_NOT_FOUND" }, { status: 404 })
    }

    const [settings, openTasks, openTaskCount] = await Promise.all([
      getMtmSettings(auth.orgId),
      prisma.mtmTask.findMany({
        where: {
          organizationId: auth.orgId,
          customerId: visit.customerId,
          deletedAt: null,
          status: { in: [...OPEN_TASK_STATUSES] },
          AND: [mtmTaskScopeWhere(actor)],
        },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        take: 3,
        select: { id: true, title: true, priority: true, dueDate: true },
      }),
      prisma.mtmTask.count({
        where: {
          organizationId: auth.orgId,
          customerId: visit.customerId,
          deletedAt: null,
          status: { in: [...OPEN_TASK_STATUSES] },
          AND: [mtmTaskScopeWhere(actor)],
        },
      }),
    ])

    const { participants: _authorizationEvidence, _count: counts, ...publicVisit } = visit
    void _authorizationEvidence
    const primaryAgentVisible = isAgentInRouteScope(actor, visit.agentId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"

    return NextResponse.json({
      success: true,
      data: {
        visit: {
          ...publicVisit,
          agentId: primaryAgentVisible ? visit.agentId : null,
          agent: primaryAgentVisible ? visit.agent : null,
          primaryAgentHidden: !primaryAgentVisible,
          // A route is named after its agent often enough ("Anar — Monday")
          // that it identifies a primary agent the reviewer may not see.
          route: primaryAgentVisible ? visit.route : null,
          routePoint: primaryAgentVisible ? visit.routePoint : null,
          photoCount: counts?.photos ?? visit.photos.length,
        },
        geofenceRadius: effectiveGeofenceRadius(visit.customer.geofenceRadius, settings.geofenceRadius),
        openTasks: { count: openTaskCount, items: openTasks },
        timezone,
        viewer: {
          // Only the visit's own agent executes it; everyone else reviews.
          canExecute: isOwnVisitExecution(actor, visit),
        },
      },
    })
  } catch (error) {
    console.error("[MTM/visits/[id]/review GET]", error)
    return NextResponse.json({ error: "Failed to load visit", code: "MTM_VISIT_REVIEW_FAILED" }, { status: 500 })
  }
})
