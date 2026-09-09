import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"

const MAX_SLOTS = 40

const MeetingAvailabilitySchema = z.object({
  date: z.string().date(),
  excludeRouteId: z.string().min(1).max(128).optional(),
  agentIds: z.array(z.string().min(1).max(128)).max(20).default([]),
  slots: z.array(z.object({
    customerId: z.string().min(1).max(128),
    contactId: z.string().min(1).max(128).optional().nullable(),
    plannedTime: z.string().datetime({ offset: true }),
  })).min(1).max(MAX_SLOTS),
})

function forbidden() {
  return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" }, { status: 403 })
}

function dayWindow(date: string) {
  const start = new Date(`${date}T00:00:00.000Z`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { start, end }
}

function visibleRouteWhere(
  actor: MtmRouteActor,
  organizationId: string,
  teamId: string | null,
  teamScheduleVisibilityEnabled: boolean,
): Prisma.MtmRouteWhereInput {
  if (actor.role === "ADMIN") return {}

  if (actor.role === "AGENT") {
    if (!actor.agentId) return { id: "__no_access__" }
    const ownRoute: Prisma.MtmRouteWhereInput = {
      OR: [
        { agentId: actor.agentId },
        { assignments: { some: { organizationId, agentId: actor.agentId, removedAt: null } } },
      ],
    }
    if (!teamScheduleVisibilityEnabled || !teamId) return ownRoute

    // The tenant opt-in exposes only the name and time of teammates' published
    // visits. It deliberately does not relax access to route notes, phone
    // numbers, GPS, or non-team schedules.
    return {
      OR: [
        ...ownRoute.OR!,
        {
          agent: {
            organizationId,
            teamId,
            status: "ACTIVE",
            role: "AGENT",
          },
        },
      ],
    }
  }

  const scopedAgentIds = [...(actor.scopedAgentIds ?? [])]
  if (!scopedAgentIds.length) return { id: "__no_access__" }
  return {
    OR: [
      { agentId: { in: scopedAgentIds } },
      { assignments: { some: { organizationId, agentId: { in: scopedAgentIds }, removedAt: null } } },
    ],
  }
}

/**
 * POST /api/v1/mtm/routes/meeting-availability
 *
 * Returns a deliberately narrow Scheduling Assistant feed. It is used while
 * making a draft, before any data changes: callers can see whether a selected
 * employee is already occupied and whether another authorized teammate has
 * the same customer at that time. The endpoint never exposes notes, phones,
 * GPS, or private route data.
 */
export const POST = withRouteFieldRlsAuth("read", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return forbidden()

  const parsed = MeetingAvailabilitySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid meeting availability request", code: "MTM_MEETING_AVAILABILITY_INVALID" }, { status: 400 })
  }

  const requestedSlots = parsed.data.slots.map((slot) => ({
    ...slot,
    contactId: slot.contactId ?? null,
    plannedTime: new Date(slot.plannedTime),
  }))
  if (requestedSlots.some((slot) => Number.isNaN(slot.plannedTime.getTime()))) {
    return NextResponse.json({ error: "Invalid meeting time", code: "MTM_MEETING_TIME_INVALID" }, { status: 400 })
  }

  const settings = await getMtmSettings(auth.orgId)
  const actorTeam = actor.role === "AGENT" && actor.agentId
    ? await prisma.mtmAgent.findFirst({
        where: { id: actor.agentId, organizationId: auth.orgId, status: "ACTIVE" },
        select: { teamId: true },
      })
    : null
  const { start, end } = dayWindow(parsed.data.date)
  const requestedAgentIds = new Set(parsed.data.agentIds)
  const routeVisibility = visibleRouteWhere(
    actor,
    auth.orgId,
    actorTeam?.teamId ?? null,
    settings.teamScheduleVisibilityEnabled,
  )

  const baseRouteScope: Prisma.MtmRouteWhereInput = {
    organizationId: auth.orgId,
    deletedAt: null,
    status: { in: ["PLANNED", "IN_PROGRESS"] },
    date: { gte: start, lt: end },
    ...(parsed.data.excludeRouteId ? { id: { not: parsed.data.excludeRouteId } } : {}),
  }
  const routeScope: Prisma.MtmRouteWhereInput = { ...baseRouteScope, ...routeVisibility }
  const pointSelect = {
    customerId: true,
    contactId: true,
    plannedTime: true,
    route: {
      select: {
        id: true,
        agentId: true,
        agent: { select: { id: true, name: true } },
        assignments: {
          where: { removedAt: null },
          select: { agentId: true, agent: { select: { id: true, name: true } } },
        },
      },
    },
  } satisfies Prisma.MtmRoutePointSelect
  const requestedTimes = [...new Set(requestedSlots.map((slot) => slot.plannedTime.getTime()))].map((time) => new Date(time))

  const [customerRows, busyAgentRows] = await Promise.all([
    prisma.mtmRoutePoint.findMany({
      where: {
        organizationId: auth.orgId,
        deletedAt: null,
        customerId: { in: [...new Set(requestedSlots.map((slot) => slot.customerId))] },
        plannedTime: { in: requestedTimes },
        route: routeScope,
      },
      select: pointSelect,
    }),
    requestedAgentIds.size > 0
      ? prisma.mtmRoutePoint.findMany({
        where: {
          organizationId: auth.orgId,
          deletedAt: null,
          plannedTime: { in: requestedTimes },
          route: {
            ...baseRouteScope,
            AND: [
              routeVisibility,
              {
                OR: [
                  { agentId: { in: [...requestedAgentIds] } },
                  { assignments: { some: { organizationId: auth.orgId, agentId: { in: [...requestedAgentIds] }, removedAt: null } } },
                ],
              },
            ],
          },
        },
        select: pointSelect,
      })
      : Promise.resolve([]),
  ])

  const meetings = requestedSlots.map((slot) => {
    const matchingRows = customerRows.filter((row) => (
      row.customerId === slot.customerId
      && row.plannedTime?.getTime() === slot.plannedTime.getTime()
    ))
    const busyRows = busyAgentRows.filter((row) => row.plannedTime?.getTime() === slot.plannedTime.getTime())
    const busyAgents = new Map<string, { id: string; name: string }>()
    for (const row of busyRows) {
      const routeAgents = [
        row.route.agent,
        ...row.route.assignments.map((assignment) => assignment.agent),
      ]
      for (const agent of routeAgents) {
        if (requestedAgentIds.has(agent.id)) busyAgents.set(agent.id, agent)
      }
    }
    const uniqueRoutes = new Map(matchingRows.map((row) => [row.route.id, row]))
    return {
      customerId: slot.customerId,
      contactId: slot.contactId,
      plannedTime: slot.plannedTime.toISOString(),
      busyAgents: [...busyAgents.values()],
      meetings: [...uniqueRoutes.values()].map((row) => ({
        routeId: row.route.id,
        // A joint route can have several active agents. Return only their
        // display names and IDs so the scheduling assistant remains useful
        // without exposing any private route content.
        agents: [...new Map([
          [row.route.agent.id, row.route.agent],
          ...row.route.assignments.map((assignment) => [assignment.agent.id, assignment.agent] as const),
        ]).values()],
        sameContact: Boolean(slot.contactId && row.contactId === slot.contactId),
      })),
    }
  })

  return NextResponse.json({
    success: true,
    data: {
      meetings,
      teamScheduleVisibilityEnabled: settings.teamScheduleVisibilityEnabled,
    },
  })
})
