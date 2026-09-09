import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { parseTaskListFilters, buildTaskListWhere, statusBucketLabel } from "@/lib/tasks/list-query"
import { getFieldPermissions, filterEntityFields } from "@/lib/field-filter"
import { DEFAULT_TASK_TYPES, DEFAULT_EVENT_TYPES } from "@/lib/constants"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { buildXlsxWorkbook, toCsv, contentDispositionAttachment, type SheetSpec } from "@/lib/export/tabular"
import { reportGroupValue, aggregateTasksByGroup, REPORT_GROUP_LABELS, REPORT_GROUP_BYS, type ReportGroupBy } from "@/lib/tasks/report-aggregate"
import type { Role } from "@/lib/permissions"

/**
 * GET /api/v1/tasks/export — Excel(.xlsx) or CSV export of the task list.
 *
 * Visibility is IDENTICAL to GET /api/v1/tasks: it reuses buildTaskListWhere
 * (org scope + sharing-rules + board access) + per-row field permissions, so the
 * export can never leak a task the list would hide. Honors every list filter via
 * query params, plus:
 *   ?format=xlsx|csv   (default xlsx)
 *   ?groupBy=type|division|assignee|project|status|bucket  (adds a Summary sheet)
 * Functional "category" = task type (group/filter by ?type / ?groupBy=type);
 * brand etc. ride along as task custom-field columns.
 */

const EXPORT_CAP = 50_000

function isoDate(d: Date | string | null | undefined): string {
  if (!d) return ""
  const dt = d instanceof Date ? d : new Date(d)
  return isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10)
}

export const GET = withRls(async (req, { orgId, session }) => {
  const role = (session?.role || "admin") as Role
  const userId = session?.userId || ""

  const sp = new URL(req.url).searchParams
  const format = (sp.get("format") || "xlsx").toLowerCase() === "csv" ? "csv" : "xlsx"
  const groupByRaw = sp.get("groupBy") || ""
  const groupBy: ReportGroupBy | null = REPORT_GROUP_BYS.includes(groupByRaw as ReportGroupBy)
    ? (groupByRaw as ReportGroupBy) : null

  try {
    const { where, blocked } = await buildTaskListWhere(orgId, userId, role, parseTaskListFilters(sp))

    // Load tasks (capped), the type-label map, the task custom-field columns, and
    // the field permissions — all in parallel.
    const [rawTasks, typeDefs, eventDefs, customFields, fieldPerms] = await Promise.all([
      blocked ? Promise.resolve([]) : prisma.task.findMany({
        where,
        take: EXPORT_CAP,
        orderBy: { dueDate: "asc" },
        include: {
          assignee: { select: { name: true } },
          project: { select: { name: true } },
          division: { select: { name: true, key: true } },
        },
      }),
      prisma.taskType.findMany({ where: { organizationId: orgId }, select: { name: true, displayName: true } }),
      prisma.eventType.findMany({ where: { organizationId: orgId }, select: { name: true, displayName: true } }),
      prisma.customField.findMany({
        where: { organizationId: orgId, entityType: "task", isActive: true },
        orderBy: { sortOrder: "asc" },
        select: { fieldName: true, fieldLabel: true },
      }),
      getFieldPermissions(orgId, role, "task"),
    ])

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

    // Build the flat detail table. Field permissions are applied per row so a
    // restricted role exports blanks for fields it can't read.
    const baseHeaders = [
      "Key", "Title", "Type", "Event type", "Status", "Stage", "Priority", "Assignee",
      "Project", "Board / Department", "Due date", "Created", "Completed",
      "Period", "Est. hours", "Est. price",
    ]
    const cfHeaders = customFields.map((c: { fieldName: string; fieldLabel: string }) => c.fieldLabel)
    const headers = [...baseHeaders, ...cfHeaders]

    const groupValue = (t: any): string => (groupBy ? reportGroupValue(t, groupBy, typeLabel, eventTypeLabel) : "")

    const tasks = rawTasks
      .map((t: any) => filterEntityFields(t, fieldPerms, role))
      .sort((a: any, b: any) => (groupBy ? groupValue(a).localeCompare(groupValue(b)) : 0))

    const rows: unknown[][] = tasks.map((t: any) => {
      const cf = (t.customFields ?? {}) as Record<string, unknown>
      return [
        t.taskKey ?? "",
        t.title ?? "",
        typeLabel.get(t.type ?? "") || t.type || "",
        eventTypeLabel.get(t.eventType ?? "") || t.eventType || "",
        t.status ?? "",
        statusBucketLabel(t.status ?? ""),
        t.priority ?? "",
        t.assignee?.name ?? "",
        t.project?.name ?? "",
        t.division ? `${t.division.key} — ${t.division.name}` : "",
        isoDate(t.dueDate),
        isoDate(t.createdAt),
        isoDate(t.completedAt),
        t.category ?? "",
        t.estimatedHours != null ? decimalToNumber(t.estimatedHours) : "",
        t.estimatedPrice != null ? decimalToNumber(t.estimatedPrice) : "",
        ...customFields.map((c: { fieldName: string; fieldLabel: string }) => {
          const v = cf[c.fieldName]
          return v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v)
        }),
      ]
    })

    const stamp = isoDate(new Date())
    const baseName = `tasks-export-${stamp}${groupBy ? `-by-${groupBy}` : ""}`

    // Optional grouped summary (counts + completed/ongoing/planned split).
    const sheets: SheetSpec[] = [{ name: "Tasks", headers, rows }]
    if (groupBy) {
      const { rows: aggRows, totals } = aggregateTasksByGroup(tasks, groupBy, typeLabel, eventTypeLabel)
      const summaryRows: unknown[][] = aggRows.map((r) => [r.group, r.total, r.planned, r.ongoing, r.completed, r.cancelled])
      summaryRows.push([totals.group, totals.total, totals.planned, totals.ongoing, totals.completed, totals.cancelled])
      sheets.unshift({
        name: `Summary by ${groupBy}`,
        headers: [REPORT_GROUP_LABELS[groupBy], "Total", "Planned", "Ongoing", "Completed", "Cancelled"],
        rows: summaryRows,
      })
    }

    const truncated = rawTasks.length >= EXPORT_CAP
    if (format === "csv") {
      // CSV is a single flat table (the detail sheet); grouping is conveyed by
      // the sorted order + the Stage column.
      const csv = toCsv(headers, rows)
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": contentDispositionAttachment(`${baseName}.csv`),
          ...(truncated ? { "X-Export-Truncated": String(EXPORT_CAP) } : {}),
        },
      })
    }

    const buffer = await buildXlsxWorkbook(sheets).xlsx.writeBuffer()
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": contentDispositionAttachment(`${baseName}.xlsx`),
        ...(truncated ? { "X-Export-Truncated": String(EXPORT_CAP) } : {}),
      },
    })
  } catch (e) {
    console.error("[tasks export]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
