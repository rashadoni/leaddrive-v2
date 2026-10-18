"use client"

import { useCallback, useEffect, useState } from "react"
import type { DemoWhatsAppState } from "@/lib/demo-center/demo-whatsapp"
import { DEMO_JOURNEY_STRINGS as S } from "./strings"

/**
 * The demo's live WhatsApp thread for the page: one poll, shared by the
 * guide's panel (the conversation, the buttons) and the Service Desk scene
 * (the real ticket), so scenes still never fetch. Types only from the server
 * module — its code stays on the server.
 *
 * Polls while `active` (a chapter that shows the thread); a session without a
 * live thread says so once and the loop stops.
 */

/** The chapters of the prospect's own conversation. */
export const LIVE_WHATSAPP_CHAT_SECTIONS: ReadonlySet<string> = new Set(["conversation", "ai-reply", "ai-agent-setup"])
/** The Service Desk chapters: the same thread, and the ticket it can open. */
export const LIVE_WHATSAPP_TICKET_SECTIONS: ReadonlySet<string> = new Set(["sd-queue", "sd-ticket", "sd-resolve", "sd-rules", "sd-results"])

export type DemoLiveWhatsAppData = DemoWhatsAppState & { qr?: string | null }

export interface DemoLiveWhatsAppHandle {
  state: DemoLiveWhatsAppData | null
  busy: boolean
  error: string | null
  /** «WhatsApp-a mesaj göndərin»: our welcome to the request's phone. */
  welcome: () => Promise<void>
  /** «Mesajımdan bilet açılsın»: the next message opens a real ticket. */
  startTicket: () => Promise<void>
}

const POLL_MS = 5_000

export function useDemoLiveWhatsApp(token: string, active: boolean): DemoLiveWhatsAppHandle {
  const [state, setState] = useState<DemoLiveWhatsAppData | null>(null)
  const [busy, setBusy] = useState(false)
  // Each press keeps its own error until the thread moves past it.
  const [failure, setFailure] = useState<{ text: string; action: "welcome" | "ticket" } | null>(null)
  const base = `/api/v1/public/demo-access/${encodeURIComponent(token)}/whatsapp`

  // One loop: the first read straight away, then a poll — the prospect writes
  // from their own phone, and nothing else tells us when they have.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      const response = await fetch(base, { cache: "no-store", credentials: "same-origin" }).catch(() => null)
      const payload = (await response?.json().catch(() => null)) as (DemoLiveWhatsAppData & { success?: boolean }) | null
      if (cancelled) return
      if (payload?.success) {
        setState(payload)
        // A failed press is history once the thread moved past it.
        setFailure((current) => {
          if (!current) return null
          if (current.action === "welcome") return payload.proven || payload.welcomeSentAt ? null : current
          return payload.ticketMode || payload.ticket || !payload.agentActive ? null : current
        })
      }
      // A session without a live thread says so once; there is nothing to
      // watch for, so the loop stops instead of polling an empty answer.
      if (payload?.success && !payload.enabled) return
      timer = setTimeout(tick, POLL_MS)
    }
    timer = setTimeout(tick, 0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [base, active])

  const post = useCallback(async (body: Record<string, unknown>, action: "welcome" | "ticket", fallback: string) => {
    setBusy(true)
    setFailure(null)
    const response = await fetch(base, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null)
    const payload = (await response?.json().catch(() => null)) as (DemoLiveWhatsAppData & { success?: boolean; error?: string }) | null
    setBusy(false)
    if (!payload?.success) {
      setFailure({ text: payload?.error ?? fallback, action })
      return
    }
    setState((current) => ({ ...payload, qr: payload.qr ?? current?.qr ?? null }))
  }, [base])

  const welcome = useCallback(() => post({ action: "welcome", consent: true }, "welcome", S.whatsappFailed), [post])
  const startTicket = useCallback(() => post({ action: "ticket" }, "ticket", S.whatsappTicketFailed), [post])

  return { state, busy, error: failure?.text ?? null, welcome, startTicket }
}
