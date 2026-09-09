import type { Role } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { getAccessibleDivisionIds } from "@/lib/tasks/board-access"
import { buildTaskListWhere, type TaskListFilters } from "@/lib/tasks/list-query"

export type VoiceTaskScopeContext = {
  userId: string
  role: Role
}

export class VoiceTaskScopeUnavailableError extends Error {
  constructor() {
    super("Voice task scope is unavailable")
    this.name = "VoiceTaskScopeUnavailableError"
  }
}

export function isVoiceTaskScopeUnavailable(
  error: unknown,
): error is VoiceTaskScopeUnavailableError {
  return error instanceof VoiceTaskScopeUnavailableError
}

export function emptyVoiceTaskFilters(
  overrides: Partial<TaskListFilters> = {},
): TaskListFilters {
  return {
    assignedTo: "",
    createdBy: "",
    statusParts: [],
    priority: "",
    type: "",
    eventType: "",
    category: "",
    divisionId: "",
    divisionIds: [],
    projectId: "",
    search: "",
    cfKey: "",
    cfValue: "",
    createdRange: null,
    completedRange: null,
    ...overrides,
  }
}

/**
 * Resolve exactly the same task visibility boundary as the task list/export.
 * Voice must never fall back to an org-wide query when board access resolution
 * fails: callers intentionally let this throw and return an unavailable scope.
 */
export async function buildVoiceTaskWhere(
  orgId: string,
  context: VoiceTaskScopeContext,
  filters: Partial<TaskListFilters> = {},
): Promise<Record<string, unknown>> {
  try {
    const { where, blocked } = await buildTaskListWhere(
      orgId,
      context.userId,
      context.role,
      emptyVoiceTaskFilters(filters),
    )
    if (blocked) throw new VoiceTaskScopeUnavailableError()
    return where as Record<string, unknown>
  } catch (error) {
    if (isVoiceTaskScopeUnavailable(error)) throw error
    throw new VoiceTaskScopeUnavailableError()
  }
}

/** Resolve board labels under the same fail-closed rule as task rows. */
export async function getVoiceAccessibleDivisionIds(
  orgId: string,
  context: VoiceTaskScopeContext,
): Promise<"all" | string[]> {
  try {
    return await getAccessibleDivisionIds(
      prisma,
      orgId,
      context.userId,
      context.role,
    )
  } catch {
    throw new VoiceTaskScopeUnavailableError()
  }
}

/** Add a report predicate without replacing the canonical board-scope AND. */
export function narrowVoiceTaskWhere(
  scopedWhere: Record<string, unknown>,
  predicate: Record<string, unknown>,
): Record<string, unknown> {
  const existingAnd = Array.isArray(scopedWhere.AND) ? scopedWhere.AND : []
  return {
    ...scopedWhere,
    AND: [...existingAnd, predicate],
  }
}
