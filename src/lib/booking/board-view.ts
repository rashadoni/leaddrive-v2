/**
 * What a board IS — the shape a screen draws, the column counts it allows, and
 * the arithmetic that turns a day into what a television shows.
 *
 * Apart from board.ts on purpose: that module reads the database, and reading
 * it pulls `node:async_hooks` through the RLS context. A client component that
 * imported one constant from there broke the production build outright
 * («UnhandledSchemeError: node:async_hooks»), so the browser's half lives
 * here, where there is nothing to pull.
 *
 * The first screen drew the day as a calendar: hours down the side, a meeting
 * as tall as it is long. On a wall that made a half-hour visit a strip nobody
 * could read, and an empty hour looked the same as a broken screen (owner,
 * 2026-11-13, with a photograph: «тонкая линия… нам не подходит, там должна
 * быть информация подробная, шрифтом таким, который будет виден на
 * телевизоре»). A wall is not planned on — it is glanced at. So the screen now
 * answers three questions in type that reads from across the room: who is with
 * whom NOW, who comes NEXT and when, and which chairs are free. What already
 * happened is not on it at all.
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
  /** The column it stands in: a master's id, or a room's when it is booked on a room. */
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
  /** A room, a court, a chair — not a person. The screen words «free» for it the same way. */
  room?: boolean
  meetings: BoardMeeting[]
}

export interface Board {
  title: string
  day: string
  timezone: string
  columns: BoardColumns
  /** The hours the day covers, in minutes from midnight: [from, to). Kept for screens still running the first layout. */
  from: number
  to: number
  hosts: BoardColumn[]
}

// ─── The day, as a wall shows it ────────────────────────────────────────────

/** `now` is in the chair, `next` is the first one still to come, `later` is the rest. */
export type MeetingPhase = "now" | "next" | "later"

export interface ScreenMeeting extends BoardMeeting {
  phase: MeetingPhase
  /** Minutes until it starts; 0 once it has. */
  startsIn: number
}

export interface ScreenColumn {
  id: string
  name: string
  room: boolean
  /** Somebody is in this chair at this minute. */
  busy: boolean
  meetings: ScreenMeeting[]
  /** Still to come today and not drawn, because a card must stay readable. */
  more: number
}

export interface Screen {
  /** What is shown at once; more than one page means they take turns. */
  pages: ScreenColumn[][]
  /** On this screen, with nothing left today: named in one line instead of an empty column each. */
  idle: { id: string; name: string }[]
  /** Meetings over since the morning — the difference between «none today» and «none left». */
  done: number
}

/**
 * How many meetings a column holds before the rest become «and N more». Few on
 * purpose: the one in the chair, the next, and what follows — nobody reads an
 * eighth row from across a room, and a card that had to shrink to fit is the
 * strip this screen was rebuilt to get rid of.
 */
export const BOARD_FIT = { wide: 4, stacked: 3 } as const

/**
 * A page holding ONE column gives each meeting a whole row of the screen;
 * two or four stack them as cards. The same rule decides how many fit.
 */
export function boardLayout(columnsOnPage: number): keyof typeof BOARD_FIT {
  return columnsOnPage <= 1 ? "wide" : "stacked"
}

export function screenOf(board: Board, nowMinutes: number): Screen {
  let done = 0
  const live: Omit<ScreenColumn, "more">[] = []
  const idle: Screen["idle"] = []
  for (const column of board.hosts) {
    const ahead = column.meetings.filter((meeting) => meeting.end > nowMinutes).sort((a, b) => a.start - b.start || a.end - b.end)
    done += column.meetings.length - ahead.length
    if (!ahead.length) { idle.push({ id: column.hostId, name: column.hostName }); continue }
    let nextTaken = false
    live.push({
      id: column.hostId,
      name: column.hostName,
      room: column.room === true,
      busy: ahead.some((meeting) => meeting.start <= nowMinutes),
      meetings: ahead.map((meeting) => {
        const started = meeting.start <= nowMinutes
        const phase: MeetingPhase = started ? "now" : nextTaken ? "later" : "next"
        if (!started) nextTaken = true
        return { ...meeting, phase, startsIn: Math.max(0, meeting.start - nowMinutes) }
      }),
    })
  }
  const pages: ScreenColumn[][] = []
  for (let index = 0; index < live.length; index += board.columns) {
    const group = live.slice(index, index + board.columns)
    const fit = BOARD_FIT[boardLayout(group.length)]
    pages.push(group.map((column) => ({ ...column, meetings: column.meetings.slice(0, fit), more: Math.max(0, column.meetings.length - fit) })))
  }
  return { pages, idle, done }
}

// ─── Words and numbers on the wall ──────────────────────────────────────────

export const boardClock = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`

const AZ_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avqust", "sentyabr", "oktyabr", "noyabr", "dekabr"]
const AZ_WEEKDAYS = ["bazar", "bazar ertəsi", "çərşənbə axşamı", "çərşənbə", "cümə axşamı", "cümə", "şənbə"]

/**
 * «13 noyabr, cümə» from a calendar day.
 *
 * Written out rather than asked of the browser: a television's Chrome has no
 * Azerbaijani in its Intl data, and the first screen greeted the salon with
 * «M11 13, Fri».
 */
export function boardDayLabel(day: string): string {
  const [year, month, date] = day.split("-").map(Number)
  if (!year || !month || !date || month > 12) return ""
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay()
  return `${date} ${AZ_MONTHS[month - 1]}, ${AZ_WEEKDAYS[weekday]}`
}

/** «25 dəq sonra», «1 saat 10 dəq sonra» — how long until the next one, said the way it is said aloud. */
export function boardStartsIn(minutes: number): string {
  if (minutes < 1) return "indi"
  if (minutes < 60) return `${minutes} dəq sonra`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} saat ${rest} dəq sonra` : `${hours} saat sonra`
}

/** «30 dəq», «1 saat», «1 saat 30 dəq». */
export function boardLasts(minutes: number): string {
  if (minutes < 60) return `${minutes} dəq`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} saat ${rest} dəq` : `${hours} saat`
}

// ─── A screen nobody touches, and the next release ──────────────────────────

const RELEASE = /^[0-9a-f]{40}$/

/**
 * The release a screen should load itself again for, or null to stay as it is.
 *
 * A monitor on a wall is opened once and left for months: without this it
 * keeps running the page it was opened with, and every later change to the
 * screen reaches the server and never the wall (the 2026-11-13 redesign needed
 * somebody to walk to the monitor and reload it).
 *
 * `mine` is the release compiled into this page, `served` is what the server
 * says it runs now, `tried` is the release this tab already reloaded for. A
 * reload that did not help — a cached page, a rollback in between — is not
 * repeated for the same release: a wall must not blink every five minutes.
 */
export function releaseToLoad(mine: string, served: unknown, tried: string | null): string | null {
  // A local build carries no release, so it has nothing to compare with.
  if (!RELEASE.test(mine)) return null
  if (typeof served !== "string" || !RELEASE.test(served)) return null
  return served === mine || served === tried ? null : served
}
