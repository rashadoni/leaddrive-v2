import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { mutableVisitWhere } from "@/lib/mtm/visit-scope"

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

  const visit = await prisma.mtmVisit.findFirst({
    // This workspace performs result/action/checkout mutations. Keep its root
    // record in primary-agent mutation scope; participant-only historical
    // drilldowns remain read-only in the exact detail endpoint.
    where: mutableVisitWhere(actor, auth.orgId, { id }),
    include: {
      agent: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, address: true, category: true, objectType: true } },
      participants: { where: { leftAt: null }, include: { agent: { select: { id: true, name: true } } } },
      requirementSnapshot: {
        include: {
          requirements: { orderBy: [{ mode: "asc" }, { actionKey: "asc" }] },
          sourcePolicy: { select: { id: true, name: true } },
        },
      },
      actionResults: {
        orderBy: { createdAt: "asc" },
        select: { id: true, actionKey: true, status: true, evidence: true },
      },
      photos: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, url: true, status: true },
      },
      route: { select: { id: true, name: true, date: true, status: true } },
      routePoint: { select: { id: true, orderIndex: true, plannedTime: true } },
    },
  })
  if (!visit) return NextResponse.json({ error: "Visit not found", code: "MTM_VISIT_NOT_FOUND" }, { status: 404 })

  const publicParticipants = visit.participants.filter((participant) =>
    participant.role !== "OBSERVER" && isAgentInRouteScope(actor, participant.agentId),
  )
  const scopedAgentIds = actor.scopedAgentIds === null ? null : [...actor.scopedAgentIds]

  const [reminders, previousPromises, previousStockChecks] = await Promise.all([
    prisma.mtmTask.findMany({
      where: {
        organizationId: auth.orgId,
        customerId: visit.customerId,
        ...(scopedAgentIds === null ? {} : { agentId: { in: scopedAgentIds } }),
        deletedAt: null,
        status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] },
        OR: [{ visitId: null }, { visitId: { not: visit.id } }],
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 30,
      select: { id: true, title: true, description: true, status: true, priority: true, dueDate: true, result: true, visitId: true },
    }),
    prisma.mtmVisit.findMany({
      where: mutableVisitWhere(actor, auth.orgId, {
        customerId: visit.customerId,
        id: { not: visit.id },
        status: "CHECKED_OUT",
        OR: [{ nextActionDueAt: { not: null } }, { resultNotes: { not: null } }],
      }),
      orderBy: { checkInAt: "desc" },
      take: 5,
      select: { id: true, checkInAt: true, outcome: true, resultNotes: true, nextActionDueAt: true, agent: { select: { name: true } } },
    }),
    prisma.mtmVisitActionResult.findMany({
      where: {
        organizationId: auth.orgId,
        actionKey: "STOCK_CHECK",
        status: "COMPLETED",
        visit: mutableVisitWhere(actor, auth.orgId, { customerId: visit.customerId, id: { not: visit.id } }),
      },
      orderBy: { completedAt: "desc" },
      take: 10,
      select: { id: true, evidence: true, completedAt: true, visit: { select: { checkInAt: true, agent: { select: { name: true } } } } },
    }),
  ])

  return NextResponse.json({
    success: true,
    data: {
      visit: { ...visit, participants: publicParticipants },
      reminders,
      previousPromises,
      previousStockChecks,
    },
  })
})
