"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, Phone, PhoneCall, PhoneOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  createWhatsAppCallOffer,
  type WhatsAppCallOfferSession,
} from "@/lib/whatsapp-call-rtc"
import {
  canRequestWhatsAppCallPermission,
  canStartWhatsAppCall,
  normalizeWhatsAppPermissionPayload,
  whatsAppCallBlockedReason,
  type PermissionPayload,
} from "./whatsapp-outbound-call-control-utils"

type LocaleKey = "en" | "ru" | "az"

interface WhatsAppOutboundCallControlProps {
  conversationId: string
  headers: Record<string, string>
  locale: string
  className?: string
  onChanged?: () => void | Promise<void>
  onStatus?: (message: string, tone: "success" | "error" | "info") => void
}

interface OutboundStartPayload {
  call?: {
    id: string
    status: string
  }
}

interface SessionPayload {
  sdp: string
  sdpType: "offer" | "answer"
  expiresAt: string
}

type BusyState = "checking" | "requesting" | "calling" | "ending" | null

const COPY = {
  en: {
    checking: "Checking WhatsApp call permission",
    request: "Request WhatsApp call permission",
    call: "Call on WhatsApp",
    waiting: "Waiting for WhatsApp media answer...",
    active: "WhatsApp call active.",
    requested: "WhatsApp call permission request sent.",
    denied: "WhatsApp call permission is not available yet.",
    end: "End WhatsApp call",
    failed: "WhatsApp call failed: {error}",
  },
  ru: {
    checking: "Проверяем разрешение WhatsApp-звонка",
    request: "Запросить разрешение на WhatsApp-звонок",
    call: "Позвонить в WhatsApp",
    waiting: "Ждём media answer от WhatsApp...",
    active: "WhatsApp-звонок активен.",
    requested: "Запрос разрешения на WhatsApp-звонок отправлен.",
    denied: "Разрешение на WhatsApp-звонок пока недоступно.",
    end: "Завершить WhatsApp-звонок",
    failed: "WhatsApp-звонок не сработал: {error}",
  },
  az: {
    checking: "WhatsApp zəng icazəsi yoxlanılır",
    request: "WhatsApp zəngi üçün icazə istə",
    call: "WhatsApp-da zəng et",
    waiting: "WhatsApp media cavabı gözlənilir...",
    active: "WhatsApp zəngi aktivdir.",
    requested: "WhatsApp zəng icazəsi sorğusu göndərildi.",
    denied: "WhatsApp zəng icazəsi hələ aktiv deyil.",
    end: "WhatsApp zəngini bitir",
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readJson<T>(res: Response): Promise<{ error?: string; data?: T }> {
  return res.json().catch(() => ({} as { error?: string; data?: T }))
}

export function WhatsAppOutboundCallControl({
  conversationId,
  headers,
  locale,
  className,
  onChanged,
  onStatus,
}: WhatsAppOutboundCallControlProps) {
  const copy = COPY[localeKey(locale)]
  const [busy, setBusy] = useState<BusyState>("checking")
  const [permission, setPermission] = useState<PermissionPayload["permission"]>(null)
  const [providerError, setProviderError] = useState<string | null>(null)
  const [activeCallId, setActiveCallId] = useState<string | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const rtcRef = useRef<WhatsAppCallOfferSession | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)

  const canStart = canStartWhatsAppCall(permission)
  const canRequest = canRequestWhatsAppCallPermission(permission)
  const isBusy = busy !== null
  const blockedReason = whatsAppCallBlockedReason(permission, providerError, copy.denied)

  const title = useMemo(() => {
    if (busy === "checking") return copy.checking
    if (activeCallId) return copy.end
    if (canStart) return copy.call
    if (canRequest) return copy.request
    return blockedReason || copy.denied
  }, [activeCallId, blockedReason, busy, canRequest, canStart, copy])

  const closeRtc = useCallback(() => {
    rtcRef.current?.close()
    rtcRef.current = null
    setRemoteStream(null)
  }, [])

  useEffect(() => {
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream
  }, [remoteStream])

  useEffect(() => closeRtc, [closeRtc])

  const applyPermissionPayload = useCallback((payload: PermissionPayload | null | undefined) => {
    const normalized = normalizeWhatsAppPermissionPayload(payload)
    if (normalized.hasPermissionPayload) setPermission(normalized.permission)
    if (normalized.providerError || normalized.hasPermissionPayload || normalized.hasProviderPayload) {
      setProviderError(normalized.providerError)
    }
    return normalized
  }, [])

  const refreshPermission = useCallback(async () => {
    setBusy((current) => current ?? "checking")
    try {
      const res = await fetch(`/api/v1/calls/whatsapp/permissions?conversationId=${encodeURIComponent(conversationId)}`, {
        headers,
        cache: "no-store",
      })
      const json = await readJson<PermissionPayload>(res)
      const normalized = applyPermissionPayload(json.data)
      if (!res.ok) onStatus?.(json.error || normalized.providerError || copy.denied, "error")
    } finally {
      setBusy((current) => current === "checking" ? null : current)
    }
  }, [applyPermissionPayload, conversationId, copy.denied, headers, onStatus])

  useEffect(() => {
    void refreshPermission()
  }, [refreshPermission])

  const requestPermission = useCallback(async () => {
    if (isBusy || !canRequest) return
    setBusy("requesting")
    try {
      const res = await fetch("/api/v1/calls/whatsapp/permissions", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      })
      const json = await readJson<PermissionPayload>(res)
      const normalized = applyPermissionPayload(json.data)
      if (!res.ok) throw new Error(json.error || normalized.providerError || `HTTP ${res.status}`)
      onStatus?.(json.data?.permission?.canStartCall ? copy.active : copy.requested, "success")
      await onChanged?.()
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err || "unknown")
      onStatus?.(formatCopy(copy.failed, { error: raw }), "error")
    } finally {
      setBusy(null)
    }
  }, [applyPermissionPayload, canRequest, conversationId, copy.active, copy.failed, copy.requested, headers, isBusy, onChanged, onStatus])

  const waitForAnswer = useCallback(async (callId: string): Promise<SessionPayload> => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < 30_000) {
      const res = await fetch(`/api/v1/calls/whatsapp/${encodeURIComponent(callId)}/session`, {
        headers,
        cache: "no-store",
      })
      const json = await readJson<SessionPayload>(res)
      if (res.ok && json.data?.sdpType === "answer" && json.data.sdp) return json.data
      await wait(1500)
    }
    throw new Error("whatsapp_answer_timeout")
  }, [headers])

  const startCall = useCallback(async () => {
    if (isBusy || !canStart) return
    setBusy("calling")
    closeRtc()
    try {
      const rtc = await createWhatsAppCallOffer({ onRemoteStream: setRemoteStream })
      rtcRef.current = rtc
      const res = await fetch("/api/v1/calls/whatsapp/outbound", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, sdp: rtc.sdp, sdpType: "offer" }),
      })
      const json = await readJson<OutboundStartPayload>(res)
      if (!res.ok || !json.data?.call?.id) throw new Error(json.error || `HTTP ${res.status}`)
      setActiveCallId(json.data.call.id)
      onStatus?.(copy.waiting, "info")
      await onChanged?.()
      const answer = await waitForAnswer(json.data.call.id)
      await rtc.applyAnswer(answer.sdp)
      onStatus?.(copy.active, "success")
      await onChanged?.()
    } catch (err) {
      closeRtc()
      setActiveCallId(null)
      const raw = err instanceof Error ? err.message : String(err || "unknown")
      onStatus?.(formatCopy(copy.failed, { error: raw }), "error")
      await refreshPermission()
    } finally {
      setBusy(null)
    }
  }, [canStart, closeRtc, conversationId, copy.active, copy.failed, copy.waiting, headers, isBusy, onChanged, onStatus, refreshPermission, waitForAnswer])

  const endCall = useCallback(async () => {
    if (isBusy || !activeCallId) return
    setBusy("ending")
    try {
      await fetch(`/api/v1/calls/whatsapp/${encodeURIComponent(activeCallId)}/action`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "terminate" }),
      })
      closeRtc()
      setActiveCallId(null)
      await onChanged?.()
    } finally {
      setBusy(null)
    }
  }, [activeCallId, closeRtc, headers, isBusy, onChanged])

  return (
    <>
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
      <Button
        type="button"
        variant={activeCallId ? "destructive" : "ghost"}
        size="icon"
        title={title}
        aria-label={title}
        aria-busy={isBusy}
        disabled={isBusy || (!activeCallId && !canStart && !canRequest)}
        onClick={activeCallId ? endCall : canStart ? startCall : requestPermission}
        className={cn(
          "h-7 w-7 rounded-md p-1.5",
          activeCallId
            ? "text-white"
            : canStart
              ? "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
              : canRequest
                ? "text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                : "text-muted-foreground opacity-60",
          className,
        )}
      >
        {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : activeCallId ? <PhoneOff className="h-4 w-4" /> : canStart ? <PhoneCall className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
      </Button>
    </>
  )
}
