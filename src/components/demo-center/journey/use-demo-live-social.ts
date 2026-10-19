"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { DemoSocialInboxView, DemoSocialState } from "@/lib/demo-center/demo-social"
import { DEMO_JOURNEY_STRINGS as S } from "./strings"

/**
 * The prospect's own Facebook Page in the demo, for the page: one poll, shared
 * by the guide's panel (the connect, the code, the conversation, «Ayır») and
 * the inbox scene (the real Facebook row), so scenes still never fetch. Types
 * only from the server module — its code stays on the server.
 *
 * Polls while `active` (a chapter that shows the Page); a session without the
 * feature says so once and the loop stops. A button's answer is newer than
 * any poll that was on its way when the button was pressed: such a poll's
 * answer is dropped (the loop goes on), so it cannot put back the state the
 * button just left — «connected» after «Ayır», or the offer over a dialog
 * link the browser would not open.
 */

/** The chapters of the prospect's own conversation: the same as the live WhatsApp thread's. */
export const LIVE_SOCIAL_SECTIONS: ReadonlySet<string> = new Set(["conversation", "ai-reply", "ai-agent-setup"])

export interface DemoLiveSocialHandle {
  state: DemoSocialState | null
  busy: boolean
  error: string | null
  /** Meta's dialog, when the browser would not open a tab for it: the panel offers it as a link. */
  openUrl: string | null
  /** Our own redirect to m.me/<the Page> — the Page id never reaches this page. */
  messengerHref: string
  /** «Facebook ilə qoşun»: Meta's dialog in a new tab, opened inside the press itself. */
  connect: () => Promise<void>
  /** One of several granted Pages, by its place in the list. */
  choose: (page: number) => Promise<void>
  /** «Ayır». */
  disconnect: () => Promise<void>
}

const POLL_MS = 5_000

type Answer = (DemoSocialState & { success?: boolean; error?: string; url?: string }) | null

export function useDemoLiveSocial(token: string, active: boolean): DemoLiveSocialHandle {
  const [state, setState] = useState<DemoSocialState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openUrl, setOpenUrl] = useState<string | null>(null)
  /** Moved on by every button press, before it asks and again once it has its answer. */
  const sequence = useRef(0)
  /** The phase on screen: a button's error is cleared once a poll shows the phase has moved on. */
  const shownPhase = useRef<string | null>(null)
  const base = `/api/v1/public/demo-access/${encodeURIComponent(token)}/social`

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      const asked = sequence.current
      const response = await fetch(base, { cache: "no-store", credentials: "same-origin" }).catch(() => null)
      const payload = (await response?.json().catch(() => null)) as Answer
      if (cancelled) return
      // A button was pressed while this was on its way: its answer is the newer one.
      if (asked !== sequence.current) {
        timer = setTimeout(tick, POLL_MS)
        return
      }
      if (payload?.success) {
        setState(payload)
        // The dialog's link is history once Meta has answered.
        if (payload.phase !== "waiting") setOpenUrl(null)
        // A button's complaint was about the phase it was pressed in.
        if (shownPhase.current !== null && payload.phase !== shownPhase.current) setError(null)
        shownPhase.current = payload.phase
      }
      if (payload?.success && !payload.enabled) return
      timer = setTimeout(tick, POLL_MS)
    }
    timer = setTimeout(tick, 0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [base, active])

  const post = useCallback(async (body: Record<string, unknown>): Promise<Answer> => {
    setBusy(true)
    setError(null)
    sequence.current += 1
    const response = await fetch(base, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null)
    const payload = (await response?.json().catch(() => null)) as Answer
    // And again: a poll that set out while this was on its way may have read the row before it changed.
    sequence.current += 1
    setBusy(false)
    if (!payload?.success) {
      setError(payload?.error ?? S.socialFailed)
      return null
    }
    setState(payload)
    shownPhase.current = payload.phase
    return payload
  }, [base])

  const connect = useCallback(async () => {
    // Opened inside the press, or a popup blocker eats it; pointed at Meta once
    // the server has the dialog ready. Cut off from this page first.
    let tab: Window | null = null
    try {
      tab = window.open("", "_blank")
      if (tab) tab.opener = null
    } catch {
      tab = null
    }
    const payload = await post({ action: "start", consent: true })
    if (!payload?.url) {
      tab?.close()
      return
    }
    if (tab) {
      tab.location.replace(payload.url)
      setOpenUrl(null)
    } else {
      setOpenUrl(payload.url)
    }
  }, [post])

  const choose = useCallback(async (page: number) => {
    await post({ action: "choose", page })
  }, [post])

  const disconnect = useCallback(async () => {
    await post({ action: "disconnect" })
  }, [post])

  return { state, busy, error, openUrl, messengerHref: `${base}/messenger`, connect, choose, disconnect }
}

/** What the inbox scene draws of the Page: only a connected one, only its own conversation. */
export function demoSocialInboxView(state: DemoSocialState | null): DemoSocialInboxView | null {
  if (!state?.enabled || state.phase !== "connected" || !state.pageName || !state.code) return null
  return { pageName: state.pageName, code: state.code, proven: state.proven, messages: state.messages }
}
