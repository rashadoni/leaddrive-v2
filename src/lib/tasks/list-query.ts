import { prisma } from "@/lib/prisma"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { getAccessibleDivisionIds } from "@/lib/tasks/board-access"
import type { Role } from "@/lib/permissions"
export { statusBucket, statusBucketLabel, type StatusBucket } from "./status-bucket"

/**
 * Shared task-list query builder. Extracted from GET /api/v1/tasks so that the
 * tasks list AND the tasks export apply IDENTICAL filters + access control
 * (org scope, CRM sharing-rules, additive board access, department board
 * isolation). Keeping one builder is a SECURITY property: the export can never
 * surface a task the list would hide, even if the rules change later.
 */

export interface TaskListFilters {
  assignedTo: string
  createdBy: string
  statusParts: string[]
  priority: string
  type: string
  eventType: string
  category: string
  divisionId: string
  // Multi-board display filter (department combined board): narrow to this set of
  // section ids. Purely a NARROWING filter applied on top of the access-controlled
  // where — it can never widen visibility (a task still has to pass board access).
  divisionIds: string[]
  projectId: string
  search: string
  // Custom-field equality filter (e.g. Brand): cfKey = CustomField.fieldName
  // (the key inside Task.customFields JSON), cfValue = exact value. Both must
  // be present to apply. Powers the client's "filter by brand" report ask.
  cfKey: string
  cfValue: string
  createdRange: { gte?: Date; lte?: Date } | null
  completedRange: { gte?: Date; lte?: Date } | null
}

// ISO-8601 range; a malformed bound is ignored (not an error) — filter bars may
// send partial ranges.
function dateRange(after: string | null, before: string | null): { gte?: Date; lte?: Date } | null {
  const r: { gte?: Date; lte?: Date } = {}
  if (after) { const d = new Date(after); if (!isNaN(d.getTime())) r.gte = d }
  if (before) { const d = new Date(before); if (!isNaN(d.getTime())) r.lte = d }
  return Object.keys(r).length ? r : null
}

export function parseTaskListFilters(sp: URLSearchParams): TaskListFilters {
  return {
    // assigneeId (spec) and assignedTo (legacy) are the same filter.
    assignedTo: sp.get("assigneeId") || sp.get("assignedTo") || "",
    createdBy: sp.get("createdBy") || "",
    statusParts: (sp.get("status") || "").split(",").map((s) => s.trim()).filter(Boolean),
    priority: sp.get("priority") || "",
    type: sp.get("type") || "",
    eventType: sp.get("eventType") || "",
    category: sp.get("category") || "",
    divisionId: sp.get("divisionId") || "",
    divisionIds: (sp.get("divisionIds") || "").split(",").map((s) => s.trim()).filter(Boolean),
    projectId: sp.get("projectId") || "",
    search: (sp.get("search") || "").trim(),
    cfKey: sp.get("cfKey") || "",
    cfValue: sp.get("cfValue") || "",
    createdRange: dateRange(sp.get("createdAfter"), sp.get("createdBefore")),
    completedRange: dateRange(sp.get("completedAfter"), sp.get("completedBefore")),
  }
}

/**
 * Build the org-scoped, access-controlled Prisma `where` for a task-list query.
 * `blocked:true` means the caller filtered by a divisionId they can't access →
 * the caller should return an empty result (board isolation, even for managers).
 */
export async function buildTaskListWhere(
  orgId: string,
  userId: string,
  role: Role,
  f: TaskListFilters,
): Promise<{ where: any; blocked: boolean }> {
  let where: any = {
    organizationId: orgId,
    deletedAt: null, // soft delete: never list deleted tasks
    ...(f.assignedTo ? { assignedTo: f.assignedTo } : {}),
    ...(f.createdBy ? { createdBy: f.createdBy } : {}),
    ...(f.statusParts.length === 1 ? { status: f.statusParts[0] } : {}),
    ...(f.statusParts.length > 1 ? { status: { in: f.statusParts } } : {}),
    ...(f.priority ? { priority: f.priority } : {}),
    ...(f.type ? { type: f.type } : {}),
    ...(f.eventType ? { eventType: f.eventType } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.divisionId === "__none__" ? { divisionId: null } : f.divisionId ? { divisionId: f.divisionId } : {}),
    ...(f.projectId === "__none__" ? { projectId: null } : f.projectId ? { projectId: f.projectId } : {}),
    ...(f.createdRange ? { createdAt: f.createdRange } : {}),
    ...(f.completedRange ? { completedAt: f.completedRange } : {}),
    // Custom-field equality (Brand etc.) — Postgres JSON path filter on the
    // Task.customFields blob, keyed by CustomField.fieldName.
    ...(f.cfKey && f.cfValue ? { customFields: { path: [f.cfKey], equals: f.cfValue } } : {}),
  }

  // Free-text search (title|taskKey) is AND-ed so it never collides with the
  // sharing-rules OR.
  const and: any[] = []
  if (f.search) {
    and.push({
      OR: [
        { title: { contains: f.search, mode: "insensitive" } },
        { taskKey: { contains: f.search, mode: "insensitive" } },
      ],
    })
  }
  if (and.length) where.AND = and

  // CRM sharing-rules: managers+ unrestricted; lower roles narrowed to own /
  // rule-granted via a top-level OR.
  where = await applyRecordFilter(orgId, userId, role, "task", where)

  // Board access is ADDITIVE (own/rule tasks ∪ accessible divisions), then
  // department board-isolation restricts board tasks even from managers.
  const accessible = await getAccessibleDivisionIds(prisma, orgId, userId, role)
  if (f.divisionId && f.divisionId !== "__none__" && accessible !== "all" && !accessible.includes(f.divisionId)) {
    return { where, blocked: true }
  }
  if (accessible !== "all" && accessible.length && Array.isArray(where.OR)) {
    where.OR.push({ divisionId: { in: accessible } })
  }
  // Co-assignee grant must ALSO widen the sharing-rules OR (restricted roles
  // get `OR: [own, rule…]` from applyRecordFilter; boardScope below is AND-ed
  // with it, so without this a sales-role collaborator's task would pass the
  // board gate but fail the sharing gate and stay invisible).
  if (Array.isArray(where.OR)) {
    where.OR.push({ collaborators: { some: { userId } } })
  }
  if (accessible !== "all") {
    const boardScope: any[] = [
      { divisionId: null },
      { assignedTo: userId },
      { createdBy: userId },
      // Co-assignees see their tasks even on boards they're not members of —
      // same own-task exception as assignedTo/createdBy.
      { collaborators: { some: { userId } } },
    ]
    if (accessible.length) boardScope.push({ divisionId: { in: accessible } })
    where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { OR: boardScope }]
  }

  // Department combined board: narrow to the selected sections. Applied AFTER all
  // access logic as a pure AND, so it only ever shrinks the visible set — a task
  // in one of these sections still has to pass board access above.
  if (f.divisionIds.length) {
    where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { divisionId: { in: f.divisionIds } }]
  }

  return { where, blocked: false }
}

