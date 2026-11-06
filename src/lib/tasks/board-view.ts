/**
 * Which view a board opens in — Lövhə (Kanban), Siyahı (table) or Hesabatlar.
 *
 * A board opens as the table, the way Bordio opens a project (Table view, with
 * Kanban one click away): owner 2026-11-06, when Zeytun's marketing moved over
 * from Bordio — «по умолчанию сделай также как и в Bordio». A person who picks
 * another view keeps it for that board in this browser.
 *
 * The choice lives in localStorage on purpose: it is a per-viewer convenience,
 * not shared state, and a blocked or empty storage only means the default.
 */
export type BoardView = "board" | "list" | "calendar" | "members" | "reports"

export const DEFAULT_BOARD_VIEW: BoardView = "list"

/** In tab order (Bordio: Tasks, Calendar, Members; then the CRM reports). */
export const BOARD_VIEWS: readonly BoardView[] = ["board", "list", "calendar", "members", "reports"]

export function boardViewStorageKey(divisionId: string): string {
  return `ld.board-view.${divisionId}`
}

export function parseBoardView(value: unknown): BoardView | null {
  return typeof value === "string" && (BOARD_VIEWS as readonly string[]).includes(value) ? (value as BoardView) : null
}

type ViewStorage = Pick<Storage, "getItem" | "setItem">

/** `window.localStorage`, or null on the server and where touching it throws (blocked site data). */
export function browserStorage(): ViewStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

export function readBoardView(divisionId: string, storage: ViewStorage | null | undefined): BoardView {
  try {
    return parseBoardView(storage?.getItem(boardViewStorageKey(divisionId))) ?? DEFAULT_BOARD_VIEW
  } catch {
    return DEFAULT_BOARD_VIEW
  }
}

export function rememberBoardView(divisionId: string, view: BoardView, storage: ViewStorage | null | undefined): void {
  try {
    storage?.setItem(boardViewStorageKey(divisionId), view)
  } catch {
    // Private window / blocked site data: the board still works, it just opens as the table next time.
  }
}
