"use client"

import { useEffect, useRef, useState } from "react"
import { CheckCircle2, Loader2, PhoneCall, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DEMO_CALL_CONSENT_TEXT, type DemoJourneyState } from "@/lib/demo-center/journey"
import { DEMO_JOURNEY_STRINGS as S } from "./strings"

/** What the server says about the live call when the session opens. Booleans only. */
export interface DemoLiveCallState {
  enabled: boolean
  requestPhoneUsable: boolean
  phoneVerified: boolean
  /** The phone can be proven through the sales organisation's Telegram bot instead of an SMS code. */
  telegramAvailable?: boolean
  /** This demo's one call was already placed: watch it, never offer another. */
  callPlaced?: boolean
}

type Stage = "phone" | "telegram" | "code" | "ready" | "waiting"

const POLL_MS = 3_000
/** A call is at most three minutes; past this the result is the manager's to find. */
const GIVE_UP_MS = 15 * 60_000

/**
 * The prospect's side of the one real AI call: prove the phone on their own
 * request (no other number can be named — owner decision 2026-09-22), agree,
 * ask for the call, and watch what happens. The story moves on only with what the
 * server reports — answered, missed, busy, refused, uncertain — or with the
 * prospect's own choice to continue without a call. Nothing here decides an
 * outcome by itself.
 */
