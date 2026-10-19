"use client"

import Image from "next/image"
import { useState } from "react"
import { Bot, CheckCheck, LifeBuoy, Loader2, MessageCircle, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DEMO_WHATSAPP_CONSENT_TEXT } from "@/lib/demo-center/demo-whatsapp-welcome"
import { DEMO_JOURNEY_STRINGS as S } from "./strings"
import type { DemoLiveWhatsAppHandle } from "./use-demo-live-whatsapp"

function bakuTime(iso: string): string {
  return new Intl.DateTimeFormat("az-AZ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Baku" }).format(new Date(iso))
}

/**
 * A real WhatsApp conversation inside the demo: the prospect's own phone and
 * the demo's AI agent (owner, 2026-10-18: «ему приходит сообщение… он
 * отвечает… AI agent отвечает»).
 *
 * Two ways to begin. The prospect writes first by link or QR — open to every
 * session; or, on a request the owner switched on, «WhatsApp-a mesaj
 * göndərin» has LeadDrive's number write first to the phone on the request
 * (the consent line says exactly that). Either way the thread opens
 * here only when a message from that phone carries this session's code — the
 * code is in the link's text, and the panel asks to add it to a reply. Then
 * the AI agent answers on WhatsApp until the end of the day, and the panel
 * shows the conversation as it happens.
 *
 * In the Service Desk chapters («ticket») the same thread can open a real
 * ticket in LeadDrive's own Service Desk, on the prospect's own press (owner,
 * 2026-10-18): «Mesajımdan bilet açılsın», and their next message becomes it.
 *
 * Nothing here names a phone number: the server only ever writes to the one
 * on the prospect's own demo request. The thread is read once for the page
 * (./use-demo-live-whatsapp.ts) and shown here.
 */
export function DemoLiveWhatsApp({ live, mode = "chat" }: { live: DemoLiveWhatsAppHandle; mode?: "chat" | "ticket" }) {
  const { state, busy, error } = live
  const [consent, setConsent] = useState(false)

  const sendWelcome = () => {
    if (!consent || busy) return
    void live.welcome()
  }

  if (!state?.enabled) return null

  const writeYourself = (
    <>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{S.whatsappIntro(state.displayNumber ?? "", state.phoneMasked ?? "")}</p>
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
    </>
  )

  return (
    <div data-testid="demo-live-whatsapp" className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-500/40 dark:bg-emerald-500/10">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <MessageCircle className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> {mode === "ticket" ? S.whatsappTicketTitle : S.whatsappTitle}
      </p>
      {mode === "ticket" && !state.proven ? (
        <p className="mt-2 text-[11px] leading-relaxed">{S.whatsappTicketBeforeProof}</p>
      ) : null}

      {!state.proven ? (
        <>
          {state.canWelcome ? (
            state.welcomeSentAt ? (
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
            )
          ) : null}

          {state.code ? (
            <p data-testid="demo-whatsapp-code" className="mt-2 rounded-md bg-background px-2 py-1.5 text-[11px] leading-relaxed">
              {state.welcomeSentAt ? S.whatsappReplyWithCode(state.code) : S.whatsappCode(state.code)}
            </p>
          ) : null}

          {/* Where our number writes first, writing first yourself is the fallback; elsewhere it is the way in. */}
          {state.canWelcome ? (
            <details className="mt-2" open={Boolean(error)}>
              <summary className="cursor-pointer text-[11px] font-medium text-emerald-800 dark:text-emerald-300">{S.whatsappWriteYourself}</summary>
              {writeYourself}
            </details>
          ) : (
            <div data-testid="demo-whatsapp-write-first">{writeYourself}</div>
          )}
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
          {mode === "ticket" ? <TicketBlock live={live} /> : null}
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

/** The Service Desk part: offer the ticket, wait for its first message, then name it. */
function TicketBlock({ live }: { live: DemoLiveWhatsAppHandle }) {
  const state = live.state
  if (!state) return null
  const ticket = state.ticket
  return (
    <div data-testid="demo-whatsapp-ticket" className="mt-3 rounded-md border border-emerald-200 bg-background p-2 text-[11px] leading-relaxed dark:border-emerald-500/40">
      <p className="mb-1 flex items-center gap-1 font-semibold"><LifeBuoy className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> Service Desk</p>
      {ticket ? (
        <p data-testid="demo-whatsapp-ticket-opened">{S.whatsappTicketOpened(ticket.number)}</p>
      ) : state.ticketModeEnded ? (
        <p>{S.whatsappTicketEnded}</p>
      ) : state.ticketMode ? (
        <p data-testid="demo-whatsapp-ticket-waiting" className="flex items-start gap-1">
          <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />{S.whatsappTicketWaiting}
        </p>
      ) : state.agentActive ? (
        <>
          <p>{S.whatsappTicketOffer}</p>
          <Button
            size="sm"
            data-testid="demo-whatsapp-ticket-start"
            onClick={() => void live.startTicket()}
            disabled={live.busy}
            className="mt-2 bg-emerald-600 hover:bg-emerald-700"
          >
            {live.busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <LifeBuoy className="mr-1 h-3.5 w-3.5" />} {S.whatsappTicketStart}
          </Button>
        </>
      ) : (
        <p>{S.whatsappTicketEnded}</p>
      )}
    </div>
  )
}
