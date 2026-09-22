"use client"

import Image from "next/image"
import { useEffect, useState } from "react"
import { Loader2, MessageCircle, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DemoLimitNotice } from "./demo-limit-notice"
import { DEMO_JOURNEY_STRINGS as S } from "./strings"

/** What the server says about the live WhatsApp thread. */
interface LiveWhatsApp {
  enabled: boolean
  displayNumber: string | null
  link: string | null
  qr?: string | null
  windowOpen: boolean
  sent: number
  left: number
  messages: { id: string; direction: "inbound" | "outbound"; text: string; at: string }[]
}

const POLL_MS = 5_000

/**
 * A real WhatsApp conversation inside the demo (owner, 2026-09-22: «пусть
 * будут посылаться с номера который у меня уже зарегистрирован»).
 *
 * The prospect writes to LeadDrive's own number first — by link on a phone,
 * by QR on a laptop. That inbound is what WhatsApp requires before a business
 * may answer in free text, so until it arrives the panel only shows the way
 * to write; afterwards the thread appears and the prospect can answer from
 * the demo, five times (`DEMO_WHATSAPP_MAX_SENDS`), each one leaving our
 * number and landing on their phone. The limit says why it stops.
 *
 * Nothing here names a phone number: the server only ever writes to the one
 * on the prospect's own demo request.
 */
export function DemoLiveWhatsApp({ token }: { token: string }) {
  const [state, setState] = useState<LiveWhatsApp | null>(null)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const base = `/api/v1/public/demo-access/${encodeURIComponent(token)}/whatsapp`

  // One loop: the first read straight away, then a poll — the prospect writes
  // from their own phone, and nothing else tells us when they have.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      const response = await fetch(base, { cache: "no-store", credentials: "same-origin" }).catch(() => null)
      const payload = (await response?.json().catch(() => null)) as (LiveWhatsApp & { success?: boolean }) | null
      if (cancelled) return
      if (payload?.success) setState(payload)
      timer = setTimeout(tick, POLL_MS)
    }
    timer = setTimeout(tick, 0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [base])

  const send = async () => {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    const response = await fetch(base, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).catch(() => null)
    const payload = (await response?.json().catch(() => null)) as (LiveWhatsApp & { success?: boolean; error?: string }) | null
    setBusy(false)
    if (!payload?.success) {
      setError(payload?.error ?? S.whatsappFailed)
      return
    }
    setState(payload)
    setDraft("")
  }

  if (!state?.enabled) return null

  const canSend = state.windowOpen && state.left > 0

  return (
    <div data-testid="demo-live-whatsapp" className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-500/40 dark:bg-emerald-500/10">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <MessageCircle className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> {S.whatsappTitle}
      </p>

      {!state.windowOpen ? (
        <>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{S.whatsappIntro(state.displayNumber ?? "")}</p>
          {state.link && (
            <Button asChild size="sm" className="mt-2 bg-emerald-600 hover:bg-emerald-700">
              <a href={state.link} target="_blank" rel="noopener noreferrer">
                <Send className="mr-1 h-3.5 w-3.5" /> {S.whatsappWrite}
              </a>
            </Button>
          )}
          {state.qr && (
            <div className="mt-2">
              <Image src={state.qr} alt={S.whatsappQr} width={110} height={110} className="rounded bg-white p-1" unoptimized />
              <p className="mt-1 text-[10px] text-muted-foreground">{S.whatsappQr}</p>
            </div>
          )}
          <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> {S.whatsappWaiting}
          </p>
        </>
      ) : (
        <>
          <div className="mt-2 max-h-52 space-y-1.5 overflow-y-auto" aria-live="polite">
            {state.messages.map((message) => (
              <div key={message.id} className={message.direction === "outbound" ? "flex justify-end" : "flex justify-start"}>
                <span
                  className={
                    message.direction === "outbound"
                      ? "max-w-[85%] rounded-lg bg-emerald-600 px-2 py-1 text-[11px] leading-relaxed text-white"
                      : "max-w-[85%] rounded-lg bg-background px-2 py-1 text-[11px] leading-relaxed"
                  }
                >
                  {message.text}
                </span>
              </div>
            ))}
          </div>

          <textarea
            rows={2}
            value={draft}
            disabled={!canSend || busy}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={S.whatsappPlaceholder}
            className="mt-2 w-full resize-none rounded-lg border border-zinc-200 bg-background p-2 text-xs disabled:opacity-60 dark:border-zinc-700"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={send} disabled={!canSend || busy || draft.trim().length === 0} className="bg-emerald-600 hover:bg-emerald-700">
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />} {S.replySend}
            </Button>
            {state.left > 0 && <span className="text-[10px] tabular-nums text-muted-foreground">{S.replyLeft(state.left, state.left + state.sent)}</span>}
          </div>
          {state.left === 0 && <DemoLimitNotice className="mt-2" body={S.whatsappLimitBody(state.sent)} />}
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{S.whatsappRealNote(state.displayNumber ?? "")}</p>
        </>
      )}

      {error && (
        <p role="status" className="mt-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          {error}
        </p>
      )}
    </div>
  )
}
