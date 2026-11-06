/**
 * The two rows of tabs above a board (owner, 2026-11-06, Zeytun moving from
 * Bordio: «сделай так, чтоб можно было переключаться между проектами, а не
 * возвращаться назад… сверху как вкладки, чтоб не ломать архитектуру бокового
 * меню»).
 *
 *   row 1 — places: every department and every stand-alone board (Bordio's
 *           folders — «Digital Marketing», «Traditional Marketing», …);
 *   row 2 — the projects of the open department: «all» (the department's
 *           combined view) and each of its boards (Bordio's projects).
 *
 * Only what the caller may open is passed in (GET /api/v1/divisions already
 * filters by board access), so a tab never leads to a refused page.
 */

export interface TabDivision {
  id: string
  name: string
  isDepartment?: boolean | null
  parentDivisionId?: string | null
  sortOrder?: number | null
  _count?: { tasks?: number } | null
}

export interface PlaceTab { id: string; name: string; active: boolean }
export interface ProjectTab { id: string; name: string; count: number | null; active: boolean }
export interface BoardTabRows {
  places: PlaceTab[]
  /** Null when the open board belongs to no department. */
  projects: { departmentId: string; allActive: boolean; items: ProjectTab[] } | null
}

const byOrder = (a: TabDivision, b: TabDivision) =>
  (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)

export function boardTabRows(divisions: readonly TabDivision[], currentId: string): BoardTabRows {
  const known = new Set(divisions.map((division) => division.id))
  const current = divisions.find((division) => division.id === currentId)
  // A section whose department the caller cannot open is shown as a place of its own.
  const parentOf = (division: TabDivision) =>
    division.parentDivisionId && known.has(division.parentDivisionId) ? division.parentDivisionId : null
  const departmentId = current ? (current.isDepartment ? current.id : parentOf(current)) : null
  const placeId = departmentId ?? currentId

  const places = divisions
    .filter((division) => !parentOf(division))
    .sort(byOrder)
    .map((division) => ({ id: division.id, name: division.name, active: division.id === placeId }))

  if (!departmentId) return { places, projects: null }
  const items = divisions
    .filter((division) => parentOf(division) === departmentId)
    .sort(byOrder)
    .map((division) => ({
      id: division.id,
      name: division.name,
      count: typeof division._count?.tasks === "number" ? division._count.tasks : null,
      active: division.id === currentId,
    }))
  return { places, projects: { departmentId, allActive: currentId === departmentId, items } }
}
