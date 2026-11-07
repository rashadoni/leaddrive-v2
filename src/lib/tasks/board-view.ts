/**
 * Which view a board opens in — and the tabs it offers.
 *
 * Every board opens as the table («Siyahı»), the way a Bordio project opens in
 * Table view; Kanban and the board's tools are one click away and the pick is
 * not remembered (owner, 2026-11-07, after boards opened in different views
 * because each remembered its own last tab).
 */
export type BoardView = "board" | "list" | "calendar" | "notes" | "members" | "reports"

export const DEFAULT_BOARD_VIEW: BoardView = "list"

/** In tab order (Bordio: Tasks, Calendar, Notes, Members; then the CRM reports). */
export const BOARD_VIEWS: readonly BoardView[] = ["board", "list", "calendar", "notes", "members", "reports"]
