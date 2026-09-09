"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, PhoneCall, PhoneIncoming, PhoneOff, X } from "lucide-react"
import type { InboxCallLog } from "@/lib/inbox-channels"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  createWhatsAppCallAnswer,
  type WhatsAppCallAnswerSession,
} from "@/lib/whatsapp-call-rtc"

type LocaleKey = "en" | "ru" | "az"
type BusyAction = "answer" | "reject" | "terminate" | null

interface WhatsAppCallControlsProps {
  call: InboxCallLog
  headers: Record<string, string>
  locale: string
  onChanged?: () => void | Promise<void>
}

interface SessionPayload {
  sdp: string
  sdpType: "offer" | "answer"
  expiresAt: string
}

type WhatsAppCallAction = "pre_accept" | "accept" | "reject" | "terminate"

const ACTIVE_STATUSES = new Set(["initiated", "ringing", "in-progress"])
const TERMINAL_STATUSES = new Set(["completed", "failed", "busy", "no-answer", "canceled", "rejected"])

const COPY = {
  en: {
    incoming: "WhatsApp call",
    answering: "Connecting...",
    active: "Call active",
    answer: "Answer",
    reject: "Reject",
    end: "End",
    expired: "Call session expired. Ask the client to call again.",
    micDenied: "Microphone permission is required to answer.",
    unsupported: "This browser cannot answer WebRTC calls.",
    failed: "WhatsApp call failed: {error}",
  },
  ru: {
    incoming: "WhatsApp звонок",
    answering: "Соединяем...",
    active: "Звонок активен",
    answer: "Ответить",
    reject: "Отклонить",
    end: "Завершить",
    expired: "Сессия звонка истекла. Попросите клиента перезвонить.",
    micDenied: "Для ответа нужен доступ к микрофону.",
    unsupported: "Этот браузер не может принять WebRTC звонок.",
    failed: "WhatsApp звонок не сработал: {error}",
  },
  az: {
    incoming: "WhatsApp zəngi",
    answering: "Qoşulur...",
    active: "Zəng aktivdir",
    answer: "Cavabla",
    reject: "Rədd et",
    end: "Bitir",
    expired: "Zəng sessiyası bitib. Müştəridən yenidən zəng etməsini istəyin.",
    micDenied: "Cavab vermək üçün mikrofon icazəsi lazımdır.",
    unsupported: "Bu brauzer WebRTC zəngi qəbul edə bilmir.",
    failed: "WhatsApp zəngi alınmadı: {error}",
  },
} as const

function localeKey(locale: string): LocaleKey {
  if (locale === "ru" || locale === "az") return locale
  return "en"
}

function formatCopy(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "")
}

function errorMessage(error: unknown, copy: typeof COPY[LocaleKey]): string {
  const raw = error instanceof Error ? error.message : String(error || "unknown")
  const lowered = raw.toLowerCase()
  if (lowered.includes("expired") || lowered.includes("unavailable") || lowered.includes("not found")) return copy.expired
  if (lowered.includes("notallowed") || lowered.includes("permission") || lowered.includes("denied")) return copy.micDenied
  if (raw === "microphone_unavailable" || raw === "webrtc_unavailable") return copy.unsupported
  return formatCopy(copy.failed, { error: raw })
}

