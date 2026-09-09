"use client"

import { createContext, useCallback, useEffect, useState, type ReactNode } from "react"

export interface WallpaperDef {
  id: string
  label: string
  labelRu: string
  type: "video"
  src: string
}

export const WALLPAPERS: WallpaperDef[] = [
  {
    id: "alpine",
    label: "Sunrise Above the Clouds",
    labelRu: "Рассвет над облаками",
    type: "video",
    src: "/wallpapers/alpine-v4.mp4",
  },
  {
    id: "night-city",
    label: "Night City",
    labelRu: "Ночной город",
    type: "video",
    src: "/wallpapers/night-city.mp4",
  },
  {
    id: "ocean",
    label: "Ocean Beach",
    labelRu: "Океан",
    type: "video",
    src: "/wallpapers/ocean.mp4",
  },
  {
    id: "autumn-forest",
    label: "Autumn Forest",
    labelRu: "Осенний лес",
    type: "video",
    src: "/wallpapers/autumn-forest.mp4",
  },
]

const STORAGE_KEY = "leaddrive-wallpaper"

// Default wallpaper for EVERY user on EVERY tenant until they pick another one
// or explicitly turn it off. "Off" is persisted via OFF_SENTINEL (not by clearing
// the key) so a user who disables the wallpaper doesn't get the default
// re-applied on the next load.
export const DEFAULT_WALLPAPER = "alpine"
const OFF_SENTINEL = "none"

/**
 * Resolve the effective wallpaper id from a persisted value:
 *   OFF_SENTINEL    → null (user explicitly disabled it — stays off)
 *   a valid id      → that wallpaper
 *   null / unknown  → DEFAULT_WALLPAPER (default-on for every user / tenant)
 */
export function resolveInitialWallpaper(saved: string | null): string | null {
  if (saved === OFF_SENTINEL) return null
  if (saved && WALLPAPERS.some((w) => w.id === saved)) return saved
  return DEFAULT_WALLPAPER
}

interface WallpaperContextValue {
  wallpaper: string | null
  wallpaperDef: WallpaperDef | null
  isWallpaperActive: boolean
  setWallpaper: (id: string | null) => void
}

export const WallpaperContext = createContext<WallpaperContextValue>({
  wallpaper: null,
  wallpaperDef: null,
  isWallpaperActive: false,
  setWallpaper: () => {},
})

export function WallpaperProvider({ children }: { children: ReactNode }) {
  const [wallpaper, setWallpaperState] = useState<string | null>(null)

  // Resolve the effective wallpaper on mount (don't set data-wallpaper —
  // DashboardWallpaper handles that):
  //   OFF_SENTINEL    → off (user explicitly disabled it)
  //   saved valid id  → that wallpaper
  //   nothing saved   → DEFAULT_WALLPAPER (default-on for all users / tenants)
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setWallpaperState(resolveInitialWallpaper(localStorage.getItem(STORAGE_KEY)))
    })
    return () => {
      cancelled = true
    }
  }, [])

  const setWallpaper = useCallback((id: string | null) => {
    setWallpaperState(id)
    if (id) {
      localStorage.setItem(STORAGE_KEY, id)
    } else {
      // Persist the OFF choice so the default wallpaper isn't re-applied next load.
      localStorage.setItem(STORAGE_KEY, OFF_SENTINEL)
      document.documentElement.removeAttribute("data-wallpaper")
      document.documentElement.removeAttribute("data-wallpaper-scope")
    }
  }, [])

  const wallpaperDef = wallpaper ? WALLPAPERS.find((w) => w.id === wallpaper) ?? null : null

  return (
    <WallpaperContext.Provider
      value={{ wallpaper, wallpaperDef, isWallpaperActive: !!wallpaper, setWallpaper }}
    >
      {children}
    </WallpaperContext.Provider>
  )
}
