import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { isManager } from "@/lib/leaderboard/visibility"
import {
  AGENT_DESKTOP_PERIOD_DAYS,
  TERMINAL_TICKET_STATUSES,
  agentDesktopPeriod,
  calculateAgentDesktopMetrics,
  compareAgentQueueRows,
} from "@/lib/ticketing/agent-desktop"

// Keep the workbench focused: the complete queue remains one click away.
const QUEUE_PREVIEW_LIMIT = 8

export const GET = withRlsAuth("tickets", "read", async (_req, auth) => {
  const now = new Date()
  const period = agentDesktopPeriod(now)
  const activeWhere = {
    organizationId: auth.orgId,
    assignedTo: auth.userId,
    status: { notIn: [...TERMINAL_TICKET_STATUSES] },
  }

  try {
    const [activeRows, cohortRows, priorityGroups] = await Promise.all([
      prisma.ticket.findMany({
        where: activeWhere,
        select: {
          id: true,
          ticketNumber: true,
          subject: true,
          priority: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          slaFirstResponseDueAt: true,
          slaDueAt: true,
          firstResponseAt: true,
        },
      }),
      prisma.ticket.findMany({
        where: {
          organizationId: auth.orgId,
          assignedTo: auth.userId,
          createdAt: { gte: period.from, lte: period.to },
        },
        select: {
          createdAt: true,
          firstResponseAt: true,
          resolvedAt: true,
          slaFirstResponseDueAt: true,
          slaDueAt: true,
          satisfactionRating: true,
        },
      }),
      prisma.ticket.groupBy({
        by: ["priority"],
        where: activeWhere,
        _count: true,
      }),
    ])

    const sortedQueue = [...activeRows].sort(compareAgentQueueRows)
    const queue = sortedQueue.slice(0, QUEUE_PREVIEW_LIMIT).map((ticket) => {
      const actionableDueAt = !ticket.firstResponseAt && ticket.slaFirstResponseDueAt
        ? ticket.slaFirstResponseDueAt
        : ticket.slaDueAt
      return {
        ...ticket,
        actionableDueAt,
        isOverdue: Boolean(actionableDueAt && actionableDueAt <= now),
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        scope: "assigned_to_current_user",
        period: {
          key: "rolling_30_days",
          days: AGENT_DESKTOP_PERIOD_DAYS,
          from: period.from.toISOString(),
          to: period.to.toISOString(),
        },
        queue: {
          total: activeRows.length,
          shown: queue.length,
          nextTicket: queue[0] ?? null,
          tickets: queue,
          byPriority: Object.fromEntries(
            priorityGroups.map((group) => [group.priority, group._count]),
          ),
        },
        metrics: calculateAgentDesktopMetrics(cohortRows, now),
        canViewTeamAnalytics: isManager(auth.role),
      },
    })
  } catch (error) {
    console.error("[support/agent-desktop GET]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
