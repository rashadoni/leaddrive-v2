"use client"

/**
 * The wall screen as it is drawn: one day, read from across a room.
 *
 * Pure on purpose — a board and a minute in, a picture out — so the page that
 * owns the timers stays small and this can be rendered anywhere a test or a
 * screenshot needs it.
 *
 * Every size hangs off the screen's HEIGHT, capped by its width. A television
 * is not a window somebody resizes: the same page must fill a 720p set, a 4K
 * one and a panel hung upright, and pixels fit only the first of those.
 */
import { cn } from "@/lib/utils"
import { boardClock, boardDayLabel, boardLasts, boardLayout, boardStartsIn, screenOf, type Board, type ScreenColumn, type ScreenMeeting } from "@/lib/booking/board-view"

/** `vh` of the screen, never wider than the same share of a 16:9 one. */
const u = (vh: number) => `min(${vh}vh, ${(vh * 0.62).toFixed(2)}vw)`

/** A ring that scales with the screen: a one-pixel border is a hairline on a 4K wall. */
const ring = (vh: number, color: string) => `inset 0 0 0 ${u(vh)} ${color}`

function Meeting({ meeting, wide, narrow }: { meeting: ScreenMeeting; wide: boolean; narrow: boolean }) {
  const now = meeting.phase === "now"
  const next = meeting.phase === "next"
  const big = wide ? 5 : narrow ? 3.7 : 4.6
  const small = wide ? 3.2 : narrow ? 2.6 : 3.1
  const status = now
    ? <span className="flex shrink-0 items-center rounded-full bg-neutral-950 font-bold text-orange-400" style={{ fontSize: u(small * 0.86), gap: u(0.9), padding: `${u(0.5)} ${u(1.6)}` }}>
        <span className="animate-pulse rounded-full bg-orange-400" style={{ width: u(1.2), height: u(1.2) }} />İndi
      </span>
    : next
      ? <span className="shrink-0 font-bold text-orange-400" style={{ fontSize: u(small * 0.9) }}>{boardStartsIn(meeting.startsIn)}</span>
      : null
  const time = <p className="whitespace-nowrap font-bold tabular-nums tracking-tight" style={{ fontSize: u(big), lineHeight: 1.15 }}>
    {boardClock(meeting.start)}{narrow ? null : <span className={now ? "text-orange-950/70" : "text-neutral-400"}> – {boardClock(meeting.end)}</span>}
  </p>
  const name = <p className="truncate font-bold" style={{ fontSize: u(big), lineHeight: 1.2 }}>{meeting.name}</p>
  const what = <p className={cn("truncate", now ? "text-orange-950/80" : "text-neutral-400")} style={{ fontSize: u(small), lineHeight: 1.3 }}>
    {[meeting.service, boardLasts(meeting.end - meeting.start)].filter(Boolean).join(" · ")}
  </p>
  return <li
    data-phase={meeting.phase}
    className={cn(now ? "bg-orange-500 text-neutral-950" : "bg-neutral-900 text-neutral-50")}
    style={{ borderRadius: u(2.2), padding: wide ? `${u(1.8)} ${u(3)}` : `${u(1.7)} ${u(2.4)}`, boxShadow: now ? undefined : ring(next ? 0.4 : 0.15, next ? "rgb(249 115 22 / 0.75)" : "rgb(64 64 64)") }}
  >
    {wide
      ? <div className="grid items-center" style={{ gridTemplateColumns: "auto minmax(0, 1fr) auto", gap: u(5) }}>
          {time}
          <div className="min-w-0">{name}{what}</div>
          {status}
        </div>
      : <>
          <div className="flex items-center justify-between" style={{ gap: u(1.5) }}>{time}{status}</div>
          {name}
          {what}
        </>}
  </li>
}

