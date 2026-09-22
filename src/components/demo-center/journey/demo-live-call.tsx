"use client"

import { useEffect, useRef, useState } from "react"
import { CheckCircle2, Loader2, PhoneCall, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DEMO_CALL_CONSENT_TEXT, DEMO_LIVE_CALL_STEP_ID, type DemoJourneyState } from "@/lib/demo-center/journey"
import { demoLabel, demoTarget } from "./demo-target"
import { DEMO_JOURNEY_STRINGS as S } from "./strings"

/** What the server says about the live call when the session opens. Booleans only. */
export interface DemoLiveCallState {
  enabled: boolean
  requestPhoneUsable: boolean
  phoneVerified: boolean
  /** The sales organisation's Telegram bot is there to prove the phone — the only way in the demo. */
  telegramAvailable?: boolean
  /** This demo's one call was already placed: watch it, never offer another. */
  callPlaced?: boolean
}

type Stage = "phone" | "telegram" | "ready" | "waiting"

const POLL_MS = 3_000
/** A call is at most three minutes; past this the result is the manager's to find. */
const GIVE_UP_MS = 15 * 60_000

/**
 * The prospect's side of the one real AI call: prove the phone on their own
 * request (no other number can be named — owner decision 2026-09-22) through
 * Telegram — share the number with the bot, type the code it writes back
 * (no SMS in the demo, owner 2026-09-22) — agree, ask for the call, and watch
 * what happens. The story moves on only with what the server reports —
 * answered, missed, busy, refused, uncertain — or with the prospect's own
 * choice to continue without a call. Nothing here decides an outcome by
 * itself. The control to use next carries the arrow (`data-demo-target`).
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
  // url is null when the page came back to a link it made before a reload:
  // only its hash is stored, so the bot's button in Telegram is the way on.
  const [telegramLink, setTelegramLink] = useState<{ url: string | null; qr: string | null } | null>(null)
  const [telegramExpired, setTelegramExpired] = useState(false)
  /** The bot has written its code in Telegram. */
  const [codeSent, setCodeSent] = useState(false)
  const callButtonRef = useRef<HTMLButtonElement>(null)
  const telegramRef = useRef<HTMLDivElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  // Set when the code arrived while the page watched (not restored on load):
  // only then does the code box take focus.
  const focusCodeNext = useRef(false)
  const codeSentRef = useRef(false)
  const startedAt = useRef<number | null>(null)
  // The parent re-renders often; polling must not restart with it.
  const outcomeRef = useRef(onOutcome)
  useEffect(() => {
    outcomeRef.current = onOutcome
  }, [onOutcome])
  const base = `/api/v1/public/demo-access/${encodeURIComponent(token)}`
  const canProve = initial.requestPhoneUsable && initial.telegramAvailable === true

  // Never rejects: a phone coming back from Telegram often has no network for
  // a moment, and a rejected request used to leave every button disabled.
  async function post(path: string, body?: unknown): Promise<Record<string, unknown> & { success?: boolean; error?: string }> {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    }).catch(() => null)
    if (!response) return { success: false, error: S.liveCallFailed }
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

  // Back from Telegram in a reloaded tab (phones evict heavy tabs): pick up
  // where the server is — proven, a code written, or a link still open.
  useEffect(() => {
    if (initial.callPlaced || initial.phoneVerified || !initial.telegramAvailable) return
    let cancelled = false
    void (async () => {
      const response = await fetch(`${base}/phone/telegram`, { cache: "no-store" }).catch(() => null)
      const payload = await response?.json().catch(() => null) as { verified?: boolean; linkOpen?: boolean; codeSent?: boolean } | null
      if (cancelled || !payload) return
      if (payload.verified) setStage((current) => (current === "phone" ? "ready" : current))
      else if (payload.linkOpen || payload.codeSent) {
        if (payload.codeSent) {
          codeSentRef.current = true
          setCodeSent(true)
        }
        setTelegramLink((current) => current ?? { url: null, qr: null })
        setStage((current) => (current === "phone" ? "telegram" : current))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [base, initial.callPlaced, initial.phoneVerified, initial.telegramAvailable])

  // Focus follows what happened here, never what was restored on load: the
  // link once it is made, the code box once the bot has written, the call
  // button once the phone is proven.
  const previousStage = useRef<Stage | null>(null)
  useEffect(() => {
    const before = previousStage.current
    previousStage.current = stage
    if (stage === "ready" && before === "telegram") callButtonRef.current?.focus()
    if (stage === "telegram" && before === "phone" && telegramLink?.url) telegramRef.current?.focus()
  }, [stage, telegramLink])

  useEffect(() => {
    if (codeSent && focusCodeNext.current) {
      focusCodeNext.current = false
      codeRef.current?.focus()
    }
  }, [codeSent])

  // While the prospect is in Telegram, watch for the bot's code (and for a
  // proof made in another tab).
  useEffect(() => {
    if (stage !== "telegram") return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      if (cancelled) return
      const response = await fetch(`${base}/phone/telegram`, { cache: "no-store" }).catch(() => null)
      const payload = await response?.json().catch(() => null) as { verified?: boolean; linkOpen?: boolean; codeSent?: boolean } | null
      if (cancelled) return
      if (payload?.verified) {
        setNotice(null)
        setStage("ready")
        return
      }
      if (payload?.codeSent && !codeSentRef.current) {
        codeSentRef.current = true
        focusCodeNext.current = true
        setCodeSent(true)
      }
      if (payload && payload.linkOpen === false && !payload.codeSent) {
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
  // The only way on when there is nothing to prove the phone with, or the call cannot be retried.
  const declineIsTheWay = (stage === "phone" && !canProve) || (stage === "ready" && blocked !== null && !blocked.retryable)

  return (
    <section
      {...demoTarget(DEMO_LIVE_CALL_STEP_ID)}
      data-testid="demo-live-call"
      aria-label={S.liveCallTitle}
      className="rounded-lg border border-orange-200 bg-orange-50/60 p-3 text-xs dark:border-orange-900/50 dark:bg-orange-950/20"
    >
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-orange-800 dark:text-orange-300">
        <PhoneCall className="h-3.5 w-3.5" aria-hidden="true" /> {S.liveCallTitle}
      </p>
      <p className="mt-1 leading-relaxed text-muted-foreground">{S.liveCallRules}</p>
      {/* One live region for the whole card: a region that unmounts with its stage announces nothing. */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {stage === "telegram"
          ? telegramExpired ? S.liveCallTelegramExpired : codeSent ? S.liveCallCodeArrived : S.liveCallTelegramWaiting
          : stage === "ready" ? S.liveCallVerified
          : stage === "waiting" ? (phase === "calling" ? S.liveCallCalling : S.liveCallQueued)
          : ""}
      </p>

      {stage === "phone" ? (
        <div className="mt-2 space-y-2">
          {!initial.requestPhoneUsable ? (
            <p className="leading-relaxed text-amber-900 dark:text-amber-200">{S.liveCallNoRequestPhone}</p>
          ) : !initial.telegramAvailable ? (
            <p className="leading-relaxed text-amber-900 dark:text-amber-200">{S.liveCallTelegramUnavailable}</p>
          ) : (
            <>
              <p className="leading-relaxed text-muted-foreground">{S.liveCallIntroTelegram}</p>
              <ConsentBox checked={consent} onChange={setConsent} marked={!consent} />
              <Button
                size="sm"
                data-testid="demo-live-call-telegram"
                className="h-8 w-full"
                disabled={busy}
                onClick={openTelegram}
                {...(consent ? { ...demoTarget(DEMO_LIVE_CALL_STEP_ID), ...demoLabel(S.liveCallTelegram) } : {})}
              >
                <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {S.liveCallTelegram}
              </Button>
            </>
          )}
        </div>
      ) : null}

      {stage === "telegram" && telegramLink ? (
        <div ref={telegramRef} tabIndex={-1} className="mt-2 space-y-2 outline-none" data-testid="demo-live-call-telegram-link">
          {telegramExpired ? null : (
            <ol className="list-decimal space-y-0.5 pl-4 leading-relaxed">
              <li>{telegramLink.url ? S.liveCallTelegramStepOpen : S.liveCallTelegramStepOpenAgain}</li>
              <li>{S.liveCallTelegramStepShare}</li>
              <li>{S.liveCallTelegramStepCode}</li>
            </ol>
          )}
          {telegramLink.url && !telegramExpired ? (
            <>
              {/* A real link, opened by the prospect's own tap: a window opened after an await is a blocked popup on phones. */}
              <a
                href={telegramLink.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-[#1B75A8] text-xs font-semibold text-white transition-colors hover:bg-[#176A99]"
                {...(!codeSent ? { ...demoTarget(DEMO_LIVE_CALL_STEP_ID), ...demoLabel(S.liveCallTelegramOpen) } : {})}
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" /> {S.liveCallTelegramOpen}
              </a>
              {telegramLink.qr && !codeSent ? (
                <figure className="hidden flex-col items-center gap-1 sm:flex">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a data URL the server just made */}
                  <img src={telegramLink.qr} alt="" className="h-28 w-28 rounded-md border border-zinc-200 bg-white p-1 dark:border-zinc-700" />
                  <figcaption className="text-center text-[11px] text-muted-foreground">{S.liveCallTelegramQr}</figcaption>
                </figure>
              ) : null}
            </>
          ) : null}
          {telegramExpired ? (
            <p className="leading-relaxed text-amber-900 dark:text-amber-200">{S.liveCallTelegramExpired}</p>
          ) : (
            <>
              <p aria-hidden="true" className="flex items-center gap-1.5 text-muted-foreground">
                {codeSent ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {codeSent ? S.liveCallCodeArrived : S.liveCallTelegramWaiting}
              </p>
              <input
                ref={codeRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                aria-label={S.liveCallCodeLabel}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-center text-sm tracking-[0.4em]"
                {...(codeSent && code.length !== 6 ? { ...demoTarget(DEMO_LIVE_CALL_STEP_ID), ...demoLabel(S.liveCallCodeHere) } : {})}
              />
              <Button
                size="sm"
                className="h-8 w-full"
                disabled={busy || code.length !== 6}
                onClick={verify}
                {...(code.length === 6 ? { ...demoTarget(DEMO_LIVE_CALL_STEP_ID), ...demoLabel(S.liveCallVerify) } : {})}
              >
                {S.liveCallVerify}
              </Button>
            </>
          )}
          {telegramExpired || !telegramLink.url ? (
            <>
              {/* A new link needs the agreement again (it is not kept across a
                  reload). The box stays mounted when ticked, so it can be read and unticked. */}
              <ConsentBox checked={consent} onChange={setConsent} marked={telegramExpired && !consent} />
              <Button
                size="sm"
                variant={telegramExpired ? "default" : "outline"}
                className="h-8 w-full text-xs"
                disabled={busy}
                onClick={openTelegram}
                {...(telegramExpired && consent ? { ...demoTarget(DEMO_LIVE_CALL_STEP_ID), ...demoLabel(S.liveCallTelegramNewLink) } : {})}
              >
                {S.liveCallTelegramNewLink}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {stage === "ready" ? (
        <div className="mt-2 space-y-2">
          <p className="flex items-center gap-1.5 font-medium text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {S.liveCallVerified}
          </p>
          {!blocked || blocked.retryable ? (
            <Button
              ref={callButtonRef}
              size="sm"
              className="h-8 w-full"
              disabled={busy}
              onClick={requestCall}
              {...demoTarget(DEMO_LIVE_CALL_STEP_ID)}
              {...demoLabel(blocked ? S.liveCallRetry : S.liveCallCallNow)}
            >
              {blocked ? S.liveCallRetry : S.liveCallCallNow}
            </Button>
          ) : null}
        </div>
      ) : null}

      {stage === "waiting" ? (
        <p aria-hidden="true" className="mt-2 flex items-center gap-1.5 leading-relaxed">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {phase === "calling" ? S.liveCallCalling : S.liveCallQueued}
        </p>
      ) : null}

      {notice ? <p role="alert" className="mt-2 leading-relaxed text-amber-900 dark:text-amber-200">{notice}</p> : null}

      {stage === "waiting" && notice === S.liveCallTooLong ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-2 h-7 w-full text-xs"
          onClick={() => onOutcome("CALL_ATTENTION_REQUIRED")}
          {...demoTarget(DEMO_LIVE_CALL_STEP_ID)}
          {...demoLabel(S.liveCallContinue)}
        >
          {S.liveCallContinue}
        </Button>
      ) : null}

      {stage !== "waiting" ? (
        <Button
          size="sm"
          variant="ghost"
          className="mt-1 h-7 w-full text-xs"
          disabled={busy}
          onClick={withoutCall}
          {...(declineIsTheWay ? { ...demoTarget(DEMO_LIVE_CALL_STEP_ID), ...demoLabel(S.liveCallDecline) } : {})}
        >
          {S.liveCallDecline}
        </Button>
      ) : null}
    </section>
  )
}

function ConsentBox({ checked, onChange, marked = false }: { checked: boolean; onChange: (value: boolean) => void; marked?: boolean }) {
  return (
    <label
      className="flex cursor-pointer items-start gap-2 leading-relaxed"
      {...(marked ? { ...demoTarget(DEMO_LIVE_CALL_STEP_ID), ...demoLabel(S.liveCallConsentHere) } : {})}
    >
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-orange-600" />
      <span>{DEMO_CALL_CONSENT_TEXT}</span>
    </label>
  )
}
