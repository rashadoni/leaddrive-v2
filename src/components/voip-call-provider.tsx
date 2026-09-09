"use client"

import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react"
import { useSession } from "next-auth/react"
import { IncomingCallPopup } from "./incoming-call-popup"
import { selectVoipPopupCall } from "@/lib/voip/active-call-selection"

interface ActiveCall {
  id: string
  callSid?: string | null
  direction: string
  status: string
  fromNumber: string
  toNumber: string
  contactId: string | null
  contact: { fullName: string } | null
  leadId: string | null
  lead: { contactName: string; companyName: string | null } | null
  provider?: string | null
  conversationId?: string | null
  claimedByUserId?: string | null
  claimedAt?: string | null
  browserAnswerClaimExpiresAt?: string | null
  queueId?: string | null
  createdAt?: string
}

interface VoipContextValue {
  activeCalls: ActiveCall[]
}

const VoipContext = createContext<VoipContextValue>({ activeCalls: [] })

export function useVoip() {
  return useContext(VoipContext)
}

const POLL_INTERVAL = 5000

export function VoipCallProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const currentUserId = session?.user?.id ?? null
  const hasSessionUser = Boolean(session?.user)
  const [activeCalls, setActiveCalls] = useState<ActiveCall[]>([])
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [browserCallCapability, setBrowserCallCapability] = useState<{
    userId: string
    enabled: boolean
  } | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const fetchActiveCalls = useCallback(async () => {
    if (!hasSessionUser) return
    try {
      const res = await fetch("/api/v1/calls/active")
      if (res.ok) {
        const json = await res.json()
        const nextCalls = Array.isArray(json.data) ? json.data : []
        setActiveCalls(nextCalls)
        setDismissedIds(prev => {
          const activeIds = new Set(nextCalls.map((call: ActiveCall) => call.id))
          const next = new Set([...prev].filter(id => activeIds.has(id)))
          return next.size === prev.size ? prev : next
        })
      }
    } catch {
      // Silently ignore polling errors
    }
  }, [hasSessionUser])

  useEffect(() => {
    if (!hasSessionUser) return

    const firstPoll = setTimeout(() => void fetchActiveCalls(), 0)
    intervalRef.current = setInterval(fetchActiveCalls, POLL_INTERVAL)

    return () => {
      clearTimeout(firstPoll)
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [hasSessionUser, fetchActiveCalls])

  useEffect(() => {
    if (!currentUserId) return
    let cancelled = false
    void fetch("/api/v1/voip/capabilities", { credentials: "same-origin" })
      .then((response) => response.ok ? response.json() : { browserCalls: false })
      .then((body) => {
        if (!cancelled) {
          setBrowserCallCapability({ userId: currentUserId, enabled: body?.browserCalls === true })
        }
      })
      .catch(() => {
        if (!cancelled) setBrowserCallCapability({ userId: currentUserId, enabled: false })
      })
    return () => {
      cancelled = true
    }
  }, [currentUserId])

  const handleDismiss = useCallback((callId: string) => {
    setDismissedIds(prev => new Set(prev).add(callId))
  }, [])

  const incomingCall = selectVoipPopupCall(
    activeCalls,
    dismissedIds,
    currentUserId,
  )
  const browserCallsEnabled = Boolean(
    currentUserId
    && browserCallCapability?.userId === currentUserId
    && browserCallCapability.enabled,
  )

  return (
    <VoipContext.Provider value={{ activeCalls }}>
      {children}
      {incomingCall && (
        <IncomingCallPopup
          key={incomingCall.id}
          call={incomingCall}
          browserCallsEnabled={browserCallsEnabled}
          onDismiss={() => handleDismiss(incomingCall.id)}
          onChanged={fetchActiveCalls}
        />
      )}
    </VoipContext.Provider>
  )
}
