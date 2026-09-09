/**
 * loadBoardReportBundle — the single source of truth for a board's / department's
 * report data: org-scoping, board-access gating, department section-aggregation,
 * and the Tier-1 (+ optional Tier-2 flow) analytics computation.
 *
 * Extracted from GET /api/v1/divisions/[id]/analytics so the on-screen report AND
 * the PPTX export share IDENTICAL scoping — the export can never surface data the
 * report would hide (same security property as buildTaskListWhere for lists).
 */
import { prisma } from "@/lib/prisma"
import { getAccessibleDivisionIds } from "./board-access"
import { getDepartmentSectionIds } from "./board-hierarchy"
import {
  computeTier1Analytics, computeValueRollup, computeBurnup, computeMonteCarlo,
  rangeToDays, type AnalyticsTask, type AnalyticsColumn,
} from "./board-analytics"
import { CANONICAL_STAGES, STAGE_LABELS } from "./board-columns"
import { computeFlowMetrics, computeCfd, computeReopened, computeSla, DEFAULT_SLA_TARGET_DAYS } from "./board-flow"
import type { Role } from "@/lib/permissions"

export interface BoardReportBundleOpts {
  range?: string | null
  assignee?: string | null
  type?: string | null
  /** Department section filter (comma-separated ids); ignored for a normal board. */
  sections?: string | null
  /** Include Tier-2 flow metrics (cycle/lead time, CFD, rework, SLA). */
  withFlow?: boolean
}

export interface BoardReportBundleMeta {
  id: string
  name: string
  key: string
  isDepartment: boolean
}

export type LoadBoardReportBundleResult =
  | { ok: false; status: 404 }
  | { ok: true; meta: BoardReportBundleMeta; data: Record<string, unknown> }

export async function loadBoardReportBundle(
  orgId: string,
  userId: string,
  role: Role,
  id: string,
  opts: BoardReportBundleOpts,
): Promise<LoadBoardReportBundleResult> {
  const division = await prisma.division.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, name: true, key: true, slaTargetDays: true, isDepartment: true },
  })
  if (!division) return { ok: false, status: 404 }

  const accessible = await getAccessibleDivisionIds(prisma, orgId, userId, role)

  // Resolve the set of section ids to aggregate over. Normal board → [id];
  // department → active child sections ∩ accessible, optionally narrowed by ?sections.
  let targetDivisionIds: string[]
  if (division.isDepartment) {
    const childIds = await getDepartmentSectionIds(prisma, orgId, id)
    const visible = accessible === "all" ? childIds : childIds.filter((c) => accessible.includes(c))
    const canOpen = accessible === "all" || accessible.includes(id) || visible.length > 0
    if (!canOpen) return { ok: false, status: 404 }
    const requested = (opts.sections || "").split(",").map((s) => s.trim()).filter(Boolean)
    targetDivisionIds = requested.length ? visible.filter((v) => requested.includes(v)) : visible
  } else {
    if (accessible !== "all" && !accessible.includes(id)) return { ok: false, status: 404 }
    targetDivisionIds = [id]
  }

  // A department has no columns; the aggregate folds onto the 6 canonical stages.
  const columns: AnalyticsColumn[] = division.isDepartment
    ? CANONICAL_STAGES.map((s) => ({ key: s, label: STAGE_LABELS[s], mapsToStatus: s, color: null }))
    : await prisma.boardColumn.findMany({
        where: { organizationId: orgId, divisionId: id },
        orderBy: { sortOrder: "asc" },
        select: { key: true, label: true, mapsToStatus: true, color: true },
      })

  const rows = targetDivisionIds.length
    ? await prisma.task.findMany({
        where: {
          organizationId: orgId,
          divisionId: { in: targetDivisionIds },
          deletedAt: null,
          ...(opts.assignee ? { assignedTo: opts.assignee } : {}),
          ...(opts.type ? { type: opts.type } : {}),
        },
        select: {
          id: true, taskKey: true, title: true, status: true, boardColumnKey: true,
          type: true, dueDate: true, completedAt: true, createdAt: true, assignedTo: true,
          estimatedHours: true, estimatedPrice: true,
          assignee: { select: { id: true, name: true } },
        },
      })
    : []

  const tasks: AnalyticsTask[] = rows.map((t: (typeof rows)[number]) => ({
    id: t.id,
    taskKey: t.taskKey,
    title: t.title,
    status: t.status,
    boardColumnKey: t.boardColumnKey,
    type: t.type,
    dueDate: t.dueDate,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
    assignedTo: t.assignedTo,
    assigneeName: t.assignee?.name ?? null,
    estimatedHours: t.estimatedHours != null ? Number(t.estimatedHours) : null,
    estimatedPrice: t.estimatedPrice != null ? Number(t.estimatedPrice) : null,
  }))

  const now = new Date()
  const rangeDays = rangeToDays(opts.range ?? null)
  const rangeStart = new Date(now.getTime() - rangeDays * 86_400_000)
  const data: Record<string, unknown> = {
    ...computeTier1Analytics(tasks, columns, now, rangeDays),
    valueRollup: computeValueRollup(tasks, columns),
    burnup: computeBurnup(tasks, now, rangeDays),
    monteCarlo: computeMonteCarlo(tasks, now, rangeDays),
  }

  if (opts.withFlow) {
    const taskIds = tasks.map((t) => t.id)
    const activities = taskIds.length
      ? await prisma.taskActivity.findMany({
          where: { organizationId: orgId, action: "status_changed", taskId: { in: taskIds } },
          select: { taskId: true, oldValue: true, newValue: true, createdAt: true },
        })
      : []
    const flowTasks = tasks.map((t) => ({ id: t.id, taskKey: t.taskKey, title: t.title, status: t.status, createdAt: t.createdAt, completedAt: t.completedAt }))
    const flowEvents = activities.map((a: (typeof activities)[number]) => ({ taskId: a.taskId, oldValue: a.oldValue, newValue: a.newValue, at: a.createdAt }))
    data.flow = computeFlowMetrics(flowTasks, flowEvents, now, rangeStart)
    data.cfd = computeCfd(flowTasks, flowEvents, now, rangeDays)
    data.reopened = computeReopened(flowTasks, flowEvents, rangeStart, now)
    const slaTargetDays = division.slaTargetDays ?? DEFAULT_SLA_TARGET_DAYS
    data.sla = {
      ...computeSla(flowTasks, flowEvents, slaTargetDays, rangeStart, now),
      isBoardDefault: division.slaTargetDays == null,
    }
  }

  return { ok: true, meta: { id: division.id, name: division.name, key: division.key, isDepartment: division.isDepartment }, data }
}
