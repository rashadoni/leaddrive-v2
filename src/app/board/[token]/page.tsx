"use client"

/**
 * The screen on the wall: today, for a room to read.
 *
 * Written for a monitor nobody touches — no controls, no scrolling, and it asks
 * for the day again every half-minute so a booking made at the desk or in
 * WhatsApp appears on the wall by itself. What it draws, and why it stopped
 * being an hour grid, is in src/components/booking/board-screen.tsx and
 * src/lib/booking/board-view.ts; this file only keeps the time and the turns.
 *
 * And it keeps itself current: a tab opened once on a monitor would otherwise
 * run the page it was opened with for months. Every few minutes it asks which
 * release the server runs, and loads itself again when that is not its own.
 */
import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { BoardScreen } from "@/components/booking/board-screen"
import { boardClock, releaseToLoad, screenOf, type Board } from "@/lib/booking/board-view"
import { reloadBoardPage } from "@/lib/booking/board-reload"
import { DEPLOY_SHA } from "@/generated/build-sha"
import { dashboardFont } from "@/lib/fonts/dashboard-font"

const REFRESH_MS = 30_000
const ROTATE_MS = 12_000
/** The clock on the wall is read to the minute; it must not sit on the old one for half of the next. */
const TICK_MS = 5_000
/** Four missed answers. A screen that cannot reach the server says so rather than show a stale day as today's. */
const STALE_MS = 2 * 60_000
/** How often the wall asks whether a newer release is being served. */
const RELEASE_MS = 5 * 60_000
/** The release this tab already reloaded for, so one that did not help is not tried again. */
const RELEASE_KEY = "leaddrive-board-release"

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

  useEffect(() => {
    // A local build has no release compiled in: nothing to compare, nothing to ask.
    if (!DEPLOY_SHA) return
    let alive = true
    const tried = () => { try { return window.sessionStorage.getItem(RELEASE_KEY) } catch { return null } }
    const check = () => {
      void fetch("/api/v1/public/build-info", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((info) => {
          if (!alive) return
          // The server answered with its own release, so it is up: loading the
          // page again now cannot leave the wall blank.
          const next = releaseToLoad(DEPLOY_SHA, info?.artifactSha, tried())
          if (!next) return
          try { window.sessionStorage.setItem(RELEASE_KEY, next) } catch { /* a private window: the reload is still worth one try */ }
          reloadBoardPage()
        })
        .catch(() => undefined)
    }
    const timer = window.setInterval(check, RELEASE_MS)
    return () => { alive = false; window.clearInterval(timer) }
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
