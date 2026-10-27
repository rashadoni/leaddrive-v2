"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { useSession } from "next-auth/react"
import { startVisibleInterval } from "@/lib/client/visible-interval"

/**
 * The tab's one connection to GET /api/v1/shell/events. The server tells it
 * when a call rings, a notification or ticket arrives, or a visitor writes in
 * the web chat, and the shell's badges and popups read their data then —
 * instead of each asking every 5–30 s whether anything happened (28 requests a
 * minute from an idle tab on screen, measured on production 2026-10-27).
 *
 * Nothing depends on the stream being up: until it says `connected`, and
 * whenever it stays down, every consumer polls exactly as it did before.
 */

export type ShellEventKind = "calls" | "notifications" | "tickets" | "webchat"
const KINDS: ShellEventKind[] = ["calls", "notifications", "tickets", "webchat"]

/** "connecting": wait, the first read follows `connected` or the fallback. */
type Mode = "connecting" | "live" | "fallback"
type Handler = () => void

type ShellEvents = {
  mode: Mode
  /** Grows on every `connected`: each (re)connect means "read once now". */
  generation: number
  subscribe: (kind: ShellEventKind, handler: Handler) => () => void
}

const NO_STREAM: ShellEvents = { mode: "fallback", generation: 0, subscribe: () => () => {} }
const ShellEventsContext = createContext<ShellEvents>(NO_STREAM)

const CONNECT_TIMEOUT_MS = 4_000
/** A dropped stream gets this long to come back before polling resumes. */
const DROP_GRACE_MS = 15_000
/**
 * A refused stream is opened again after this, doubling to RETRY_MAX_MS.
 * EventSource gives up for good on any answer but 200 — and while a deploy
 * restarts the app, nginx answers 502 for a few seconds.
 */
const RETRY_MIN_MS = 10_000
const RETRY_MAX_MS = 5 * 60_000
/**
 * A tab hidden this long closes its stream and opens it again when shown:
 * hidden, it reads nothing anyway, and the connection it would hold is
 * worth more to the server (and, over HTTP/1.1, to the browser's six per site).
 */
const HIDDEN_CLOSE_MS = 60_000
/** On a live stream each part still reads on its own this often, in case an event was lost. */
export const SAFETY_REFRESH_MS = 120_000
/** Reads one event triggers are spread over this, so a whole office does not ask at once. */
const EVENT_JITTER_MS = 1_000
/** One part reads at most this often on events; more events in between make one read. */
const EVENT_MIN_GAP_MS = 3_000

export function ShellEventsProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession()
  const userId = session?.user?.id
  const orgId = session?.user?.organizationId
  const identity = userId ? `${userId}:${orgId ?? ""}` : null
  const supported = typeof window !== "undefined" && typeof window.EventSource === "function"
  const [mode, setMode] = useState<Mode>("connecting")
  const [generation, setGeneration] = useState(0)
  const handlers = useRef(new Map<ShellEventKind, Set<Handler>>())

  const subscribe = useCallback((kind: ShellEventKind, handler: Handler) => {
    const set = handlers.current.get(kind) ?? new Set<Handler>()
    set.add(handler)
    handlers.current.set(kind, set)
    return () => { set.delete(handler) }
  }, [])

  // False once the tab has been hidden for HIDDEN_CLOSE_MS; a tab opened in
  // the background connects when it is first shown.
  const [onScreen, setOnScreen] = useState(() => typeof document === "undefined" || document.visibilityState === "visible")
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onVisibilityChange = () => {
      if (timer) clearTimeout(timer)
      timer = undefined
      if (document.visibilityState === "visible") setOnScreen(true)
      else timer = setTimeout(() => setOnScreen(false), HIDDEN_CLOSE_MS)
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [])

  const [attempt, setAttempt] = useState(0)
  const refusals = useRef(0)
  const retrying = useRef(false)

  useEffect(() => {
    if (!identity || !supported || !onScreen) return
    const source = new EventSource("/api/v1/shell/events")
    let everConnected = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => setMode("fallback"), CONNECT_TIMEOUT_MS)
    const clearFallback = () => {
      if (fallbackTimer) clearTimeout(fallbackTimer)
      fallbackTimer = undefined
    }

    source.addEventListener("connected", () => {
      clearFallback()
      everConnected = true
      refusals.current = 0
      setMode("live")
      setGeneration((value) => value + 1)
    })
    for (const kind of KINDS) {
      source.addEventListener(kind, () => {
        for (const handler of [...(handlers.current.get(kind) ?? [])]) handler()
      })
    }
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        // Refused (a 502 during a restart, a 401). Poll, and try a new
        // stream later — spread, so the tabs of a restart do not return together.
        clearFallback()
        setMode("fallback")
        if (!retryTimer) {
          const base = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** refusals.current)
          refusals.current += 1
          retryTimer = setTimeout(() => {
            retrying.current = true
            setAttempt((value) => value + 1)
          }, base * (0.5 + Math.random()))
        }
        return
      }
      // Reconnecting by itself. Before the first `connected` the connect
      // timeout is already running; after it, poll only if it stays down.
      if (everConnected && !fallbackTimer) fallbackTimer = setTimeout(() => setMode("fallback"), DROP_GRACE_MS)
    }

    return () => {
      clearFallback()
      if (retryTimer) clearTimeout(retryTimer)
      source.close()
      // A retry keeps polling until the new stream connects; anything else
      // (hidden long enough, another person) waits for it.
      if (retrying.current) retrying.current = false
      else setMode("connecting")
    }
  }, [identity, supported, onScreen, attempt])

  // No stream to wait for: signed out, or a browser without EventSource.
  const signedOut = !identity && status !== "loading"
  const value: ShellEvents = !supported || signedOut ? NO_STREAM : { mode, generation, subscribe }
  return <ShellEventsContext.Provider value={value}>{children}</ShellEventsContext.Provider>
}

