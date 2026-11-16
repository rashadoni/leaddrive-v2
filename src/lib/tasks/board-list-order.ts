/**
 * The order of a board's list (Siyahı), a folder's list and a team's list.
 *
 * Ulviyyə, Zeytun, 2026-11-16: «yeni tasklar yenə ortaya düşür… 2 eyni adda
 * task bugün bağlamışam, ortadadı». The list kept the server's order — each
 * card's place on the kanban — so a task closed today sat among the finished
 * ones wherever its card had stood, while the kanban's own «Done» column shows
 * the newest finished first. The list now agrees with it: open tasks keep
 * their place on the board, finished ones come newest-closed first.
 *
 * A column picked in the list's header (name, status, priority, due date)
 * orders every group by that column; the arrows used to change and the rows
 * did not. Ties keep the order above.
 */

export const FINISHED_TASK_STATUSES: ReadonlySet<string> = new Set(["done", "completed", "cancelled"])

type When = string | Date | null | undefined

export type BoardListOrderable = {
  title?: string | null
  status: string
  priority?: string | null
  dueDate?: When
  /** Stamped when a task enters done/completed. */
  completedAt?: When
  /** A cancelled task has no completedAt; its last change is when it was closed. */
  updatedAt?: When
}

// A board's stages in their usual order, for a list whose board columns are not at hand.
const STAGE_ORDER: readonly string[] = ["backlog", "pending", "todo", "in_progress", "testing", "review", "done", "completed", "cancelled"]

// The same ranks as the /tasks page: «priority ↑» is the most urgent first.
const PRIORITY_RANK: Record<string, number> = { critical: -1, urgent: 0, high: 1, medium: 2, low: 3 }

function time(value: When): number | null {
  if (!value) return null
  const at = new Date(value).getTime()
  return Number.isNaN(at) ? null : at
}

/** Later first; a task without a time goes after those with one. */
function newestFirst(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return b - a
}

/** Earlier first, or later first when `desc`; a task without a date always goes last. */
function byDate(a: number | null, b: number | null, desc: boolean): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return desc ? b - a : a - b
}

export function boardListOrder<T extends BoardListOrderable>(
  tasks: readonly T[],
  sortBy = "",
  options: { locale?: string; statusOrder?: readonly string[] } = {},
): T[] {
  // Open tasks as the board has them; finished ones by when they were closed.
  // Groups are stages, so putting the finished after the open moves nobody
  // into another group.
  const open = tasks.filter((task) => !FINISHED_TASK_STATUSES.has(task.status))
  const finished = tasks
    .filter((task) => FINISHED_TASK_STATUSES.has(task.status))
    .map((task, at) => ({ task, at, closed: time(task.completedAt) ?? time(task.updatedAt) }))
    .sort((a, b) => newestFirst(a.closed, b.closed) || a.at - b.at)
    .map(({ task }) => task)
  const ordered = [...open, ...finished]
  if (!sortBy) return ordered

  const desc = sortBy.endsWith("_desc")
  const collator = new Intl.Collator(options.locale, { numeric: true, sensitivity: "base" })
  // The board's own columns first; a status they do not name, by the usual stage order after them.
  const own = options.statusOrder ?? []
  const statusRank = (status: string) => {
    const at = own.indexOf(status)
    if (at !== -1) return at
    const stage = STAGE_ORDER.indexOf(status)
    return stage === -1 ? Number.MAX_SAFE_INTEGER : own.length + stage
  }
  const compare = (a: T, b: T): number => {
    switch (sortBy) {
      case "name":
      case "name_desc": {
        const by = collator.compare(a.title ?? "", b.title ?? "")
        return desc ? -by : by
      }
      case "priority":
      case "priority_desc": {
        const by = (PRIORITY_RANK[a.priority ?? ""] ?? 2) - (PRIORITY_RANK[b.priority ?? ""] ?? 2)
        return desc ? -by : by
      }
      case "status":
      case "status_desc": {
        const by = statusRank(a.status) - statusRank(b.status)
        return desc ? -by : by
      }
      case "date_asc":
      case "date_desc":
        return byDate(time(a.dueDate), time(b.dueDate), sortBy === "date_desc")
      default:
        return 0
    }
  }
  // Array#sort is stable: ties keep the default order.
  return ordered.sort(compare)
}