function Column({ column, wide, narrow }: { column: ScreenColumn; wide: boolean; narrow: boolean }) {
  return <section className="flex min-h-0 min-w-0 flex-col" style={{ gap: u(1.6) }}>
    {/* Four across, a name and its state do not share a line: «Aysel Quliy…» is not a name. */}
    <header className={cn("flex", narrow ? "flex-col" : "items-center justify-between")} style={{ gap: narrow ? u(0.2) : u(2) }}>
      <h2 className="min-w-0 truncate font-bold" style={{ fontSize: u(narrow ? 3.6 : 4.2), lineHeight: 1.15 }}>{column.name}</h2>
      <p className={cn("flex shrink-0 items-center font-semibold", column.busy ? "text-orange-400" : "text-emerald-400")} style={{ fontSize: u(narrow ? 2.4 : 2.7), gap: u(1) }}>
        <span className={cn("rounded-full", column.busy ? "bg-orange-400" : "bg-emerald-400")} style={{ width: u(1.4), height: u(1.4) }} />
        {column.busy ? "Məşğuldur" : "Boşdur"}
      </p>
    </header>
    <ol className="flex min-h-0 flex-col" style={{ gap: u(1.5) }}>
      {column.meetings.map((meeting) => <Meeting key={meeting.id} meeting={meeting} wide={wide} narrow={narrow} />)}
    </ol>
    {column.more ? <p className="text-neutral-400" style={{ fontSize: u(narrow ? 2.5 : 2.8), paddingLeft: u(0.6) }}>və daha {column.more} görüş</p> : null}
  </section>
}

export function BoardScreen({ board, nowMinutes, page, staleSince, className }: {
  board: Board
  /** Minutes from midnight on the organisation's clock. */
  nowMinutes: number
  /** Which group of columns is up, when they take turns. */
  page: number
  /** «10:21» when the screen has not heard from the server for a while; it says so instead of showing an old day as today's. */
  staleSince?: string | null
  /** The typeface, handed in by the page: next/font lives where the bundler can see it. */
  className?: string
}) {
  const screen = screenOf(board, nowMinutes)
  const index = Math.min(page, Math.max(0, screen.pages.length - 1))
  const shown = screen.pages[index] ?? []
  const wide = boardLayout(shown.length) === "wide"
  const narrow = shown.length >= 3
  return <main className={cn("flex h-screen flex-col overflow-hidden bg-neutral-950 text-neutral-50 antialiased selection:bg-orange-500/40", className)} style={{ padding: `${u(3.4)} ${u(5)}`, gap: u(2.6) }}>
    <header className="flex items-end justify-between" style={{ gap: u(4) }}>
      <div className="min-w-0">
        <h1 className="truncate font-bold tracking-tight" style={{ fontSize: u(6), lineHeight: 1.05 }}>{board.title}</h1>
        <p className="text-neutral-400" style={{ fontSize: u(3), marginTop: u(0.6) }}>{boardDayLabel(board.day)}</p>
      </div>
      <p className="shrink-0 font-bold tabular-nums tracking-tight" style={{ fontSize: u(8), lineHeight: 0.95 }}>{boardClock(nowMinutes)}</p>
    </header>

    {shown.length === 0
      ? <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-center" style={{ gap: u(2) }}>
          <p className="font-bold tracking-tight" style={{ fontSize: u(6.4), lineHeight: 1.1 }}>{screen.done ? "Bu günün görüşləri bitdi" : "Bu gün görüş yoxdur"}</p>
          {/* A screen narrowed to some masters says whose day this is: an
              empty wall otherwise reads as «the salon is empty». */}
          {screen.idle.length ? <p className="max-w-[80%] text-neutral-400" style={{ fontSize: u(3.2), lineHeight: 1.35 }}>Bu ekranda: {screen.idle.map((item) => item.name).join(" · ")}</p> : null}
        </div>
      : <div className="grid min-h-0 flex-1 content-start" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))`, gap: u(3.4) }}>
          {shown.map((column) => <Column key={column.id} column={column} wide={wide} narrow={narrow} />)}
        </div>}

    <footer className="flex items-center justify-between text-neutral-400" style={{ fontSize: u(2.6), gap: u(4), minHeight: u(3.6) }}>
      {staleSince
        ? <p role="status" className="min-w-0 truncate font-semibold text-amber-400">Əlaqə yoxdur · son yenilənmə {staleSince}</p>
        : <p className="min-w-0 truncate">{shown.length && screen.idle.length ? `Bu gün başqa görüşü yoxdur: ${screen.idle.map((item) => item.name).join(", ")}` : ""}</p>}
      {screen.pages.length > 1
        ? <p className="flex shrink-0 items-center tabular-nums" style={{ gap: u(1.2) }}>
            {screen.pages.map((ignored, at) => <span key={at} className={cn("rounded-full", at === index ? "bg-neutral-50" : "bg-neutral-700")} style={{ width: u(1.3), height: u(1.3) }} />)}
            <span style={{ marginLeft: u(0.8) }}>{index + 1} / {screen.pages.length}</span>
          </p>
        : null}
    </footer>
  </main>
}
