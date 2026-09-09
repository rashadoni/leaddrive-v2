"use client"

/**
 * App Launcher personalization — per-user favorites + recently-used modules.
 *
 * Two-tier persistence: localStorage is the instant optimistic cache (snappy
 * UI, survives offline), the server row is the cross-device source of truth.
 * On mount we hydrate from localStorage immediately, then reconcile with the
 * server. Writes go to localStorage right away and to the server debounced.
 *
 * A `<RouteTracker>` mounted by the provider records the visited module on
 * every route change — the single, cheap navigation hook (no per-page wiring).
 */
import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from "react"
import { usePathname } from "next/navigation"
import { matchNavItem } from "@/lib/nav-items"

const FAV_KEY = "ld-app-favorites"
const REC_KEY = "ld-app-recents"
const MAX_RECENTS = 12
const SYNC_DEBOUNCE_MS = 1500

type Recent = { href: string; at: number }

interface LauncherPrefs {
  /** Pinned module hrefs, in pin order. */
  favorites: string[]
  /** Recently-visited module hrefs, most-recent first. */
  recents: string[]
  isFavorite: (href: string) => boolean
  toggleFavorite: (href: string) => void
  recordVisit: (href: string | undefined) => void
}

const Ctx = createContext<LauncherPrefs | null>(null)

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(key) : null
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

export function LauncherPrefsProvider({ children }: { children: React.ReactNode }) {
  const [favorites, setFavorites] = useState<string[]>([])
  const [recents, setRecents] = useState<Recent[]>([])

  const hydrated = useRef(false)       // server load finished → safe to PUT
  const skipFirstPersist = useRef(true) // don't persist the empty initial render
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Hydrate: localStorage first (instant), then server (authoritative).
  useEffect(() => {
    setFavorites(readLS<string[]>(FAV_KEY, []))
    setRecents(readLS<Recent[]>(REC_KEY, []))

    let cancelled = false
    fetch("/api/v1/users/me/preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.success) return
        const srvFav: string[] = Array.isArray(j.data?.favorites) ? j.data.favorites : []
        const srvRec: Recent[] = Array.isArray(j.data?.recents) ? j.data.recents : []
        // Server wins for favorites; recents are unioned by href (newest `at`)
        // so visits recorded before hydration aren't lost.
        setFavorites(srvFav)
        setRecents((prev) => mergeRecents(srvRec, prev))
      })
      .catch(() => {})
      .finally(() => {
        hydrated.current = true
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Persist on change: localStorage always (after the initial render), server
  // only once hydrated so we never PUT empty initial state over good data.
  useEffect(() => {
    if (skipFirstPersist.current) {
      skipFirstPersist.current = false
      return
    }
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(favorites))
      localStorage.setItem(REC_KEY, JSON.stringify(recents))
    } catch {}

    if (!hydrated.current) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      fetch("/api/v1/users/me/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorites, recents }),
      }).catch(() => {})
    }, SYNC_DEBOUNCE_MS)
  }, [favorites, recents])

  useEffect(() => () => clearTimeout(saveTimer.current), [])

  const toggleFavorite = useCallback((href: string) => {
    setFavorites((prev) =>
      prev.includes(href) ? prev.filter((h) => h !== href) : [...prev, href]
    )
  }, [])

  const recordVisit = useCallback((href: string | undefined) => {
    if (!href) return
    setRecents((prev) => {
      const at = Date.now()
      return [{ href, at }, ...prev.filter((r) => r.href !== href)].slice(0, MAX_RECENTS)
    })
  }, [])

  const isFavorite = useCallback((href: string) => favorites.includes(href), [favorites])

  const value: LauncherPrefs = {
    favorites,
    recents: recents.map((r) => r.href),
    isFavorite,
    toggleFavorite,
    recordVisit,
  }

  return (
    <Ctx.Provider value={value}>
      <RouteTracker />
      {children}
    </Ctx.Provider>
  )
}

export function useLauncherPrefs(): LauncherPrefs {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useLauncherPrefs must be used within LauncherPrefsProvider")
  return ctx
}

/** Records the visited module on every route change. */
function RouteTracker() {
  const pathname = usePathname()
  const { recordVisit } = useLauncherPrefs()
  useEffect(() => {
    recordVisit(matchNavItem(pathname)?.href)
  }, [pathname, recordVisit])
  return null
}

/** Union two recent lists by href, keeping the newest `at`, newest-first. */
function mergeRecents(primary: Recent[], secondary: Recent[]): Recent[] {
  const byHref = new Map<string, number>()
  for (const r of [...primary, ...secondary]) {
    const prev = byHref.get(r.href)
    if (prev === undefined || r.at > prev) byHref.set(r.href, r.at)
  }
  return [...byHref.entries()]
    .map(([href, at]) => ({ href, at }))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_RECENTS)
}
