"use client"

import { useEffect, useRef, useCallback } from "react"
import { useSession } from "next-auth/react"
import { usePathname, useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { readJsonSafely } from "@/lib/http/read-json-safely"
import { startVisibleInterval } from "@/lib/client/visible-interval"
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
  const stoppedRef = useRef(false)
  const hasSession = Boolean(session)

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

  // The poll reads these when it runs. As its dependencies they restarted it,
  // with an extra request 2 s later, on every navigation, every session read
  // and every new ticket.
  const current = useRef({ lastCheckedAt, pathname, setNewTicketCount, playSound, showToast, updateLastChecked })
  useEffect(() => {
    current.current = { lastCheckedAt, pathname, setNewTicketCount, playSound, showToast, updateLastChecked }
  })

  const poll = useCallback(async () => {
    if (stoppedRef.current) return
    try {
      const res = await fetch(`/api/v1/tickets/new-count?since=${encodeURIComponent(current.current.lastCheckedAt)}`)
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
        const now = current.current
        now.setNewTicketCount(count)
        if (latest && !now.pathname?.startsWith("/tickets")) {
          now.playSound()
          now.showToast(latest)
        }
        now.updateLastChecked()
      }
      prevCountRef.current = count
    } catch {
      // Network error — skip this poll
    }
  }, [])

  useEffect(() => {
    if (!hasSession) return
    // First poll 2 s after mount; on screen only, and at once when the tab comes back.
    return startVisibleInterval(() => void poll(), POLL_INTERVAL, { firstTickAfterMs: 2000 })
  }, [hasSession, poll])

  return null
}
