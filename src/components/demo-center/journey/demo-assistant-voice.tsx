"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Mic, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS } from "@/lib/demo-center/assistant/voice-policy"
import { cn } from "@/lib/utils"
import { DEMO_JOURNEY_STRINGS as S } from "./strings"
import { startVoiceCapture, VoiceCaptureError, type VoiceCapture } from "./demo-voice-capture"

/**
 * «Səslə soruşun» (owner, 2026-10-20): press and hold, speak, let go — or tap
 * once, speak, tap again. At most 15 seconds; the clip goes to our server,
 * which has Google turn it into text and keeps nothing. What was heard is
 * shown («Eşitdim: …») and then asked as the question, through the same
 * assistant path as a typed one.
 *
 * Before the first clip the prospect reads what happens to the recording and
 * agrees; the microphone is not touched until then. It is opened for one clip
 * and released after it, whatever happened.
 */

/** A press held at least this long is «hold to talk»: letting go sends. Shorter is a tap. */
const HOLD_MS = 450

type VoiceState = "idle" | "consent" | "starting" | "recording" | "sending"

export interface DemoAssistantVoiceProps {
  readonly token: string
  readonly stepId: string
  /** A question is on its way: no new clip until it is answered. */
  readonly busy: boolean
  /** The voice minutes ran out (either route said so): the button gives way to the note. */
  readonly exhausted: boolean
  /** Called before the microphone opens, so the guide is not recorded talking. */
  readonly onBeforeRecord: () => void
  /** The heard text: the box asks it as the question. */
  readonly onHeard: (text: string) => void
  /** The server's refusal code, when it has one (the budget ones end voice for this demo). */
  readonly onRefused: (code: string | undefined) => void
}

export function DemoAssistantVoice({ token, stepId, busy, exhausted, onBeforeRecord, onHeard, onRefused }: DemoAssistantVoiceProps) {
  const [state, setState] = useState<VoiceState>("idle")
  const [consented, setConsented] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [heard, setHeard] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const captureRef = useRef<VoiceCapture | null>(null)
  const stateRef = useRef<VoiceState>("idle")
  const pressedAtRef = useRef<number | null>(null)
  const suppressClickRef = useRef(false)
  const startedAtRef = useRef(0)
  const mountedRef = useRef(true)

  const move = useCallback((next: VoiceState) => {
    stateRef.current = next
    if (mountedRef.current) setState(next)
  }, [])

  // Leaving the page (or the chapter) in the middle of a clip releases the microphone.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      captureRef.current?.cancel()
      captureRef.current = null
    }
  }, [])

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
    const clip = capture.stop()
    move("sending")
    try {
      const response = await fetch(
        `/api/v1/public/demo-access/${encodeURIComponent(token)}/assistant/transcribe?stepId=${encodeURIComponent(stepId)}`,
        { method: "POST", credentials: "same-origin", headers: { "Content-Type": "audio/wav" }, body: clip.wav },
      )
      const payload = await response.json().catch(() => null) as { success?: boolean; text?: string; error?: string; code?: string } | null
      if (!response.ok || !payload?.success || !payload.text) {
        onRefused(payload?.code)
        if (mountedRef.current) setError(payload?.error ?? S.voiceFailed)
        return
      }
      if (mountedRef.current) setHeard(payload.text)
      onHeard(payload.text)
    } catch {
      if (mountedRef.current) setError(S.voiceFailed)
    } finally {
      move("idle")
    }
  }, [move, onHeard, onRefused, stepId, token])

  // The fifteen-second stop fires long after `begin`: it calls the latest `send`, not the one of that moment.
  const sendRef = useRef(send)
  useEffect(() => {
    sendRef.current = send
  }, [send])

  const begin = useCallback(async () => {
    if (stateRef.current !== "idle") return
    setError(null)
    setHeard(null)
    setElapsed(0)
    onBeforeRecord()
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
  }, [move, onBeforeRecord])

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !consented) return
    suppressClickRef.current = true
    if (stateRef.current === "recording") {
      void send()
      return
    }
    if (stateRef.current === "idle") {
      pressedAtRef.current = Date.now()
      void begin()
    }
  }

  const onPointerUp = () => {
    const pressedAt = pressedAtRef.current
    pressedAtRef.current = null
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
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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