export function WhatsAppCallControls({ call, headers, locale, onChanged }: WhatsAppCallControlsProps) {
  const copy = COPY[localeKey(locale)]
  const [busy, setBusy] = useState<BusyAction>(null)
  const [error, setError] = useState<string | null>(null)
  const [localStatus, setLocalStatus] = useState<"idle" | "answering" | "active">("idle")
  const [localTerminal, setLocalTerminal] = useState(false)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const rtcRef = useRef<WhatsAppCallAnswerSession | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)

  const isWhatsApp = call.provider === "whatsapp"
  const isInbound = call.direction === "inbound"
  const isTerminal = localTerminal || TERMINAL_STATUSES.has(call.status)
  const isActive = localStatus === "active" || call.status === "in-progress"
  const canAnswer = isWhatsApp && isInbound && !isTerminal && call.status !== "in-progress"
  const canReject = isWhatsApp && isInbound && !isTerminal && !isActive
  const canTerminate = isWhatsApp && ACTIVE_STATUSES.has(call.status) && (isActive || call.status === "in-progress")

  const statusText = useMemo(() => {
    if (busy === "answer" || localStatus === "answering") return copy.answering
    if (isActive) return copy.active
    return copy.incoming
  }, [busy, copy, isActive, localStatus])

  const closeRtc = useCallback(() => {
    rtcRef.current?.close()
    rtcRef.current = null
  }, [])

  const cleanupRtc = useCallback(() => {
    closeRtc()
    setRemoteStream(null)
  }, [closeRtc])

  useEffect(() => {
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream
  }, [remoteStream])

  useEffect(() => closeRtc, [closeRtc])

  useEffect(() => {
    setLocalTerminal(false)
    setError(null)
    setLocalStatus(call.status === "in-progress" ? "active" : "idle")
  }, [call.id, call.status])

  useEffect(() => {
    if (isTerminal) {
      cleanupRtc()
      setLocalStatus("idle")
    }
  }, [cleanupRtc, isTerminal])

  const loadSession = useCallback(async (): Promise<SessionPayload> => {
    const res = await fetch(`/api/v1/calls/whatsapp/${encodeURIComponent(call.id)}/session`, {
      headers,
      cache: "no-store",
    })
    const json = await res.json().catch(() => ({} as { error?: string; data?: SessionPayload }))
    if (!res.ok || !json.data) throw new Error(json.error || `HTTP ${res.status}`)
    if (json.data.sdpType !== "offer") throw new Error("session_not_offer")
    return json.data
  }, [call.id, headers])

  const postAction = useCallback(async (action: WhatsAppCallAction, sdp?: string) => {
    const res = await fetch(`/api/v1/calls/whatsapp/${encodeURIComponent(call.id)}/action`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(sdp ? { action, sdp, sdpType: "answer" } : { action }),
    })
    const json = await res.json().catch(() => ({} as { error?: string }))
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  }, [call.id, headers])

  const refresh = useCallback(async () => {
    await onChanged?.()
  }, [onChanged])

  const answer = useCallback(async () => {
    if (busy || !canAnswer) return
    setBusy("answer")
    setError(null)
    setLocalStatus("answering")
    cleanupRtc()
    try {
      const session = await loadSession()
      const rtc = await createWhatsAppCallAnswer({
        offerSdp: session.sdp,
        onRemoteStream: setRemoteStream,
      })
      rtcRef.current = rtc
      await postAction("pre_accept", rtc.sdp)
      await postAction("accept", rtc.sdp)
      setLocalStatus("active")
      await refresh()
    } catch (err) {
      cleanupRtc()
      setLocalStatus("idle")
      setError(errorMessage(err, copy))
    } finally {
      setBusy(null)
    }
  }, [busy, canAnswer, cleanupRtc, copy, loadSession, postAction, refresh])

  const reject = useCallback(async () => {
    if (busy || !canReject) return
    setBusy("reject")
    setError(null)
    try {
      await postAction("reject")
      cleanupRtc()
      setLocalTerminal(true)
      setLocalStatus("idle")
      await refresh()
    } catch (err) {
      setError(errorMessage(err, copy))
    } finally {
      setBusy(null)
    }
  }, [busy, canReject, cleanupRtc, copy, postAction, refresh])

  const terminate = useCallback(async () => {
    if (busy || !canTerminate) return
    setBusy("terminate")
    setError(null)
    try {
      await postAction("terminate")
      cleanupRtc()
      setLocalTerminal(true)
      setLocalStatus("idle")
      await refresh()
    } catch (err) {
      setError(errorMessage(err, copy))
    } finally {
      setBusy(null)
    }
  }, [busy, canTerminate, cleanupRtc, copy, postAction, refresh])

  if (!isWhatsApp || isTerminal) return null

  return (
    <div className="mt-3 border-t pt-2">
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn(
          "inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
          isActive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
        )} role="status" aria-live="polite">
          <PhoneIncoming className="h-3.5 w-3.5" />
          {statusText}
        </span>
        {canAnswer && (
          <Button
            type="button"
            onClick={answer}
            disabled={!!busy}
            aria-busy={busy === "answer"}
            aria-label={copy.answer}
            className="h-10 min-w-[6.5rem] rounded-lg bg-emerald-600 px-3 text-sm text-white hover:bg-emerald-700 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "answer" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneCall className="h-3.5 w-3.5" />}
            {copy.answer}
          </Button>
        )}
        {canReject && (
          <Button
            type="button"
            onClick={reject}
            disabled={!!busy}
            aria-busy={busy === "reject"}
            aria-label={copy.reject}
            variant="outline"
            className="h-10 min-w-[6.5rem] rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "reject" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            {copy.reject}
          </Button>
        )}
        {canTerminate && (
          <Button
            type="button"
            onClick={terminate}
            disabled={!!busy}
            aria-busy={busy === "terminate"}
            aria-label={copy.end}
            className="h-10 min-w-[6.5rem] rounded-lg bg-red-600 px-3 text-sm text-white hover:bg-red-700 focus-visible:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "terminate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneOff className="h-3.5 w-3.5" />}
            {copy.end}
          </Button>
        )}
      </div>
      {error && <div role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</div>}
    </div>
  )
}
