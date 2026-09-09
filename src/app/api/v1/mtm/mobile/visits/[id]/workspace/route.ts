import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { withNormalizedCoordinates } from "@/lib/mtm/geo-coordinates"

/**
 * Mobile visit workspace. The bearer agent may only read a visit they own or
 * actively participate in; managers keep using the richer web workspace.
 */
export const GET = withMobileRls(async (
  _req,
  auth,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params
  const visit = await prisma.mtmVisit.findFirst({
    where: {
      id,
      organizationId: auth.orgId,
      deletedAt: null,
      OR: [
        { agentId: auth.agentId },
        { participants: { some: { agentId: auth.agentId, leftAt: null } } },
      ],
    },
    select: {
      id: true,
      agentId: true,
      customerId: true,
      contactId: true,
      routeId: true,
      routePointId: true,
      status: true,
      checkInAt: true,
      checkOutAt: true,
      checkInLat: true,
      checkInLng: true,
      checkOutLat: true,
      checkOutLng: true,
      duration: true,
      notes: true,
      outcome: true,
      potential: true,
      resultNotes: true,
      nextActionDueAt: true,
      customer: {
        select: {
          id: true,
          name: true,
          objectType: true,
          category: true,
          address: true,
          city: true,
          phone: true,
          latitude: true,
          longitude: true,
        },
      },
      contact: {
        select: {
          id: true,
          displayName: true,
          type: true,
          specialtyName: true,
          phone: true,
        },
      },
      route: { select: { id: true, name: true, date: true, status: true } },
      routePoint: { select: { id: true, orderIndex: true, plannedTime: true, status: true } },
      requirementSnapshot: {
        select: {
          id: true,
          sourcePolicyId: true,
          resolvedAt: true,
          sourcePolicy: { select: { id: true, name: true } },
          requirements: {
            orderBy: [{ mode: "asc" }, { actionKey: "asc" }],
            select: {
              id: true,
              actionKey: true,
              mode: true,
              minCount: true,
              conditions: true,
              allowWaiver: true,
            },
          },
        },
      },
      actionResults: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          requirementId: true,
          actionKey: true,
          status: true,
          evidence: true,
          completedAt: true,
          createdAt: true,
        },
      },
      photos: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, url: true, thumbnailUrl: true, category: true, status: true, createdAt: true },
      },
      tasks: {
        where: { deletedAt: null },
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        select: { id: true, title: true, description: true, status: true, priority: true, dueDate: true, result: true },
      },
    },
  })

  if (!visit) {
    return NextResponse.json(
      { error: "Visit not found", code: "MTM_VISIT_NOT_FOUND" },
      { status: 404 },
    )
  }

  const reminders = await prisma.mtmTask.findMany({
    where: {
      organizationId: auth.orgId,
      customerId: visit.customerId,
      deletedAt: null,
      status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] },
      OR: [{ visitId: null }, { visitId: { not: visit.id } }],
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    take: 20,
    select: { id: true, title: true, description: true, status: true, priority: true, dueDate: true, result: true, visitId: true },
  })

  return NextResponse.json({
    success: true,
    data: {
      // Same rule as every other read path: a pre-migration (0, 0) leaves the
      // server as null/null, never as a number the app would measure from
      // (src/lib/mtm/geo-coordinates.ts).
      visit: { ...visit, customer: withNormalizedCoordinates(visit.customer) },
      reminders,
    },
  })
})
