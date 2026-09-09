"use client"

import { useEffect, useRef, useCallback } from "react"
import { useSession } from "next-auth/react"
import { usePathname, useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { readJsonSafely } from "@/lib/http/read-json-safely"
import { useTicketBadge } from "@/contexts/ticket-badge-context"

const POLL_INTERVAL = 12_000

const PRIORITY_STYLES: Record<string, React.CSSProperties> = {
  critical: { borderLeft: "4px solid #ef4444" },
  high: { borderLeft: "4px solid #f97316" },
}

type NewTicketCountResponse = {
  count?: number
  latest?: { id: string; ticketNumber: string; subject: string; priority: string }
}

export function TicketNotifier() {
  const { data: session } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const t = useTranslations("ticketNotification")
  const { setNewTicketCount, resetBadge, lastCheckedAt, updateLastChecked } = useTicketBadge()
  const prevCountRef = useRef(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stoppedRef = useRef(false)

  // Reset badge when user navigates to tickets page
  useEffect(() => {
    if (pathname?.startsWith("/tickets")) {
      resetBadge()
    }
  }, [pathname, resetBadge])

  const playSound = useCallback(() => {
    if (!document.hasFocus()) return
    const audio = new Audio("/sounds/new-ticket.wav")
    audio.volume = 0.5
    audio.play().catch(() => {})
  }, [])

  const showToast = useCallback((ticket: { id: string; ticketNumber: string; subject: string; priority: string }) => {
    toast(
      `${t("newTicket", { ticketNumber: ticket.ticketNumber })} — ${ticket.subject}`,
      {
        duration: 10_000,
        style: PRIORITY_STYLES[ticket.priority] || {},
        action: {
          label: t("view"),
          onClick: () => router.push(`/tickets/${ticket.id}`),
        },
      }
    )
  }, [t, router])

  const poll = useCallback(async () => {
    if (stoppedRef.current) return
    if (document.visibilityState !== "visible") return
    if (!session) return

    try {
      const res = await fetch(`/api/v1/tickets/new-count?since=${encodeURIComponent(lastCheckedAt)}`)
      // 401 (unauthenticated) or 403 (no tickets access for this org, e.g. a
      // monitoring-only tenant): stop polling instead of re-firing every tick
      // and flooding the console with the same forbidden request.
      if (res.status === 401 || res.status === 403) {
        stoppedRef.current = true
        return
      }
      if (!res.ok) return

      const data = await readJsonSafely<NewTicketCountResponse>(res)
      if (!data) return
      const count = data.count ?? 0
      const { latest } = data

      if (count > 0 && count !== prevCountRef.current) {
        setNewTicketCount(count)
        if (latest && !pathname?.startsWith("/tickets")) {
          playSound()
          showToast(latest)
        }
        updateLastChecked()
      }
      prevCountRef.current = count
    } catch {
      // Network error — skip this poll
    }
  }, [session, lastCheckedAt, setNewTicketCount, playSound, showToast, updateLastChecked, pathname])

  useEffect(() => {
    if (!session) return

    // Initial poll
    const timeout = setTimeout(poll, 2000)

    intervalRef.current = setInterval(poll, POLL_INTERVAL)

    return () => {
      clearTimeout(timeout)
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [session, poll])

  return null
}
