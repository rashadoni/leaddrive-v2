"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Mic, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS } from "@/lib/demo-center/assistant/voice-policy"
import { cn } from "@/lib/utils"
import { DEMO_JOURNEY_STRINGS as S } from "./strings"
import type { GuideMicrophoneChange } from "./demo-guide-voice"
import { startVoiceCapture, VoiceCaptureError, type VoiceCapture } from "./demo-voice-capture"

/**
 * «Səslə soruşun» (owner, 2026-10-20): press and hold, speak, let go — or tap
 * once, speak, tap again. At most 15 seconds; the clip goes to our server,
 * which has Google turn it into text and keeps nothing. What was heard is
 * shown («Eşitdim: …») and then asked as the question, through the same
 * assistant path as a typed one — or, while another question is still being
 * answered, left in the box for one press of «Soruş».
 *
 * Before the first clip the prospect reads what happens to the recording and
 * agrees; the microphone is not touched until then. It is opened for one clip
 * and released after it, whatever happened.
 *
 * Only a press records. A finger that starts on the button and slides off
 * across the page is a scroll, not a question: the clip is thrown away, not
 * sent, and so is one the browser cancels. When the voice minutes run out
 * while a clip is open, it is released there and then — the button is gone,
 * and a microphone with no button to stop it would send by itself at 15 s.
 *
 * Every move of the microphone is reported (`onMicrophoneChange`): the guide
 * must not talk into the question, and a clip thrown away must not cost the
 * prospect what the guide was saying or an answer on its way. A clip sent is
 * a question only once it comes back as text: one that is silent, too short
 * or not heard (a refusal, a failure) asks nothing, and is thrown away too.
 */

/** A press held at least this long is «hold to talk»: letting go sends. Shorter is a tap. */
const HOLD_MS = 450
/** A touch that travels this far before it is a hold is a swipe across the page. */
const SWIPE_PX = 10

type VoiceState = "idle" | "consent" | "starting" | "recording" | "sending"

/** What a move of the state machine did to the microphone, if anything. */
function microphoneChange(from: VoiceState, to: VoiceState): GuideMicrophoneChange | null {
  if (from === to) return null
  if (to === "starting") return "opening"
  if (to === "recording") return "open"
  // Whether the clip carried a question only the reply says: `send` reports it.
  if (to === "sending") return null
  if (from !== "starting" && from !== "recording") return null
  return "discarded"
}

export interface DemoAssistantVoiceProps {
  readonly token: string
  readonly stepId: string
  /** A question is on its way: no new clip until it is answered. */
  readonly busy: boolean
  /** The voice minutes ran out (either route said so): the button gives way to the note, and an open clip is released. */
  readonly exhausted: boolean
  /**
   * The microphone is being asked for (`opening`), records (`open`), or is
   * done with — its clip thrown away (`discarded`) or heard as a question
   * (`sent`, just before `onHeard`). A clip on its way to be heard is
   * neither yet: it is `sent` when it comes back as text and `discarded` when
   * it comes back with none, refused or failed. Only a real move is
   * reported, each once.
   */
  readonly onMicrophoneChange: (change: GuideMicrophoneChange) => void
  /** The heard text: the box asks it as the question, or holds it while another is being answered. */
  readonly onHeard: (text: string) => void
  /** The server's refusal code, when it has one, and whether it says voice is over for this demo. */
  readonly onRefused: (code: string | undefined, exhausted?: boolean) => void
}

