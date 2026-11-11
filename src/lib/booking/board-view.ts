/**
 * What a board IS — the shape a screen draws and the column counts it allows.
 *
 * Apart from board.ts on purpose: that module reads the database, and reading
 * it pulls `node:async_hooks` through the RLS context. A client component that
 * imported one constant from there broke the production build outright
 * («UnhandledSchemeError: node:async_hooks»), so the browser's half lives
 * here, where there is nothing to pull.
 */
/** 1, 2 or 4 — what fits on a screen without the columns becoming stripes. */
export const BOARD_COLUMNS = [1, 2, 4] as const
export type BoardColumns = (typeof BOARD_COLUMNS)[number]

export function readBoardColumns(value: unknown): BoardColumns {
  const count = Number(value)
  return (BOARD_COLUMNS as readonly number[]).includes(count) ? count as BoardColumns : 2
}

export interface BoardMeeting {
  id: string
  hostId: string
  /** Minutes from midnight in the organisation's own timezone. */
  start: number
  end: number
  name: string
  service: string
}

export interface BoardColumn {
  hostId: string
  hostName: string
  meetings: BoardMeeting[]
}

export interface Board {
  title: string
  day: string
  timezone: string
  columns: BoardColumns
  /** The hours the screen draws, in minutes from midnight: [from, to). */
  from: number
  to: number
  hosts: BoardColumn[]
}
