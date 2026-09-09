/**
 * Single source of truth for which task statuses count as "closed" / not-open
 * across the tasks UI (list, board, detail). Folds the board-vocabulary `done`
 * and `cancelled` in with `completed` — a closed task is never "overdue" and
 * groups under Closed.
 */
export const CLOSED_STATUSES = new Set<string>(["completed", "done", "cancelled"])

export function isClosedStatus(status: string): boolean {
  return CLOSED_STATUSES.has(status)
}
