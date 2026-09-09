/**
 * Canonical Kanban stages + helpers shared by the board page, the divisions
 * routes (seed / sync), and the tasks PATCH co-write.
 *
 * Model (custom columns, Phase 1):
 *   - `board_columns` is the board's source of truth for WHICH columns show, in
 *     what order, with what label/color.
 *   - `Task.status` stays the canonical, load-bearing state (KPIs, recurrence,
 *     rollup read it). Each column's `mapsToStatus` is the canonical stage a task
 *     takes when moved INTO that column.
 *   - For Phase 1 every column is canonical: key == mapsToStatus == one of the 6
 *     stages below, so the board renders identically to the pre-custom era.
 */

export const CANONICAL_STAGES = ["backlog", "todo", "in_progress", "testing", "review", "done"] as const
export type CanonicalStage = (typeof CANONICAL_STAGES)[number]

// Display labels — literal, NOT i18n (matches the historical hardcoded COLUMNS).
export const STAGE_LABELS: Record<string, string> = {
  backlog: "BACKLOG",
  todo: "TO DO",
  in_progress: "IN PROGRESS",
  testing: "TESTING",
  review: "REVIEW",
  done: "DONE",
}

// Raw/legacy task.status → canonical stage, for DISPLAY-lane folding only (this
// never writes back to status). pending≡todo; completed/cancelled fold to the
// done lane. Mirrors the board's historical STATUS_TO_COLUMN.
export const STATUS_TO_STAGE: Record<string, CanonicalStage> = {
  backlog: "backlog",
  todo: "todo",
  in_progress: "in_progress",
  testing: "testing",
  review: "review",
  done: "done",
  pending: "todo",
  completed: "done",
  cancelled: "done",
}

export function isCanonicalStage(key: string): key is CanonicalStage {
  return (CANONICAL_STAGES as readonly string[]).includes(key)
}

export function canonicalRank(key: string): number {
  const i = CANONICAL_STAGES.indexOf(key as CanonicalStage)
  return i < 0 ? CANONICAL_STAGES.length : i
}

/**
 * Fold a canonical stage into the nearest VISIBLE stage: nearest earlier, else
 * nearest later, else itself. Identical to the board's historical foldToVisible —
 * hiding a column never loses its tasks.
 */
export function foldToVisibleStage(natural: string, visible: Set<string>): string {
  if (visible.has(natural)) return natural
  const i = canonicalRank(natural)
  for (let j = i; j >= 0; j--) if (visible.has(CANONICAL_STAGES[j])) return CANONICAL_STAGES[j]
  for (let j = i + 1; j < CANONICAL_STAGES.length; j++) if (visible.has(CANONICAL_STAGES[j])) return CANONICAL_STAGES[j]
  return natural
}

export interface LaneColumn {
  key: string
  mapsToStatus: string
}

/**
 * Which column lane a task occupies, given the board's ordered columns:
 *   1. its explicit `boardColumnKey`, if that key is one of the visible columns;
 *   2. else fold the task's `status` into the nearest visible stage.
 *
 * Phase 1 columns are canonical (key == mapsToStatus), so (2) reduces to the
 * historical status-fold → render-identical. Returns null only for an empty
 * board (caller then falls back to the legacy canonical render).
 */
export function resolveLaneKey(
  task: { status: string; boardColumnKey?: string | null },
  columns: LaneColumn[],
): string | null {
  if (!columns.length) return null
  const visibleKeys = new Set(columns.map((c) => c.key))
  if (task.boardColumnKey && visibleKeys.has(task.boardColumnKey)) return task.boardColumnKey
  const natural = STATUS_TO_STAGE[task.status] ?? "backlog"
  const visibleStages = new Set(columns.map((c) => c.mapsToStatus))
  const foldedStage = foldToVisibleStage(natural, visibleStages)
  const col = columns.find((c) => c.mapsToStatus === foldedStage) ?? columns.find((c) => c.key === foldedStage)
  return col ? col.key : columns[0].key
}

/**
 * Canonical board_column create-rows for the given visible stage keys, in
 * canonical order (empty `keys` ⇒ all six). Non-canonical keys are dropped.
 * Used by the divisions create-seed and the Division.columns → board_columns sync.
 */
export function buildCanonicalColumns(
  organizationId: string,
  divisionId: string,
  keys: string[],
): { organizationId: string; divisionId: string; key: string; label: string; sortOrder: number; mapsToStatus: string }[] {
  const wanted = keys.filter(isCanonicalStage)
  const set: Set<string> = wanted.length ? new Set<string>(wanted) : new Set<string>(CANONICAL_STAGES)
  return CANONICAL_STAGES.filter((s) => set.has(s)).map((s, i) => ({
    organizationId,
    divisionId,
    key: s,
    label: STAGE_LABELS[s],
    sortOrder: i,
    mapsToStatus: s,
  }))
}

/**
 * Kanban drag-drop resolution (board move). Given the droppable the pointer ended
 * over, the board's valid column keys, and where the dragged task currently sits,
 * returns the target column key to move to — or null when the drop is a no-op:
 * dropped outside any column (overId null), over an unknown id, or back onto the
 * card's own column. Pure so the board's dnd-kit onDragEnd stays unit-testable.
 */
export function resolveBoardDrop(opts: {
  overId: string | null
  validColumnKeys: string[]
  currentColumnKey: string | undefined
}): string | null {
  const { overId, validColumnKeys, currentColumnKey } = opts
  if (!overId || !validColumnKeys.includes(overId)) return null
  if (overId === currentColumnKey) return null
  return overId
}
