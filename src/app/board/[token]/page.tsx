"use client"

/**
 * The screen on the wall: today, for a room to read.
 *
 * Written for a monitor nobody touches — no controls, no scrolling, and it asks
 * for the day again every half-minute so a booking made at the desk or in
 * WhatsApp appears on the wall by itself. What it draws, and why it stopped
 * being an hour grid, is in src/components/booking/board-screen.tsx and
 * src/lib/booking/board-view.ts; this file only keeps the time and the turns.
 */
import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { BoardScreen } from "@/components/booking/board-screen"
import { boardClock, screenOf, type Board } from "@/lib/booking/board-view"
import { dashboardFont } from "@/lib/fonts/dashboard-font"

const REFRESH_MS = 30_000
const ROTATE_MS = 12_000
/** The clock on the wall is read to the minute; it must not sit on the old one for half of the next. */
const TICK_MS = 5_000
/** Four missed answers. A screen that cannot reach the server says so rather than show a stale day as today's. */
const STALE_MS = 2 * 60_000

function minutesIn(timezone: string, at: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone }).formatToParts(new Date(at))
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0)
  return (part("hour") % 24) * 60 + part("minute")
}

const size = (vh: number) => `min(${vh}vh, ${(vh * 0.62).toFixed(2)}vw)`
/** The CRM's own typeface, shipped with the page: a television has no Inter of its own to fall back on. */
const FONT = `font-dashboard ${dashboardFont.variable}`

export default function BoardPage() {
  const params = useParams<{ token: string }>()
  const token = typeof params?.token === "string" ? params.token : ""
  const [board, setBoard] = useState<Board | null>(null)
  const [missing, setMissing] = useState(false)
  const [page, setPage] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [heardAt, setHeardAt] = useState(() => Date.now())

  useEffect(() => {
    if (!token) return
    let alive = true
    const load = () => {
      void fetch(`/api/v1/public/booking-board/${encodeURIComponent(token)}`, { cache: "no-store" })
        .then(async (response) => {
          if (!alive) return
          if (response.status === 404) { setMissing(true); return }
          const body = await response.json().catch(() => null)
          if (body?.success) { setBoard(body.data as Board); setMissing(false); setHeardAt(Date.now()) }
        })
        .catch(() => undefined)
    }
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => { alive = false; window.clearInterval(timer) }
  }, [token])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  const nowMinutes = board ? minutesIn(board.timezone, now) : 0
  const pages = board ? screenOf(board, nowMinutes).pages.length : 0

  // The turn is never reset here: the screen itself shows the last page when
  // the one it was on has emptied (BoardScreen clamps it).
  useEffect(() => {
    if (pages < 2) return
    const timer = window.setInterval(() => setPage((value) => (value + 1) % pages), ROTATE_MS)
    return () => window.clearInterval(timer)
  }, [pages])

  if (missing) {
    return <main className={`${FONT} flex h-screen items-center justify-center bg-neutral-950 text-center font-semibold text-neutral-400`} style={{ fontSize: size(4), padding: size(6) }}>
      Bu ekran bağlanıb.
    </main>
  }
  if (!board) {
    return <main className={`${FONT} flex h-screen items-center justify-center bg-neutral-950 text-neutral-500`} style={{ fontSize: size(4) }}>…</main>
  }

  return <BoardScreen
    className={FONT}
    board={board}
    nowMinutes={nowMinutes}
    page={page}
    staleSince={now - heardAt > STALE_MS ? boardClock(minutesIn(board.timezone, heardAt)) : null}
  />
}
