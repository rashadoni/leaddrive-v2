"use client"

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { useSession } from "next-auth/react"

const STORAGE_PREFIX = "leaddrive_tours_"

interface TourState {
  activeTour: string | null
  currentStep: number
  completedTours: Set<string>
}

interface TourContextValue {
  activeTour: string | null
  currentStep: number
  startTour: (tourId: string) => void
  nextStep: () => void
  prevStep: () => void
  skipTour: () => void
  completeTour: () => void
  isTourCompleted: (tourId: string) => boolean
  resetTour: (tourId: string) => void
  resetAllTours: () => void
  totalSteps: number
  setTotalSteps: (n: number) => void
}

const TourContext = createContext<TourContextValue | null>(null)

function getStorageKey(userId: string | undefined): string {
  return userId ? `${STORAGE_PREFIX}${userId}` : `${STORAGE_PREFIX}anonymous`
}

function loadCompleted(userId: string | undefined): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const stored = localStorage.getItem(getStorageKey(userId))
    return stored ? new Set(JSON.parse(stored)) : new Set()
  } catch {
    return new Set()
  }
}

function saveCompleted(completed: Set<string>, userId: string | undefined) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify([...completed]))
  } catch {}
}

export function TourProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession()
  const userId = session?.user?.id

  const [state, setState] = useState<TourState>({
    activeTour: null,
    currentStep: 0,
    completedTours: new Set(),
  })
  const [totalSteps, setTotalSteps] = useState(0)

  // Reload completed tours when user changes (login, switch tenant)
  useEffect(() => {
    setState(s => ({ ...s, activeTour: null, currentStep: 0, completedTours: loadCompleted(userId) }))
  }, [userId])

  const startTour = useCallback((tourId: string) => {
    setState(s => {
      if (s.completedTours.has(tourId)) return s
      return { ...s, activeTour: tourId, currentStep: 0 }
    })
  }, [])

  const nextStep = useCallback(() => {
    setState(s => ({ ...s, currentStep: s.currentStep + 1 }))
  }, [])

  const prevStep = useCallback(() => {
    setState(s => ({ ...s, currentStep: Math.max(0, s.currentStep - 1) }))
  }, [])

  const markComplete = useCallback((tourId: string) => {
    setState(s => {
      const completed = new Set(s.completedTours)
      completed.add(tourId)
      saveCompleted(completed, userId)
      return { ...s, activeTour: null, currentStep: 0, completedTours: completed }
    })
  }, [userId])

  const skipTour = useCallback(() => {
    if (state.activeTour) markComplete(state.activeTour)
  }, [state.activeTour, markComplete])

  const completeTour = useCallback(() => {
    if (state.activeTour) markComplete(state.activeTour)
  }, [state.activeTour, markComplete])

  const isTourCompleted = useCallback((tourId: string) => {
    return state.completedTours.has(tourId)
  }, [state.completedTours])

  const resetTour = useCallback((tourId: string) => {
    setState(s => {
      const completed = new Set(s.completedTours)
      completed.delete(tourId)
      saveCompleted(completed, userId)
      return { ...s, completedTours: completed }
    })
  }, [userId])

  const resetAllTours = useCallback(() => {
    setState(s => {
      saveCompleted(new Set(), userId)
      return { ...s, completedTours: new Set() }
    })
  }, [userId])

  return (
    <TourContext.Provider
      value={{
        activeTour: state.activeTour,
        currentStep: state.currentStep,
        startTour,
        nextStep,
        prevStep,
        skipTour,
        completeTour,
        isTourCompleted,
        resetTour,
        resetAllTours,
        totalSteps,
        setTotalSteps,
      }}
    >
      {children}
    </TourContext.Provider>
  )
}

export function useTour() {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error("useTour must be used within TourProvider")
  return ctx
}

/**
 * Hook to auto-start a tour on first visit to a page.
 * Call at the top of a page component: useAutoTour("tour-id")
 */
export function useAutoTour(tourId: string) {
  const { startTour, isTourCompleted } = useTour()

  useEffect(() => {
    // Small delay to let the page render first so targets exist
    const timer = setTimeout(() => {
      if (!isTourCompleted(tourId)) {
        startTour(tourId)
      }
    }, 800)
    return () => clearTimeout(timer)
  }, [tourId, startTour, isTourCompleted])
}
