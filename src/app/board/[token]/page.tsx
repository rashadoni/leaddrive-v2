"use client"

/**
 * The screen on the wall: today, by the hour, one column per master.
 *
 * Written for a monitor nobody touches — big type, no controls, no scrolling,
 * and it asks for the day again every half-minute so a booking made at the
 * desk appears on the wall by itself. More columns than fit at once are shown
 * in turn: four masters on a screen of two means two and two, swapping every
 * twelve seconds, rather than four stripes nobody can read (owner,
 * 2026-11-11).
 */
import { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import type { Board } from "@/lib/booking/board"

const REFRESH_MS = 30_000
const ROTATE_MS = 12_000
const PIXELS_PER_HOUR = 96

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`

export default function BoardScreen() {
  const params = useParams<{ token: string }>()
  const token = typeof params?.token === "string" ? params.token : ""
  const [board, setBoard] = useState<Board | null>(null)
  const [missing, setMissing] = useState(false)
  const [page, setPage] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!token) return
    let alive = true
    const load = () => {
      void fetch(`/api/v1/public/booking-board/${encodeURIComponent(token)}`, { cache: "no-store" })
        .then(async (response) => {
          if (!alive) return
          if (response.status === 404) { setMissing(true); return }
          const body = await response.json().catch(() => null)
          if (body?.success) { setBoard(body.data as Board); setMissing(false) }
        })
        .catch(() => undefined)
    }
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => { alive = false; window.clearInterval(timer) }
  }, [token])

  // The red line is only honest while the clock moves.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const pages = useMemo(() => {
    if (!board) return []
    const size = board.columns
    const groups: Board["hosts"][] = []
    for (let index = 0; index < board.hosts.length; index += size) groups.push(board.hosts.slice(index, index + size))
    return groups.length ? groups : [[]]
  }, [board])

  useEffect(() => {
    if (pages.length < 2) return
    const timer = window.setInterval(() => setPage((value) => (value + 1) % pages.length), ROTATE_MS)
    return () => window.clearInterval(timer)
  }, [pages.length])

  if (missing) {
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 p-10 text-center text-2xl text-neutral-400">
      Bu ekran bağlanıb.
    </main>
  }
  if (!board) {
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-2xl text-neutral-500">…</main>
  }

  const hours: number[] = []
  for (let minute = board.from; minute < board.to; minute += 60) hours.push(minute)
  const shown = pages[Math.min(page, pages.length - 1)] ?? []
  const nowMinutes = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: board.timezone }).format(new Date(now))) * 60
    + Number(new Intl.DateTimeFormat("en-GB", { minute: "2-digit", timeZone: board.timezone }).format(new Date(now)))
  const dayLabel = new Intl.DateTimeFormat("az", { weekday: "long", day: "numeric", month: "long", timeZone: board.timezone }).format(new Date(`${board.day}T12:00:00Z`))

  return <main className="min-h-screen bg-neutral-950 px-8 py-6 text-neutral-100">
    <header className="mb-5 flex items-baseline justify-between">
      <h1 className="text-4xl font-semibold tracking-tight">{board.title}</h1>
      <div className="flex items-baseline gap-5 text-2xl text-neutral-400">
        <span>{dayLabel}</span>
        {pages.length > 1 ? <span className="text-neutral-600">{page + 1} / {pages.length}</span> : null}
      </div>
    </header>

    {shown.length === 0 ? (
      <p className="mt-32 text-center text-3xl text-neutral-500">Bu gün görüş yoxdur</p>
    ) : (
      <div className="flex gap-5">
        {/* The hour rail, written once beside the columns. */}
        <div className="shrink-0 pt-12" style={{ width: 84 }}>
          {hours.map((minute) => <div key={minute} className="text-right text-xl text-neutral-500" style={{ height: PIXELS_PER_HOUR }}>{clock(minute)}</div>)}
        </div>
        {shown.map((column) => (
          <section key={column.hostId} className="flex-1">
            <h2 className="mb-2 truncate text-2xl font-medium text-neutral-300">{column.hostName}</h2>
            <div className="relative rounded-2xl border border-neutral-800 bg-neutral-900" style={{ height: hours.length * PIXELS_PER_HOUR }}>
              {hours.map((minute, index) => index === 0 ? null : (
                <div key={minute} className="absolute inset-x-0 border-t border-neutral-800" style={{ top: index * PIXELS_PER_HOUR }} />
              ))}
              {nowMinutes >= board.from && nowMinutes < board.to ? (
                <div className="absolute inset-x-0 border-t-2 border-orange-500" style={{ top: ((nowMinutes - board.from) / 60) * PIXELS_PER_HOUR }} />
              ) : null}
              {column.meetings.map((meeting) => (
                <article
                  key={meeting.id}
                  className="absolute inset-x-2 overflow-hidden rounded-xl bg-orange-500/15 px-4 py-2 ring-1 ring-orange-500/40"
                  style={{
                    top: ((meeting.start - board.from) / 60) * PIXELS_PER_HOUR + 2,
                    height: Math.max(36, ((meeting.end - meeting.start) / 60) * PIXELS_PER_HOUR - 4),
                  }}
                >
                  <p className="truncate text-2xl font-medium">{meeting.name}</p>
                  <p className="truncate text-xl text-neutral-400">{clock(meeting.start)} · {meeting.service}</p>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    )}
  </main>
}
