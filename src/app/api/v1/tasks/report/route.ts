import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { parseTaskListFilters, buildTaskListWhere } from "@/lib/tasks/list-query"
import { DEFAULT_TASK_TYPES, DEFAULT_EVENT_TYPES } from "@/lib/constants"
import { getFieldPermissions, filterEntityFields } from "@/lib/field-filter"
import { aggregateTasksByGroup, aggregateTasksOverTime, REPORT_GROUP_LABELS, REPORT_GROUP_BYS, type ReportGroupBy } from "@/lib/tasks/report-aggregate"
import type { Role } from "@/lib/permissions"

/**
 * GET /api/v1/tasks/report — operational task report (on-screen view).
 *
 * Returns per-group planned/ongoing/completed/cancelled counts for a chosen
 * dimension. Visibility + filters are IDENTICAL to the task list/export (reuses
 * buildTaskListWhere), and the aggregation is the SAME aggregateTasksByGroup the
 * export summary sheet uses — so the page and the downloaded xlsx agree exactly.
 *   ?groupBy=type|division|assignee|project|status|bucket  (default division)
 *   + every list filter (status/type/assignee/project/divisionId/date/search)
 */

const REPORT_CAP = 50_000

export const GET = withRls(async (req, { orgId, session }) => {
  const role = (session?.role || "admin") as Role
  const userId = session?.userId || ""

  const sp = new URL(req.url).searchParams
  const gbRaw = sp.get("groupBy") || ""
  const groupBy: ReportGroupBy = REPORT_GROUP_BYS.includes(gbRaw as ReportGroupBy) ? (gbRaw as ReportGroupBy) : "division"
  const mode = sp.get("mode") === "timeline" ? "timeline" : "summary"

  try {
    const { where, blocked } = await buildTaskListWhere(orgId, userId, role, parseTaskListFilters(sp))

    const [rawTasks, typeDefs, eventDefs, fieldPerms] = await Promise.all([
      blocked ? Promise.resolve([]) : prisma.task.findMany({
        where,
        take: REPORT_CAP,
        select: {
          type: true,
          eventType: true,
          status: true,
          completedAt: true,
          assignee: { select: { name: true } },
          project: { select: { name: true } },
          division: { select: { name: true, key: true } },
        },
      }),
      prisma.taskType.findMany({ where: { organizationId: orgId }, select: { name: true, displayName: true } }),
      prisma.eventType.findMany({ where: { organizationId: orgId }, select: { name: true, displayName: true } }),
      getFieldPermissions(orgId, role, "task"),
    ])
    // Apply field permissions BEFORE aggregating so a restricted role's report
    // matches the export byte-for-byte: a hidden grouping key (assignee/status/…)
    // folds to the same fallback in both paths — no "screen ≠ file" drift, and no
    // hidden field value leaks as a group label.
    const tasks = rawTasks.map((t: any) => filterEntityFields(t, fieldPerms, role))

    const typeLabel = new Map<string, string>(
      (typeDefs.length ? typeDefs : DEFAULT_TASK_TYPES).map(
        (t: { name: string; displayName: string }) => [t.name, t.displayName] as [string, string],
      ),
    )
    const eventTypeLabel = new Map<string, string>(
      (eventDefs.length ? eventDefs : DEFAULT_EVENT_TYPES).map(
        (t: { name: string; displayName: string }) => [t.name, t.displayName] as [string, string],
      ),
    )

    const truncated = tasks.length >= REPORT_CAP

    if (mode === "timeline") {
      const { periods, rows, totalsByPeriod } = aggregateTasksOverTime(tasks, groupBy, typeLabel, eventTypeLabel)
      return NextResponse.json({
        success: true,
        data: { mode, groupBy, groupLabel: REPORT_GROUP_LABELS[groupBy], periods, rows, totalsByPeriod, truncated },
      })
    }

    const { rows, totals } = aggregateTasksByGroup(tasks, groupBy, typeLabel, eventTypeLabel)
    return NextResponse.json({
      success: true,
      data: { mode, groupBy, groupLabel: REPORT_GROUP_LABELS[groupBy], rows, totals, truncated },
    })
  } catch (e) {
    console.error("[tasks report]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
