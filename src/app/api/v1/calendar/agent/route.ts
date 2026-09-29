import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { PAGE_SIZE } from "@/lib/constants"
import { withRls } from "@/lib/with-rls"
import type { CalendarItem } from "@/lib/support-calendar/presentation"

interface TicketCalendarRow {
  id: string
  subject: string | null
  status: string
  priority: string
  slaDueAt: Date | null
  createdAt: Date
  assignedTo: string | null
  closedAt: Date | null
}

interface TaskCalendarRow {
  id: string
  title: string | null
  status: string
  priority: string
  dueDate: Date | null
  createdAt: Date
  assignedTo: string | null
  completedAt: Date | null
}

interface EventCalendarRow {
  id: string
  name: string
  status: string
  type: string
  startDate: Date
  endDate: Date | null
  location: string | null
  isOnline: boolean
}

interface ActivityCalendarRow {
  id: string
  subject: string | null
  type: string | null
  scheduledAt: Date | null
  createdAt: Date
  completedAt: Date | null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

// GET /api/v1/calendar/agent?from=2026-03-23&to=2026-03-30
export const GET = withRls(async (req, { orgId }) => {

  const { searchParams } = new URL(req.url)
  const from = searchParams.get("from")
  const to = searchParams.get("to")

  if (!from || !to) {
    return NextResponse.json({ error: "from and to query params required" }, { status: 400 })
  }

  const dateFrom = new Date(from)
  const dateTo = new Date(to)
  dateTo.setHours(23, 59, 59, 999)

  // Today at start of day (for placing open tickets on today)
  const todayStart = new Date()
  todayStart.setHours(9, 0, 0, 0) // Default to 9:00 AM

  const items: CalendarItem[] = []
  const sources = {
    tickets: "ok" as "ok" | "failed",
    tasks: "ok" as "ok" | "failed",
    events: "ok" as "ok" | "failed",
    activities: "ok" as "ok" | "failed",
  }

  // 1. TICKETS — open tickets show on today, closed/resolved show on their date
  try {
    const allTickets = await prisma.ticket.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, subject: true, status: true, priority: true,
        slaDueAt: true, createdAt: true, assignedTo: true, closedAt: true,
      },
      take: PAGE_SIZE.CALENDAR_AGENT,
    }) as TicketCalendarRow[]