/**
 * Keep one part of the shell fresh: read it when the stream says it changed,
 * once on every (re)connect, and every SAFETY_REFRESH_MS; without a stream,
 * every `fallbackMs` as before. Only a tab on screen reads — one asked while
 * hidden reads when it is shown. `refresh` may change between renders.
 *
 * `readOnReturnAfterMs`: also read when the tab is shown again and the last
 * read is older than this — for counts that go down (read in another tab),
 * which the stream does not announce.
 */
export function useShellRefresh(
  kind: ShellEventKind,
  refresh: () => void,
  fallbackMs: number,
  enabled = true,
  options: { readOnReturnAfterMs?: number } = {},
) {
  const { mode, generation, subscribe } = useContext(ShellEventsContext)
  const latest = useRef(refresh)
  useEffect(() => {
    latest.current = refresh
  })
  const lastRead = useRef(0)
  const read = useCallback(() => {
    lastRead.current = Date.now()
    latest.current()
  }, [])

  const readOnReturnAfterMs = options.readOnReturnAfterMs
  const pending = useRef(false)
  const liveNow = useRef(false)
  useEffect(() => {
    liveNow.current = mode === "live"
  }, [mode])
  useEffect(() => {
    if (!enabled) return
    const onVisibilityChange = () => {
      // Only on a live stream: reconnecting, the read after `connected` covers
      // it; polling, the interval catches up by itself.
      if (document.visibilityState !== "visible" || !liveNow.current) return
      const stale = readOnReturnAfterMs !== undefined && Date.now() - lastRead.current > readOnReturnAfterMs
      if (!pending.current && !stale) return
      pending.current = false
      read()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [enabled, read, readOnReturnAfterMs])

  const scheduled = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (scheduled.current) clearTimeout(scheduled.current)
  }, [])
  const readSoon = useCallback(() => {
    if (document.visibilityState !== "visible") {
      pending.current = true
      return
    }
    if (scheduled.current) return
    const wait = Math.max(Math.random() * EVENT_JITTER_MS, lastRead.current + EVENT_MIN_GAP_MS - Date.now())
    scheduled.current = setTimeout(() => {
      scheduled.current = null
      if (document.visibilityState === "visible") read()
      else pending.current = true
    }, wait)
  }, [read])

  useEffect(() => {
    if (!enabled || mode !== "live" || generation === 0) return
    if (document.visibilityState === "visible") read()
    else pending.current = true
  }, [enabled, mode, generation, read])

  useEffect(() => {
    if (!enabled || mode === "connecting") return
    if (mode === "fallback") return startVisibleInterval(read, fallbackMs, { firstTickAfterMs: 0 })
    // Skipped when something else read it recently (an event, the return).
    const stopSafety = startVisibleInterval(() => {
      if (Date.now() - lastRead.current >= SAFETY_REFRESH_MS / 2) read()
    }, SAFETY_REFRESH_MS)
    const unsubscribe = subscribe(kind, readSoon)
    return () => {
      stopSafety()
      unsubscribe()
    }
  }, [enabled, mode, kind, fallbackMs, subscribe, read, readSoon])
}
