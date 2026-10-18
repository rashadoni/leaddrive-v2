"use client"

import Image from "next/image"
import { useEffect, useState } from "react"
import { Bot, CheckCheck, Loader2, MessageCircle, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DEMO_WHATSAPP_CONSENT_TEXT } from "@/lib/demo-center/demo-whatsapp-welcome"
import { DEMO_JOURNEY_STRINGS as S } from "./strings"

/** What the server says about the live WhatsApp thread (src/lib/demo-center/demo-whatsapp.ts). */
interface LiveWhatsApp {
  enabled: boolean
  displayNumber: string | null
  link: string | null
  /** This session's code, already in the link's opening line. */
  code?: string | null
  phoneMasked?: string | null
  welcomeSentAt?: string | null
  proven?: boolean
  agentActive?: boolean
  agentRepliesLeft?: number
  agentEndsAt?: string | null
  closed?: boolean
  qr?: string | null
  messages: { id: string; direction: "inbound" | "outbound"; by?: "prospect" | "welcome" | "ai" | "team"; text: string; at: string }[]
}

const POLL_MS = 5_000

function bakuTime(iso: string): string {
  return new Intl.DateTimeFormat("az-AZ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Baku" }).format(new Date(iso))
}

/**
 * A real WhatsApp conversation inside the demo: the prospect's own phone and
 * the demo's AI agent (owner, 2026-10-18: «ему приходит сообщение… он
 * отвечает… AI agent отвечает»).
 *
 * Two ways to begin. «WhatsApp-a mesaj göndərin» has LeadDrive's number write
 * first to the phone on the request (the consent line says exactly that);
 * or the prospect writes first by link or QR. Either way the thread opens
 * here only when a message from that phone carries this session's code — the
 * code is in the link's text, and the panel asks to add it to a reply. Then
 * the AI agent answers on WhatsApp until the end of the day, and the panel
 * shows the conversation as it happens.
 *
 * Nothing here names a phone number: the server only ever writes to the one
 * on the prospect's own demo request.
 */
export function DemoLiveWhatsApp({ token }: { token: string }) {
  const [state, setState] = useState<LiveWhatsApp | null>(null)
  const [consent, setConsent] = useState(false)
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
  }, [base])

  const sendWelcome = async () => {
    if (!consent || busy) return
    setBusy(true)
    setError(null)
    const response = await fetch(base, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "welcome", consent: true }),
    }).catch(() => null)
    const payload = (await response?.json().catch(() => null)) as (LiveWhatsApp & { success?: boolean; error?: string }) | null
    setBusy(false)
    if (!payload?.success) {
      setError(payload?.error ?? S.whatsappFailed)
      return
    }
    setState(payload)
  }

  if (!state?.enabled) return null

  return (
    <div data-testid="demo-live-whatsapp" className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-500/40 dark:bg-emerald-500/10">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <MessageCircle className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> {S.whatsappTitle}
      </p>

      {!state.proven ? (
        <>
          {state.welcomeSentAt ? (
            <p data-testid="demo-whatsapp-welcome-sent" className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed">
              <CheckCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
              <span>{S.whatsappWelcomeSent(state.phoneMasked ?? "")}</span>
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              <p className="text-[11px] leading-relaxed text-muted-foreground">{S.whatsappWelcomeIntro(state.phoneMasked ?? "")}</p>
              <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-relaxed">
                <input
                  type="checkbox"
                  data-testid="demo-whatsapp-consent"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-emerald-600"
                />
                <span>{DEMO_WHATSAPP_CONSENT_TEXT}</span>
              </label>
              <Button
                size="sm"
                data-testid="demo-whatsapp-welcome"
                onClick={sendWelcome}
                disabled={!consent || busy}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />} {S.whatsappWelcomeSend}
              </Button>
            </div>
          )}

          {state.code ? (
            <p data-testid="demo-whatsapp-code" className="mt-2 rounded-md bg-background px-2 py-1.5 text-[11px] leading-relaxed">
              {state.welcomeSentAt ? S.whatsappReplyWithCode(state.code) : S.whatsappCode(state.code)}
            </p>
          ) : null}

          <details className="mt-2" open={Boolean(error)}>
            <summary className="cursor-pointer text-[11px] font-medium text-emerald-800 dark:text-emerald-300">{S.whatsappWriteYourself}</summary>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{S.whatsappIntro(state.displayNumber ?? "")}</p>
            {state.link && (
              <Button asChild size="sm" variant="outline" className="mt-2">
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
          </details>
          <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> {S.whatsappWaiting}
          </p>
        </>
      ) : (
        <>
          <div className="mt-2 space-y-1.5" aria-live="polite">
            {state.messages.map((message) => (
              <div key={message.id} className={message.direction === "outbound" ? "flex justify-end" : "flex justify-start"}>
                <span
                  className={
                    message.direction === "outbound"
                      ? "max-w-[85%] rounded-lg bg-emerald-600 px-2 py-1 text-[11px] leading-relaxed text-white"
                      : "max-w-[85%] rounded-lg bg-background px-2 py-1 text-[11px] leading-relaxed"
                  }
                >
                  {message.by === "ai" ? (
                    <span className="mb-0.5 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide opacity-80">
                      <Bot className="h-3 w-3" aria-hidden="true" /> {S.whatsappAiBadge}
                    </span>
                  ) : null}
                  {message.text}
                </span>
              </div>
            ))}
          </div>
          <p data-testid="demo-whatsapp-agent" className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            {state.agentActive && state.agentEndsAt
              ? S.whatsappAgentActive(state.agentRepliesLeft ?? 0, bakuTime(state.agentEndsAt))
              : S.whatsappAgentDone}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{S.whatsappRealNote(state.displayNumber ?? "")}</p>
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