    allTickets.forEach((t) => {
      const isOpen = !["closed", "resolved"].includes(t.status)

      if (isOpen) {
        // Open tickets: show as all-day on today
        if (todayStart >= dateFrom && todayStart <= dateTo) {
          const hasSpecificTime = !!t.slaDueAt
          const displayDate = t.slaDueAt || todayStart
          items.push({
            id: t.id,
            type: "ticket",
            title: t.subject || "",
            date: displayDate.toISOString(),
            hour: hasSpecificTime ? new Date(displayDate).getHours() : -1,
            allDay: !hasSpecificTime,
            status: t.status,
            priority: t.priority,
            url: `/tickets/${t.id}`,
          })
        }
      } else {
        // Closed tickets: show on closedAt or createdAt date
        const d = t.closedAt || t.createdAt
        if (d >= dateFrom && d <= dateTo) {
          items.push({
            id: t.id,
            type: "ticket",
            title: t.subject || "",
            date: d.toISOString(),
            hour: d.getHours(),
            status: t.status,
            priority: t.priority,
            url: `/tickets/${t.id}`,
          })
        }
      }
    })
  } catch (e: unknown) {
    sources.tickets = "failed"
    console.error("[calendar] tickets error:", errorMessage(e))
  }

  // 2. TASKS — open tasks on today, completed on completedAt
  try {
    const tasks = await prisma.task.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, title: true, status: true, priority: true,
        dueDate: true, createdAt: true, assignedTo: true, completedAt: true,
      },
      take: PAGE_SIZE.CALENDAR_AGENT,
    }) as TaskCalendarRow[]

    tasks.forEach((t) => {
      const isOpen = !["completed", "cancelled"].includes(t.status)

      if (isOpen) {
        const hasDueDate = !!t.dueDate
        const d = t.dueDate || todayStart
        if (d >= dateFrom && d <= dateTo) {
          items.push({
            id: t.id,
            type: "task",
            title: t.title || "",
            date: d.toISOString(),
            hour: hasDueDate ? new Date(d).getHours() : -1,
            allDay: !hasDueDate,
            status: t.status,
            priority: t.priority,
            url: `/tasks`,
          })
        } else if (todayStart >= dateFrom && todayStart <= dateTo && !hasDueDate) {
          items.push({
            id: t.id,
            type: "task",
            title: t.title || "",
            date: todayStart.toISOString(),
            hour: -1,
            allDay: true,
            status: t.status,
            priority: t.priority,
            url: `/tasks`,
          })
        }
      } else {
        const d = t.completedAt || t.dueDate || t.createdAt
        if (d >= dateFrom && d <= dateTo) {
          items.push({
            id: t.id,
            type: "task",
            title: t.title || "",
            date: d.toISOString(),
            hour: new Date(d).getHours(),
            status: t.status,
            priority: t.priority,
            url: `/tasks`,
          })
        }
      }
    })
  } catch (e: unknown) {
    sources.tasks = "failed"
    console.error("[calendar] tasks error:", errorMessage(e))
  }

  // 3. EVENTS — startDate in range
  try {
    const events = await prisma.event.findMany({
      where: {
        organizationId: orgId,
        startDate: { gte: dateFrom, lte: dateTo },
      },
      select: {
        id: true, name: true, status: true, type: true,
        startDate: true, endDate: true, location: true, isOnline: true,
      },
      take: PAGE_SIZE.DEFAULT,
    }) as EventCalendarRow[]

    events.forEach((ev) => {
      const d = new Date(ev.startDate)
      const endD = ev.endDate ? new Date(ev.endDate) : null
      items.push({
        id: ev.id,
        type: "event",
        title: ev.name,
        date: d.toISOString(),
        endDate: endD?.toISOString(),
        hour: d.getHours(),
        endHour: endD ? endD.getHours() : d.getHours() + 1,
        status: ev.status,
        location: ev.location ?? undefined,
        isOnline: ev.isOnline,
        eventType: ev.type,
        url: `/events/${ev.id}`,
      })
    })
  } catch (e: unknown) {
    sources.events = "failed"
    console.error("[calendar] events error:", errorMessage(e))
  }

  // 4. ACTIVITIES — scheduledAt or createdAt in range
  try {
    const activities = await prisma.activity.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, subject: true, type: true,
        scheduledAt: true, createdAt: true, completedAt: true,
      },
      take: 200,
    }) as ActivityCalendarRow[]

    activities.forEach((a) => {
      const d = a.scheduledAt || a.createdAt
      if (d >= dateFrom && d <= dateTo) {
        items.push({
          id: a.id,
          type: `activity_${a.type || "note"}`,
          title: a.subject || "",
          date: d.toISOString(),
          hour: d.getHours(),
          completed: !!a.completedAt,
        })
      }
    })
  } catch (e: unknown) {
    sources.activities = "failed"
    console.error("[calendar] activities error:", errorMessage(e))
  }

  // Sort by date
  items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const allSourcesFailed = Object.values(sources).every((status) => status === "failed")
  return NextResponse.json({
    success: !allSourcesFailed,
    data: {
      items,
      sources,
      counts: {
        tickets: items.filter(i => i.type === "ticket").length,
        tasks: items.filter(i => i.type === "task").length,
        events: items.filter(i => i.type === "event").length,
        activities: items.filter(i => i.type.startsWith("activity_")).length,
      },
    },
    ...(allSourcesFailed ? { error: "All calendar sources failed.", code: "CALENDAR_SOURCES_FAILED" } : {}),
  }, { status: allSourcesFailed ? 503 : 200 })
})
