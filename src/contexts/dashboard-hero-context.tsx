"use client"

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"

type DashboardHeroContextValue = {
  /**
   * Whether the dashboard is currently showing the hero's "ask Da Vinci"
   * field. The layout uses it to decide whether a second entry point to the
   * same assistant is worth showing.
   */
  heroCommandVisible: boolean
  setHeroCommandVisible: (visible: boolean) => void
}

/**
 * One bit shared between the dashboard page and the shell around it.
 *
 * The shell owns the content-top AI search bar and the floating AI launcher;
 * the page owns the hero, whose command field opens the very same Da Vinci
 * panel. With the hero shipped unconditionally the dashboard ended up with
 * three doors to one assistant — the hero field, the floating button and the
 * voice orb above it — which is what the owner objected to.
 *
 * The hero is now a switchable widget, so "is the field on screen" is no
 * longer a constant the layout can hardcode: a tenant who turns the greeting
 * off must get the ordinary search bar back rather than no assistant at all.
 *
 * Default `true` because the greeting ships enabled: the common case renders
 * correctly on the first pass, and only a tenant who disabled it pays one
 * extra render.
 */
const DashboardHeroContext = createContext<DashboardHeroContextValue>({
  heroCommandVisible: true,
  setHeroCommandVisible: () => {},
})

export function DashboardHeroProvider({ children }: { children: ReactNode }) {
  const [heroCommandVisible, setVisible] = useState(true)
  const setHeroCommandVisible = useCallback((visible: boolean) => {
    setVisible((current) => (current === visible ? current : visible))
  }, [])
  const value = useMemo(
    () => ({ heroCommandVisible, setHeroCommandVisible }),
    [heroCommandVisible, setHeroCommandVisible],
  )

  return <DashboardHeroContext.Provider value={value}>{children}</DashboardHeroContext.Provider>
}

export function useDashboardHero(): DashboardHeroContextValue {
  return useContext(DashboardHeroContext)
}