export function DemoLiveCall({
  token,
  initial,
  onOutcome,
}: {
  token: string
  initial: DemoLiveCallState
  onOutcome: (to: DemoJourneyState) => void
}) {
  const [stage, setStage] = useState<Stage>(initial.callPlaced ? "waiting" : initial.phoneVerified ? "ready" : "phone")
  const [code, setCode] = useState("")
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(initial.callPlaced ? S.liveCallOnlyOnce : null)
  const [blocked, setBlocked] = useState<{ retryable: boolean } | null>(null)
  const [phase, setPhase] = useState<"queued" | "calling">("queued")
  const [telegramLink, setTelegramLink] = useState<{ url: string; qr: string | null } | null>(null)
  const [telegramExpired, setTelegramExpired] = useState(false)
  const startedAt = useRef<number | null>(null)
  // The parent re-renders often; polling must not restart with it.
  const outcomeRef = useRef(onOutcome)
  useEffect(() => {
    outcomeRef.current = onOutcome
  }, [onOutcome])
  const base = `/api/v1/public/demo-access/${encodeURIComponent(token)}`

  async function post(path: string, body?: unknown): Promise<Record<string, unknown> & { success?: boolean; error?: string }> {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    })
    return response.json().catch(() => ({ success: false, error: S.liveCallFailed }))
  }

  // Watch the call until the server reports how it ended.
  useEffect(() => {
    if (stage !== "waiting") return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    startedAt.current ??= Date.now()
    const tick = async () => {
      if (cancelled) return
      const response = await fetch(`${base}/call`, { cache: "no-store" }).catch(() => null)
      const payload = await response?.json().catch(() => null) as { phase?: string; outcome?: DemoJourneyState | null } | null
      if (cancelled) return
      if (payload?.phase === "ended" && payload.outcome) {
        outcomeRef.current(payload.outcome)
        return
      }
      if (payload?.phase === "calling") setPhase("calling")
      if (startedAt.current && Date.now() - startedAt.current > GIVE_UP_MS) {
        setNotice(S.liveCallTooLong)
        return
      }
      timer = setTimeout(tick, POLL_MS)
    }
    timer = setTimeout(tick, 0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [stage, base])

  // While the prospect is in Telegram, watch for the bot to accept the number.
  useEffect(() => {
    if (stage !== "telegram") return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      if (cancelled) return
      const response = await fetch(`${base}/phone/telegram`, { cache: "no-store" }).catch(() => null)
      const payload = await response?.json().catch(() => null) as { verified?: boolean; linkOpen?: boolean } | null
      if (cancelled) return
      if (payload?.verified) {
        setNotice(null)
        setStage("ready")
        return
      }
      if (payload && payload.linkOpen === false) {
        setTelegramExpired(true)
        return
      }
      timer = setTimeout(tick, POLL_MS)
    }
    timer = setTimeout(tick, POLL_MS)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [stage, base, telegramLink])

  async function openTelegram() {
    if (!consent) {
      setNotice(S.liveCallConsentRequired)
      return
    }
    setBusy(true)
    setNotice(null)
    const payload = await post("/phone/telegram", { consent: true })
    setBusy(false)
    if (payload.success && payload.state === "verified") {
      setStage("ready")
      return
    }
    if (payload.success && typeof payload.url === "string") {
      setTelegramLink({ url: payload.url, qr: typeof payload.qr === "string" ? payload.qr : null })
      setTelegramExpired(false)
      setStage("telegram")
      return
    }
    setNotice(payload.error ?? S.liveCallFailed)
  }

  async function sendCode() {
    setBusy(true)
    setNotice(null)
    const payload = await post("/phone", { useRequestPhone: true })
    setBusy(false)
    if (payload.success) {
      setStage(payload.state === "verified" ? "ready" : "code")
      return
    }
    setNotice(payload.error ?? S.liveCallFailed)
  }

  async function verify() {
    if (!consent) {
      setNotice(S.liveCallConsentRequired)
      return
    }
    setBusy(true)
    setNotice(null)
    const payload = await post("/phone/verify", { code: code.trim(), consent: true })
    setBusy(false)
    if (payload.success) setStage("ready")
    else setNotice(payload.error ?? S.liveCallFailed)
  }

  async function requestCall() {
    setBusy(true)
    setNotice(null)
    setBlocked(null)
    const payload = await post("/call")
    setBusy(false)
    if (payload.success) {
      if (payload.alreadyCalled) setNotice(S.liveCallOnlyOnce)
      if (payload.phase === "ended" && payload.outcome) {
        onOutcome(payload.outcome as DemoJourneyState)
        return
      }
      setPhase(payload.phase === "calling" ? "calling" : "queued")
      setStage("waiting")
      return
    }
    setNotice(payload.error ?? S.liveCallFailed)
    if (payload.code === "blocked") setBlocked({ retryable: payload.retryable === true })
  }

  const withoutCall = () => onOutcome(blocked ? "CALL_BLOCKED" : "CALL_DECLINED")

  return (
    <section
      data-testid="demo-live-call"
      aria-label={S.liveCallTitle}
      className="rounded-lg border border-orange-200 bg-orange-50/60 p-3 text-xs dark:border-orange-900/50 dark:bg-orange-950/20"
    >
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-orange-800 dark:text-orange-300">
        <PhoneCall className="h-3.5 w-3.5" aria-hidden="true" /> {S.liveCallTitle}
      </p>
      <p className="mt-1 leading-relaxed text-muted-foreground">{S.liveCallRules}</p>

      {stage === "phone" ? (
        <div className="mt-2 space-y-2">
          <p className="leading-relaxed text-muted-foreground">{initial.telegramAvailable ? S.liveCallIntroTelegram : S.liveCallIntro}</p>
          {initial.requestPhoneUsable ? (
            initial.telegramAvailable ? (
              <>
                <ConsentBox checked={consent} onChange={setConsent} />
                <Button size="sm" data-testid="demo-live-call-telegram" className="h-8 w-full" disabled={busy} onClick={openTelegram}>
                  <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {S.liveCallTelegram}
                </Button>
                <Button size="sm" variant="outline" className="h-8 w-full text-xs" disabled={busy} onClick={sendCode}>
                  {S.liveCallSmsInstead}
                </Button>
              </>
            ) : (
              <Button size="sm" className="h-8 w-full" disabled={busy} onClick={sendCode}>
                {S.liveCallUseRequestPhone}
              </Button>
            )
          ) : (
            <p className="leading-relaxed text-amber-900 dark:text-amber-200">{S.liveCallNoRequestPhone}</p>
          )}
        </div>
      ) : null}

      {stage === "telegram" && telegramLink ? (
        <div className="mt-2 space-y-2" data-testid="demo-live-call-telegram-link">
          <p className="leading-relaxed">{S.liveCallTelegramSteps}</p>
          {telegramExpired ? (
            <>
              <p className="leading-relaxed text-amber-900 dark:text-amber-200">{S.liveCallTelegramExpired}</p>
              <Button size="sm" className="h-8 w-full" disabled={busy} onClick={openTelegram}>
                {S.liveCallTelegramNewLink}
              </Button>
            </>
          ) : (
            <>
              {/* A real link, opened by the prospect's own tap: a window opened after an await is a blocked popup on phones. */}
              <a
                href={telegramLink.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-[#229ED9] text-xs font-semibold text-white transition-colors hover:bg-[#1c8cc2]"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" /> {S.liveCallTelegramOpen}
              </a>
              {telegramLink.qr ? (
                <figure className="hidden flex-col items-center gap-1 sm:flex">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a data URL the server just made */}
                  <img src={telegramLink.qr} alt="" className="h-28 w-28 rounded-md border border-zinc-200 bg-white p-1 dark:border-zinc-700" />
                  <figcaption className="text-center text-[11px] text-muted-foreground">{S.liveCallTelegramQr}</figcaption>
                </figure>
              ) : null}
              <p role="status" aria-live="polite" className="flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> {S.liveCallTelegramWaiting}
              </p>
            </>
          )}
          <Button size="sm" variant="outline" className="h-8 w-full text-xs" disabled={busy} onClick={sendCode}>
            {S.liveCallSmsInstead}
          </Button>
        </div>
      ) : null}

      {stage === "code" ? (
        <div className="mt-2 space-y-2">
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            aria-label={S.liveCallCodeLabel}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-center text-sm tracking-[0.4em]"
          />
          <ConsentBox checked={consent} onChange={setConsent} />
          <Button size="sm" className="h-8 w-full" disabled={busy || code.length !== 6} onClick={verify}>
            {S.liveCallVerify}
          </Button>
        </div>
      ) : null}

      {stage === "ready" ? (
        <div className="mt-2 space-y-2">
          <p className="flex items-center gap-1.5 font-medium text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {S.liveCallVerified}
          </p>
          {!blocked || blocked.retryable ? (
            <Button size="sm" className="h-8 w-full" disabled={busy} onClick={requestCall}>
              {blocked ? S.liveCallRetry : S.liveCallCallNow}
            </Button>
          ) : null}
        </div>
      ) : null}

      {stage === "waiting" ? (
        <p role="status" aria-live="polite" className="mt-2 flex items-center gap-1.5 leading-relaxed">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {phase === "calling" ? S.liveCallCalling : S.liveCallQueued}
        </p>
      ) : null}

      {notice ? <p role="alert" className="mt-2 leading-relaxed text-amber-900 dark:text-amber-200">{notice}</p> : null}

      {stage === "waiting" && notice === S.liveCallTooLong ? (
        <Button size="sm" variant="outline" className="mt-2 h-7 w-full text-xs" onClick={() => onOutcome("CALL_ATTENTION_REQUIRED")}>
          {S.liveCallContinue}
        </Button>
      ) : null}

      {stage !== "waiting" ? (
        <Button size="sm" variant="ghost" className="mt-1 h-7 w-full text-xs" disabled={busy} onClick={withoutCall}>
          {S.liveCallDecline}
        </Button>
      ) : null}
    </section>
  )
}

function ConsentBox({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 leading-relaxed">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-orange-600" />
      <span>{DEMO_CALL_CONSENT_TEXT}</span>
    </label>
  )
}
