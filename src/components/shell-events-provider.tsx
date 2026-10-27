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
/** On a live stream each part still reads on its own this often, in case an event was lost. */
export const SAFETY_REFRESH_MS = 120_000

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

  useEffect(() => {
    if (!identity || !supported) return
    const source = new EventSource("/api/v1/shell/events")
    let everConnected = false
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => setMode("fallback"), CONNECT_TIMEOUT_MS)
    const clearFallback = () => {
      if (fallbackTimer) clearTimeout(fallbackTimer)
      fallbackTimer = undefined
    }

    source.addEventListener("connected", () => {
      clearFallback()
      everConnected = true
      setMode("live")
      setGeneration((value) => value + 1)
    })
    for (const kind of KINDS) {
      source.addEventListener(kind, () => {
        for (const handler of [...(handlers.current.get(kind) ?? [])]) handler()
      })
    }
    source.onerror = () => {
      // Refused (401/403, a proxy error page): EventSource will not retry.
      if (source.readyState === EventSource.CLOSED) {
        clearFallback()
        setMode("fallback")
        return
      }
      // Reconnecting by itself. Before the first `connected` the connect
      // timeout is already running; after it, poll only if it stays down.
      if (everConnected && !fallbackTimer) fallbackTimer = setTimeout(() => setMode("fallback"), DROP_GRACE_MS)
    }

    return () => {
      clearFallback()
      source.close()
      setMode("connecting")
    }
  }, [identity, supported])

  // No stream to wait for: signed out, or a browser without EventSource.
  const signedOut = !identity && status !== "loading"
  const value: ShellEvents = !supported || signedOut ? NO_STREAM : { mode, generation, subscribe }
  return <ShellEventsContext.Provider value={value}>{children}</ShellEventsContext.Provider>
}

export function useShellEventsMode(): Mode {
  return useContext(ShellEventsContext).mode
}

/**
 * Keep one part of the shell fresh: read it when the stream says it changed,
 * once on every (re)connect, and every SAFETY_REFRESH_MS; without a stream,
 * every `fallbackMs` as before. Only a tab on screen reads — one asked while
 * hidden reads when it is shown. `refresh` may change between renders.
 */
export function useShellRefresh(kind: ShellEventKind, refresh: () => void, fallbackMs: number, enabled = true) {
  const { mode, generation, subscribe } = useContext(ShellEventsContext)
  const latest = useRef(refresh)
  useEffect(() => {
    latest.current = refresh
  })

  const pending = useRef(false)
  useEffect(() => {
    const onVisibilityChange = () => {
      if (!pending.current || document.visibilityState !== "visible") return
      pending.current = false
      latest.current()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [])
  const readNowOrOnReturn = useCallback(() => {
    if (document.visibilityState === "visible") latest.current()
    else pending.current = true
  }, [])

  useEffect(() => {
    if (!enabled || mode !== "live" || generation === 0) return
    readNowOrOnReturn()
  }, [enabled, mode, generation, readNowOrOnReturn])

  useEffect(() => {
    if (!enabled || mode === "connecting") return
    if (mode === "fallback") return startVisibleInterval(() => latest.current(), fallbackMs, { firstTickAfterMs: 0 })
    const stopSafety = startVisibleInterval(() => latest.current(), SAFETY_REFRESH_MS)
    const unsubscribe = subscribe(kind, readNowOrOnReturn)
    return () => {
      stopSafety()
      unsubscribe()
    }
  }, [enabled, mode, kind, fallbackMs, subscribe, readNowOrOnReturn])
}
