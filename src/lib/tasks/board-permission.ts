import type { Role } from "@/lib/permissions"

/**
 * Board access resolution — the spec's per-user-per-division permission model,
 * sitting ON TOP of the role matrix (permissions.ts) and row-level sharing-rules.
 *
 * Pure functions: the caller computes `isOwnDivision` / `isDivisionHead` (LeadDrive
 * has no user↔division membership table yet — see the route layer for how those are
 * derived) and passes the explicit BoardPermission row, if any. Resolution order:
 *   admin/superadmin            → bypass (always allowed)
 *   explicit row, canView=false → explicit DENY (beats own-division)
 *   own division                → default view / create / comment
 *   per-action move flags gate each status transition; `done` is role-gated.
 */

export type KanbanStatus = "backlog" | "todo" | "in_progress" | "testing" | "review" | "done"

export const KANBAN_STATUSES: readonly KanbanStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "testing",
  "review",
  "done",
]

/**
 * Rank for ordering + backward-move detection (matches the 6 board columns).
 * Legacy statuses map onto the nearest Kanban rank so a board holding mixed
 * legacy/Kanban rows still compares correctly until the data migration runs.
 */
export const STATUS_RANK: Record<string, number> = {
  backlog: 0,
  todo: 1,
  in_progress: 2,
  testing: 3,
  review: 4,
  done: 5,
  // legacy (pre-board). NOTE: `cancelled` is ranked at done-level (5) only so it
  // sorts as terminal — so a move OFF a legacy `cancelled` task always reads as
  // backward (→ canMoveBack), and cancelled→done hits the role gate. Revisit if
  // the status data-migration ever remaps cancelled→backlog. Transitional only.
  pending: 1,
  completed: 5,
  cancelled: 5,
}

export interface BoardPermissionFlags {
  canView: boolean
  canEdit: boolean
  canMoveToTodo: boolean
  canMoveToInProgress: boolean
  canMoveToTesting: boolean
  canMoveToReview: boolean
  canMoveBack: boolean
  canCreateTask: boolean
  canComment: boolean
}

export interface BoardAccessInput {
  role: Role
  /** Explicit BoardPermission row for (user, division), or null if none exists. */
  perm: BoardPermissionFlags | null
  /** Is this the user's home division? (membership signal, computed by caller) */
  isOwnDivision: boolean
  /** Is the user the division's head? (Division.headUserId === user.id) */
  isDivisionHead: boolean
}

export function isAdminRole(role: Role): boolean {
  return role === "admin" || role === "superadmin"
}

/**
 * An explicit BoardPermission row with canView=false is a HARD DENY for every
 * non-admin action on that board — not just viewing. It's the mechanism behind
 * "section overrides the inherited department grant" (a section deny must remove
 * edit/comment/create/move too, including the role-gated move-to-`done`),
 * otherwise a denied user could still mutate a board they can't even see.
 * (canCreateTask/canComment already AND on canView; this covers edit + moves.)
 */
function isExplicitlyDenied(i: BoardAccessInput): boolean {
  return !isAdminRole(i.role) && !!i.perm && !i.perm.canView
}

/**
 * Spec rule #3: a task may enter `done` ONLY via admin / department head
 * (mapped to the `manager` role) / division head — independent of any
 * per-action move flag. An explicit section deny (canView=false) still blocks it.
 */
export function canMoveToDone(i: BoardAccessInput): boolean {
  if (isExplicitlyDenied(i)) return false
  return isAdminRole(i.role) || i.role === "manager" || i.isDivisionHead
}

export function canViewBoard(i: BoardAccessInput): boolean {
  if (isAdminRole(i.role)) return true
  // An explicit row wins outright — canView=false is a DENY that beats own-division.
  if (i.perm) return i.perm.canView
  return i.isOwnDivision
}

export function canEditTasks(i: BoardAccessInput): boolean {
  if (isAdminRole(i.role)) return true
  if (isExplicitlyDenied(i)) return false
  return i.perm?.canEdit ?? false
}

export function canCreateTask(i: BoardAccessInput): boolean {
  if (isAdminRole(i.role)) return true
  if (i.perm) return i.perm.canView && (i.perm.canEdit || i.perm.canCreateTask)
  return i.isOwnDivision
}

export function canComment(i: BoardAccessInput): boolean {
  if (isAdminRole(i.role)) return true
  if (i.perm) return i.perm.canView && (i.perm.canEdit || i.perm.canComment)
  return i.isOwnDivision
}

/**
 * Can the user move a task from `current` status into `target`?
 *   - admin/superadmin           → always
 *   - target === "done"          → role-gated (canMoveToDone), flags ignored
 *   - backward (rank decreases)  → canMoveBack
 *   - forward into a column       → that column's per-action flag
 */
export function canMoveToStatus(
  i: BoardAccessInput,
  target: KanbanStatus,
  current: string,
): boolean {
  if (isAdminRole(i.role)) return true
  if (isExplicitlyDenied(i)) return false // explicit section deny blocks all moves
  if (target === "done") return canMoveToDone(i)

  const targetRank = STATUS_RANK[target] ?? 0
  const currentRank = STATUS_RANK[current] ?? 0
  if (targetRank < currentRank) return i.perm?.canMoveBack ?? false

  switch (target) {
    case "todo":
      return i.perm?.canMoveToTodo ?? false
    case "in_progress":
      return i.perm?.canMoveToInProgress ?? false
    case "testing":
      return i.perm?.canMoveToTesting ?? false
    case "review":
      return i.perm?.canMoveToReview ?? false
    case "backlog":
      // backlog is rank 0 — only ever reached as a backward move (handled above).
      return i.perm?.canMoveBack ?? false
    default:
      return false
  }
}
