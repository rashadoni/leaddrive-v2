"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"

const STORAGE_KEY = "ticket-last-checked"

interface TicketBadgeContextValue {
  newTicketCount: number
  setNewTicketCount: (n: number) => void
  resetBadge: () => void
  lastCheckedAt: string
  updateLastChecked: () => void
}

const TicketBadgeContext = createContext<TicketBadgeContextValue>({
  newTicketCount: 0,
  setNewTicketCount: () => {},
  resetBadge: () => {},
  lastCheckedAt: new Date().toISOString(),
  updateLastChecked: () => {},
})

export function useTicketBadge() {
  return useContext(TicketBadgeContext)
}

export function TicketBadgeProvider({ children }: { children: ReactNode }) {
  const [newTicketCount, setNewTicketCount] = useState(0)
  const [lastCheckedAt, setLastCheckedAt] = useState(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem(STORAGE_KEY) || new Date().toISOString()
    }
    return new Date().toISOString()
  })

  const updateLastChecked = useCallback(() => {
    const now = new Date().toISOString()
    setLastCheckedAt(now)
    sessionStorage.setItem(STORAGE_KEY, now)
  }, [])

  const resetBadge = useCallback(() => {
    setNewTicketCount(0)
    updateLastChecked()
  }, [updateLastChecked])

  return (
    <TicketBadgeContext.Provider
      value={{ newTicketCount, setNewTicketCount, resetBadge, lastCheckedAt, updateLastChecked }}
    >
      {children}
    </TicketBadgeContext.Provider>
  )
}
