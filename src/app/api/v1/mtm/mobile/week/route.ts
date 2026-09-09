import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withNormalizedCoordinates } from "@/lib/mtm/geo-coordinates"
import { getMtmSettings } from "@/lib/mtm-settings"
import {
  addDateKeyDays,
  currentDateKey,
  effectiveRoutePointStatus,
  effectiveRouteStatus,
  isDateKey,
  isWeekendDateKey,
  localDateKeyToUtc,
  startOfIsoWeekDateKey,
  type PersistedRouteStatus,
} from "@/lib/mtm/mobile-week"
import { dateInputValueInTimezone, isValidTimezone } from "@/lib/timezone"
import { withMobileRls } from "@/lib/with-mobile-rls"
import {
  resolveWorkCalendarDay,
  type WorkCalendarOverride,
} from "@/lib/mtm/work-calendar"
import { resolveMtmVisitPolicy, type ResolvedVisitPolicy } from "@/lib/mtm/visit-policies"
import {
  isOperationalAnnouncementActive,
  localizedOperationalText,
  operationalLocale,
  parseOperationalAnnouncementMetadata,
} from "@/lib/mtm/operational-announcement"

type AssignmentRole = "PRIMARY" | "PARTICIPANT" | "OBSERVER"

type WeekRouteRow = {
  id: string
  name: string | null
  date: Date
  status: PersistedRouteStatus
  version: number
  agentId: string
  totalPoints: number
  visitedPoints: number
  startedAt: Date | null
  completedAt: Date | null
  notes: string | null
  assignments: Array<{
    agentId: string
    role: AssignmentRole
    assignedAt: Date
    agent: { id: string; name: string; role: string }
  }>
  points: Array<{
    id: string
    customerId: string
    contactId: string | null
    orderIndex: number
    status: string
    plannedTime: Date | null
    visitedAt: Date | null
    notes: string | null
    customer: {
      id: string
      name: string
      code: string | null
      objectType: string
      category: string
      address: string | null
      city: string | null
      phone: string | null
      latitude: number | null
      longitude: number | null
    }
    contact: {
      id: string
      displayName: string
      type: string
      specialtyName: string | null
      phone: string | null
    } | null
  }>
}

type WeekTaskRow = {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  dueDate: Date | null
  completedAt: Date | null
  customer: { id: string; name: string } | null
}

type WeekVisitRow = {
  id: string
  customerId: string
  contactId: string | null
  routeId: string | null
  routePointId: string | null
  status: string
  checkInAt: Date
  checkOutAt: Date | null
  outcome: string | null
  potential: string | null
  notes: string | null
  resultNotes: string | null
  customer: { id: string; name: string; objectType: string }
  contact: { id: string; displayName: string; type: string } | null
}

function routeSubjectKey(customerId: string, contactId: string | null): string {
  return contactId ? `contact:${contactId}` : `customer:${customerId}`
}

function inWeek(dateKey: string, weekStart: string, weekEndExclusive: string): boolean {
  return dateKey >= weekStart && dateKey < weekEndExclusive
}

function operationalRoute(status: PersistedRouteStatus): boolean {
  return status !== "DRAFT" && status !== "CANCELLED"
}

/**
 * Whether the agent may still work this route. INCOMPLETE stays operational for
 * counting — the stops were planned and belong in the week's coverage, and
 * dropping them would make a failed day look like a day with nothing planned —
 * but the server has closed it, so the app must stop offering to execute it.
 */
function executableRoute(status: PersistedRouteStatus): boolean {
  return operationalRoute(status) && status !== "INCOMPLETE"
}

/**
 * GET /api/v1/mtm/mobile/week?start=YYYY-MM-DD
 *
 * Agent-scoped, organization-local seven-day contract used by the new mobile
 * week screen. `start` may be any day; the response always starts on Monday.
 * MISSED is derived for display and never overwrites the persisted route state.
 */