export function DemoAssistantVoice({ token, stepId, busy, exhausted, onMicrophoneChange, onHeard, onRefused }: DemoAssistantVoiceProps) {
  const [state, setState] = useState<VoiceState>("idle")
  const [consented, setConsented] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [heard, setHeard] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const captureRef = useRef<VoiceCapture | null>(null)
  const stateRef = useRef<VoiceState>("idle")
  const pressedAtRef = useRef<number | null>(null)
  // Where a press began, and whether a finger made it: a touch that moves is a swipe.
  const pressPointRef = useRef<{ x: number; y: number; touch: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const startedAtRef = useRef(0)
  const mountedRef = useRef(true)
  const exhaustedRef = useRef(exhausted)
  // The state machine moves long after a render (a microphone opening, a reply): it reports to the latest callback.
  const onMicrophoneChangeRef = useRef(onMicrophoneChange)
  useEffect(() => {
    onMicrophoneChangeRef.current = onMicrophoneChange
  }, [onMicrophoneChange])

  const move = useCallback((next: VoiceState) => {
    const change = microphoneChange(stateRef.current, next)
    stateRef.current = next
    if (mountedRef.current) setState(next)
    if (change) onMicrophoneChangeRef.current(change)
  }, [])

  // The clip is thrown away, not sent. During «starting» the capture is not
  // there yet: leaving that state makes `begin` cancel it the moment it opens.
  const discard = useCallback(() => {
    captureRef.current?.cancel()
    captureRef.current = null
    pressedAtRef.current = null
    pressPointRef.current = null
    if (stateRef.current === "recording" || stateRef.current === "starting") move("idle")
  }, [move])

  // Leaving the page (or the chapter) in the middle of a clip releases the microphone.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      captureRef.current?.cancel()
      captureRef.current = null
      // Thrown away, and said so: the guide would otherwise stay silent for good.
      // A clip still being heard is said to be thrown away here and not again
      // when its reply lands: it would reach the guide of whatever page is there by then.
      if (stateRef.current === "sending") {
        move("idle")
        onMicrophoneChangeRef.current("discarded")
      } else if (stateRef.current === "starting" || stateRef.current === "recording") move("idle")
    }
  }, [move])

  // The minutes ran out (a spoken answer's refusal can land mid-clip): the
  // button gives way to the note, so the microphone goes with it.
  useEffect(() => {
    exhaustedRef.current = exhausted
    // eslint-disable-next-line react-hooks/set-state-in-effect -- releases the microphone, a device outside React; the one move to «idle» is part of that release
    if (exhausted) discard()
  }, [exhausted, discard])

  useEffect(() => {
    if (state !== "recording") return
    const timer = window.setInterval(() => {
      setElapsed(Math.min(DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS, Math.floor((Date.now() - startedAtRef.current) / 1000)))
    }, 250)
    return () => window.clearInterval(timer)
  }, [state])

  const send = useCallback(async () => {
    const capture = captureRef.current
    if (!capture || stateRef.current !== "recording") return
    captureRef.current = null
    // No voice left: what was recorded goes nowhere.
    if (exhaustedRef.current) {
      capture.cancel()
      move("idle")
      return
    }
    const clip = capture.stop()
    move("sending")
    // The clip is a question only if it comes back as text. Silent, too short,
    // refused or failed, it asks nothing: the guide goes on with what it was
    // saying and an answer on its way, as after a clip thrown away.
    let heardText: string | null = null
    try {
      const response = await fetch(
        `/api/v1/public/demo-access/${encodeURIComponent(token)}/assistant/transcribe?stepId=${encodeURIComponent(stepId)}`,
        { method: "POST", credentials: "same-origin", headers: { "Content-Type": "audio/wav" }, body: clip.wav },
      )
      const payload = await response.json().catch(() => null) as { success?: boolean; text?: string; error?: string; code?: string; exhausted?: boolean } | null
      if (!response.ok || !payload?.success || !payload.text) {
        onRefused(payload?.code, payload?.exhausted)
        if (mountedRef.current) setError(payload?.error ?? S.voiceFailed)
      } else {
        heardText = payload.text
      }
    } catch {
      if (mountedRef.current) setError(S.voiceFailed)
    }
    // Left the page meanwhile: the unmount already said it was thrown away.
    if (stateRef.current !== "sending") return
    move("idle")
    onMicrophoneChangeRef.current(heardText ? "sent" : "discarded")
    if (!heardText) return
    if (mountedRef.current) setHeard(heardText)
    onHeard(heardText)
  }, [move, onHeard, onRefused, stepId, token])

  // The fifteen-second stop fires long after `begin`: it calls the latest `send`, not the one of that moment.
  const sendRef = useRef(send)
  useEffect(() => {
    sendRef.current = send
  }, [send])

  const begin = useCallback(async () => {
    if (stateRef.current !== "idle" || exhaustedRef.current) return
    setError(null)
    setHeard(null)
    setElapsed(0)
    move("starting")
    try {
      const capture = await startVoiceCapture({
        maxSeconds: DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS,
        // Fifteen seconds is the whole question: it goes as it is.
        onFull: () => { void sendRef.current() },
      })
      // `move` changed the ref; read it again rather than trust the check above.
      if (!mountedRef.current || (stateRef.current as VoiceState) !== "starting") {
        capture.cancel()
        return
      }
      captureRef.current = capture
      startedAtRef.current = Date.now()
      move("recording")
    } catch (failure) {
      const kind = failure instanceof VoiceCaptureError ? failure.kind : "failed"
      setError(kind === "denied" ? S.voiceDenied : kind === "no_microphone" ? S.voiceNoMicrophone : kind === "unsupported" ? S.voiceUnsupported : S.voiceFailed)
      move("idle")
    }
  }, [move])

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !consented) return
    suppressClickRef.current = true
    if (stateRef.current === "recording") {
      void send()
      return
    }
    if (stateRef.current === "idle") {
      pressedAtRef.current = Date.now()
      pressPointRef.current = { x: event.clientX, y: event.clientY, touch: event.pointerType === "touch" }
      void begin()
    }
  }

  // A finger that travels before the press becomes a hold was scrolling the
  // page: no click follows it, and a tap would otherwise leave the clip open.
  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const pressedAt = pressedAtRef.current
    const from = pressPointRef.current
    if (pressedAt === null || !from?.touch || Date.now() - pressedAt >= HOLD_MS) return
    if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > SWIPE_PX) discard()
  }

  const onPointerUp = () => {
    const pressedAt = pressedAtRef.current
    pressedAtRef.current = null
    pressPointRef.current = null
    // Held: letting go sends. A tap leaves it listening until the next press.
    if (pressedAt !== null && Date.now() - pressedAt >= HOLD_MS && stateRef.current === "recording") void send()
  }

  // Keyboard and assistive technology arrive here without a pointer: the button toggles.
  const onClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (!consented) {
      move("consent")
      return
    }
    if (stateRef.current === "idle") void begin()
    else if (stateRef.current === "recording") void send()
  }

  if (exhausted) {
    return <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground" data-testid="demo-assistant-voice-exhausted">{S.voiceExhausted}</p>
  }

  if (state === "consent") {
    return (
      <div className="mt-2 rounded-md border border-zinc-200 p-2.5 text-xs leading-relaxed dark:border-zinc-700" data-testid="demo-assistant-voice-consent">
        <p className="font-semibold">{S.voiceConsentTitle}</p>
        <p className="mt-1 text-muted-foreground">{S.voiceConsentBody(DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS)}</p>
        <div className="mt-2 flex flex-col gap-1.5 sm:flex-row">
          <Button
            type="button"
            size="sm"
            className="h-auto min-h-8 flex-1 whitespace-normal py-1 text-xs"
            onClick={() => {
              setConsented(true)
              move("idle")
              void begin()
            }}
          >
            {S.voiceConsentAccept}
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-auto min-h-8 flex-1 whitespace-normal py-1 text-xs" onClick={() => move("idle")}>
            {S.voiceConsentDecline}
          </Button>
        </div>
      </div>
    )
  }

  const recording = state === "recording"
  const label = recording
    ? S.voiceStop(elapsed)
    : state === "starting"
      ? S.voiceStarting
      : state === "sending"
        ? S.voiceSending
        : S.voiceAsk

  return (
    <div className="mt-2" data-testid="demo-assistant-voice" data-voice-state={state}>
      <Button
        type="button"
        size="sm"
        variant={recording ? "destructive" : "outline"}
        aria-pressed={recording}
        // Not disabled while the microphone opens: a held press must still be let go of here.
        disabled={state === "sending" || (busy && state === "idle")}
        className={cn("h-auto min-h-9 w-full touch-none select-none whitespace-normal py-1.5 text-xs [-webkit-touch-callout:none]", recording && "animate-pulse")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        // The browser took the pointer back (a system gesture, a call): not a release, so nothing is sent.
        onPointerCancel={discard}
        onPointerLeave={onPointerUp}
        onClick={onClick}
        onContextMenu={(event) => event.preventDefault()}
        data-testid="demo-assistant-voice-button"
      >
        {recording ? <Square className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <Mic className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        {label}
      </Button>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground" aria-live="polite">
        {recording ? S.voiceListening(DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS) : S.voiceHint}
      </p>
      {heard ? (
        <p className="mt-1 break-words text-xs leading-relaxed [overflow-wrap:anywhere]" data-testid="demo-assistant-voice-heard">{S.voiceHeard(heard)}</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs leading-relaxed text-amber-900">{error}</p>
      ) : null}
    </div>
  )
}