export const GET = withMobileRls(async (req, auth) => {
  try {
    const [settings, agent] = await Promise.all([
      getMtmSettings(auth.orgId),
      prisma.mtmAgent.findFirst({
        where: { id: auth.agentId, organizationId: auth.orgId, status: "ACTIVE" },
        select: { id: true, teamId: true, role: true, canPlanOwnRoutes: true, canSelfPublishRoutes: true },
      }),
    ])
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    }
    const canPlanOwnRoutes = agent.role !== "AGENT" || agent.canPlanOwnRoutes
    const canSelfPublishRoutes = agent.role !== "AGENT" || (
      canPlanOwnRoutes
      && agent.canSelfPublishRoutes === true
      && settings.routeSelfPublish
    )
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const today = currentDateKey(new Date(), timezone)
    const requestedDate = new URL(req.url).searchParams.get("start") ?? today

    if (!isDateKey(requestedDate)) {
      return NextResponse.json({
        error: "Invalid `start` parameter; expected YYYY-MM-DD",
        code: "MTM_WEEK_START_INVALID",
      }, { status: 400 })
    }

    const weekStart = startOfIsoWeekDateKey(requestedDate)
    const weekEndExclusive = addDateKeyDays(weekStart, 7)
    const routeStart = new Date(`${weekStart}T00:00:00.000Z`)
    const routeEnd = new Date(`${weekEndExclusive}T00:00:00.000Z`)
    const activityStart = localDateKeyToUtc(weekStart, timezone)
    const activityEnd = localDateKeyToUtc(weekEndExclusive, timezone)

    const [routesRaw, tasksRaw, visitsRaw, calendarOverridesRaw] = await Promise.all([
      prisma.mtmRoute.findMany({
        where: {
          organizationId: auth.orgId,
          OR: [
            { agentId: auth.agentId },
            { assignments: { some: { agentId: auth.agentId, removedAt: null } } },
          ],
          date: { gte: routeStart, lt: routeEnd },
          deletedAt: null,
        },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          date: true,
          status: true,
          version: true,
          publishedVersion: true,
          publishedAt: true,
          agentId: true,
          totalPoints: true,
          visitedPoints: true,
          startedAt: true,
          completedAt: true,
          notes: true,
          assignments: {
            where: { removedAt: null },
            orderBy: { assignedAt: "asc" },
            select: {
              agentId: true,
              role: true,
              assignedAt: true,
              agent: { select: { id: true, name: true, role: true } },
            },
          },
          points: {
            where: { deletedAt: null },
            orderBy: { orderIndex: "asc" },
            select: {
              id: true,
              customerId: true,
              contactId: true,
              orderIndex: true,
              status: true,
              plannedTime: true,
              visitedAt: true,
              notes: true,
              customer: {
                select: {
                  id: true,
                  name: true,
                  code: true,
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
            },
          },
        },
      }),
      prisma.mtmTask.findMany({
        where: {
          organizationId: auth.orgId,
          agentId: auth.agentId,
          deletedAt: null,
          OR: [
            { dueDate: { gte: activityStart, lt: activityEnd } },
            { completedAt: { gte: activityStart, lt: activityEnd } },
          ],
        },
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          dueDate: true,
          completedAt: true,
          customer: { select: { id: true, name: true } },
        },
      }),
      prisma.mtmVisit.findMany({
        where: {
          organizationId: auth.orgId,
          agentId: auth.agentId,
          deletedAt: null,
          checkInAt: { gte: activityStart, lt: activityEnd },
        },
        orderBy: { checkInAt: "asc" },
        select: {
          id: true,
          customerId: true,
          contactId: true,
          routeId: true,
          routePointId: true,
          status: true,
          checkInAt: true,
          checkOutAt: true,
          outcome: true,
          potential: true,
          notes: true,
          resultNotes: true,
          customer: { select: { id: true, name: true, objectType: true } },
          contact: { select: { id: true, displayName: true, type: true } },
        },
      }),
      prisma.mtmWorkCalendarDay.findMany({
        where: {
          organizationId: auth.orgId,
          date: { gte: routeStart, lt: routeEnd },
          deletedAt: null,
          OR: [
            { teamId: null, agentId: null },
            ...(agent.teamId ? [{ teamId: agent.teamId, agentId: null }] : []),
            { teamId: null, agentId: auth.agentId },
          ],
        },
        orderBy: { date: "asc" },
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
      }),
    ])

    const routes = routesRaw as WeekRouteRow[]
    const tasks = tasksRaw as WeekTaskRow[]
    const visits = visitsRaw as WeekVisitRow[]
    const calendarOverrides = calendarOverridesRaw as WorkCalendarOverride[]
    const policyTargets = new Map<string, { customerId: string; at: Date }>()
    for (const route of routes) {
      for (const point of route.points) {
        const key = `${route.date.toISOString().slice(0, 10)}:${point.customerId}`
        policyTargets.set(key, { customerId: point.customerId, at: route.date })
      }
    }
    const visitPolicies = new Map<string, ResolvedVisitPolicy>()
    await Promise.all([...policyTargets.entries()].map(async ([key, target]) => {
      const policy = await resolveMtmVisitPolicy(prisma, {
        organizationId: auth.orgId,
        agentId: auth.agentId,
        customerId: target.customerId,
        at: target.at,
      })
      visitPolicies.set(key, policy)
    }))
    const calendarByDay = new Map(Array.from({ length: 7 }, (_, index) => {
      const date = addDateKeyDays(weekStart, index)
      return [date, resolveWorkCalendarDay({
        date,
        overrides: calendarOverrides,
        teamId: agent.teamId,
        agentId: auth.agentId,
      })] as const
    }))
    const routesByDay = new Map<string, Array<Record<string, unknown>>>()
    const tasksByDay = new Map<string, WeekTaskRow[]>()
    const visitsByDay = new Map<string, WeekVisitRow[]>()
    const plannedSubjectIds = new Set<string>()
    const coveredSubjectIds = new Set<string>()
    let plannedStops = 0
    let visitedStops = 0
    let missedStops = 0
    let draftRoutes = 0

    for (const route of routes) {
      const date = route.date.toISOString().slice(0, 10)
      const calendarDay = calendarByDay.get(date) ?? null
      const effectiveStatus = effectiveRouteStatus(route, today, calendarDay)
      const assignmentRole: AssignmentRole | null = route.agentId === auth.agentId
        ? "PRIMARY"
        : route.assignments.find((assignment) => assignment.agentId === auth.agentId)?.role ?? null
      const isOperational = operationalRoute(route.status)
      if (route.status === "DRAFT") draftRoutes += 1

      const points = route.points.map((point) => {
        const pointEffectiveStatus = effectiveRoutePointStatus(point.status, effectiveStatus)
        if (isOperational) {
          const subject = routeSubjectKey(point.customerId, point.contactId)
          plannedStops += 1
          plannedSubjectIds.add(subject)
          if (pointEffectiveStatus === "VISITED") {
            visitedStops += 1
            coveredSubjectIds.add(subject)
          } else if (pointEffectiveStatus === "MISSED") {
            missedStops += 1
          }
        }
        return {
          ...point,
          // A row written before the coordinates migration can still hold the
          // (0, 0) pair. Read paths re-apply the rule so the field app never
          // draws a stop in the Gulf of Guinea or shows 6745 km to it
          // (src/lib/mtm/geo-coordinates.ts).
          customer: withNormalizedCoordinates(point.customer),
          effectiveStatus: pointEffectiveStatus,
          visitPolicy: visitPolicies.get(`${date}:${point.customerId}`) ?? null,
        }
      })

      const canEdit = route.agentId === auth.agentId && route.status === "DRAFT" && canPlanOwnRoutes
      const transformed = {
        ...route,
        date,
        persistedStatus: route.status,
        effectiveStatus,
        assignmentRole,
        canExecute: assignmentRole !== null && assignmentRole !== "OBSERVER" && executableRoute(route.status),
        canEdit,
        canPublish: canEdit && canSelfPublishRoutes,
        points,
      }
      routesByDay.set(date, [...(routesByDay.get(date) ?? []), transformed])
    }

    for (const task of tasks) {
      const dueDateKey = task.dueDate ? dateInputValueInTimezone(task.dueDate, timezone) : ""
      const completedDateKey = task.completedAt
        ? dateInputValueInTimezone(task.completedAt, timezone)
        : ""
      const date = inWeek(dueDateKey, weekStart, weekEndExclusive)
        ? dueDateKey
        : completedDateKey
      if (inWeek(date, weekStart, weekEndExclusive)) {
        tasksByDay.set(date, [...(tasksByDay.get(date) ?? []), task])
      }
    }

    for (const visit of visits) {
      const date = dateInputValueInTimezone(visit.checkInAt, timezone)
      visitsByDay.set(date, [...(visitsByDay.get(date) ?? []), visit])
      const subject = routeSubjectKey(visit.customerId, visit.contactId)
      if (visit.status === "CHECKED_OUT" && plannedSubjectIds.has(subject)) {
        coveredSubjectIds.add(subject)
      }
    }

    const days = Array.from({ length: 7 }, (_, index) => {
      const date = addDateKeyDays(weekStart, index)
      const isWeekend = isWeekendDateKey(date)
      const calendarDay = calendarByDay.get(date)!
      const dayTasks = tasksByDay.get(date) ?? []
      const dayVisits = visitsByDay.get(date) ?? []
      return {
        date,
        isToday: date === today,
        isWeekend,
        isWorkingDay: calendarDay.isWorkingDay,
        // A tenant's own holiday name is copy; the enum kind is not (audit
        // M-10). The app labels `calendarKind` through its dictionary.
        nonWorkingReason: calendarDay.isWorkingDay ? null : calendarDay.name ?? null,
        calendarKind: calendarDay.kind,
        calendarSource: calendarDay.source,
        calendarOverrideId: calendarDay.overrideId,
        movedToDate: calendarDay.movedToDate,
        routePlanningAllowed: calendarDay.routePlanningAllowed,
        routes: routesByDay.get(date) ?? [],
        tasks: {
          total: dayTasks.length,
          completed: dayTasks.filter((task) => task.status === "COMPLETED").length,
          overdue: dayTasks.filter((task) => task.status === "OVERDUE").length,
          items: dayTasks,
        },
        visits: {
          total: dayVisits.length,
          completed: dayVisits.filter((visit) => visit.status === "CHECKED_OUT").length,
          items: dayVisits,
        },
      }
    })

    const coveredPlannedCustomers = [...coveredSubjectIds]
      .filter((subject) => plannedSubjectIds.has(subject)).length
    const coveragePercentage = plannedSubjectIds.size === 0
      ? 0
      : Math.round((coveredPlannedCustomers / plannedSubjectIds.size) * 1_000) / 10
    const announcementNotifications = await prisma.mtmNotification.findMany({
      where: { organizationId: auth.orgId, agentId: auth.agentId, type: "announcement" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, title: true, body: true, metadata: true, createdAt: true },
    })
    const activeAnnouncement = announcementNotifications
      .map((notification) => ({
        notification,
        metadata: parseOperationalAnnouncementMetadata(notification.metadata),
      }))
      .find((entry) => entry.metadata && isOperationalAnnouncementActive(entry.metadata))
    const announcementReceipt = activeAnnouncement?.metadata
      ? await prisma.mtmMessageReceipt.findFirst({
          where: {
            organizationId: auth.orgId,
            agentId: auth.agentId,
            messageId: activeAnnouncement.metadata.messageId,
            type: "ACKNOWLEDGED",
          },
          select: { occurredAt: true },
        })
      : null
    const locale = operationalLocale(new URL(req.url).searchParams.get("locale") || req.headers.get("accept-language"))

    return NextResponse.json({
      success: true,
      data: {
        protocolVersion: 2,
        timezone,
        weekStart,
        weekEndExclusive,
        today,
        calendarSource: "WORK_CALENDAR_V1",
        days,
        summary: {
          routes: routes.length,
          draftRoutes,
          plannedStops,
          visitedStops,
          missedStops,
          tasks: tasks.length,
          tasksCompleted: tasks.filter((task) => task.status === "COMPLETED").length,
          visits: visits.length,
          visitsCompleted: visits.filter((visit) => visit.status === "CHECKED_OUT").length,
          coverage: {
            plannedCustomers: plannedSubjectIds.size,
            coveredCustomers: coveredPlannedCustomers,
            percentage: coveragePercentage,
          },
        },
        capabilities: {
          createOwnDraft: canPlanOwnRoutes,
          editOwnDraft: canPlanOwnRoutes,
          selfPublish: canSelfPublishRoutes,
          requestRouteChange: true,
          requestCustomer: true,
        },
        operational: {
          announcement: activeAnnouncement?.metadata ? {
            notificationId: activeAnnouncement.notification.id,
            messageId: activeAnnouncement.metadata.messageId,
            threadId: activeAnnouncement.metadata.threadId,
            title: activeAnnouncement.notification.title,
            body: localizedOperationalText(
              activeAnnouncement.metadata,
              activeAnnouncement.notification.body || "",
              locale,
            ),
            effectiveFrom: activeAnnouncement.metadata.effectiveFrom,
            effectiveUntil: activeAnnouncement.metadata.effectiveUntil,
            acknowledgementRequired: true,
            acknowledgedAt: announcementReceipt?.occurredAt ?? null,
          } : null,
          support: {
            email: settings.supportEmail || null,
            phone: settings.supportPhone || null,
          },
        },
      },
    })
  } catch (error) {
    console.error("[MTM/mobile/week GET]", error)
    return NextResponse.json({ error: "Failed to load mobile week" }, { status: 500 })
  }
})
