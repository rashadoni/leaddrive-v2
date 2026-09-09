"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Headphones, Loader2, MessageSquare, PhoneIncoming, PhoneOff, X, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLocale, useTranslations } from "next-intl"
import Link from "next/link"
import { toast } from "sonner"
import { WhatsAppCallControls } from "@/components/inbox/whatsapp-call-controls"
import type { InboxCallLog } from "@/lib/inbox-channels"
import {
  connectBrowserCall,
  prepareBrowserAudio,
  type BrowserCallHandle,
} from "@/lib/voip/browser-call-audio"
import {
  diagnoseMicrophoneFailure,
  microphoneMessageKey,
  microphonePrecheck,
  readMicrophoneEnvironment,
} from "@/lib/ai/voice/microphone-diagnosis"

const INBOUND_CLAIM_RENEW_INTERVAL_MS = 10_000

type BrowserAnswerPhase = "idle" | "preparing" | "connecting" | "live"

type BrowserAnswerClaim = {
  token: string
  mediaStarted: boolean
}

interface IncomingCallData {
  id: string
  callSid?: string | null
  direction: string
  fromNumber: string
  toNumber: string
  contactId: string | null
  contact: { fullName: string } | null
  leadId: string | null
  lead: { contactName: string; companyName: string | null } | null
  status: string
  provider?: string | null
  conversationId?: string | null
  claimedByUserId?: string | null
  claimedAt?: string | null
  browserAnswerClaimExpiresAt?: string | null
  queueId?: string | null
  createdAt?: string
}

interface IncomingCallPopupProps {
  call: IncomingCallData
  browserCallsEnabled?: boolean
  onDismiss: () => void
  onChanged?: () => void | Promise<void>
}

export function IncomingCallPopup({
  call,
  browserCallsEnabled = false,
  onDismiss,
  onChanged,
}: IncomingCallPopupProps) {
  const t = useTranslations("voip")
  const voiceT = useTranslations("voice")
  const locale = useLocale()
  const [answerPhase, setAnswerPhase] = useState<BrowserAnswerPhase>("idle")
  const browserCallRef = useRef<BrowserCallHandle | null>(null)
  const browserClaimRef = useRef<BrowserAnswerClaim | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)
  const isWhatsApp = call.provider === "whatsapp"
  const isAsteriskInbound = call.provider === "asterisk" && call.direction === "inbound"
  const isOutbound = call.direction === "outbound"
  const title = isWhatsApp
    ? isOutbound ? t("whatsappOutboundCall") : t("whatsappIncomingCall")
    : t("incomingCall")
  const displayNumber = isOutbound ? call.toNumber : call.fromNumber
  const inboxHref = call.conversationId
    ? `/inbox?conversation=${encodeURIComponent(call.conversationId)}&tab=calls`
    : "/inbox"
  const whatsappCall: InboxCallLog = {
    id: call.id,
    direction: call.direction,
    fromNumber: call.fromNumber,
    toNumber: call.toNumber,
    status: call.status,
    provider: call.provider ?? null,
    conversationId: call.conversationId ?? null,
    claimedByUserId: call.claimedByUserId ?? null,
    claimedAt: call.claimedAt ?? null,
    queueId: call.queueId ?? null,
    createdAt: call.createdAt ?? new Date().toISOString(),
  }

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current !== null) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
  }, [])

  const releaseBrowserClaim = useCallback((claim: BrowserAnswerClaim) => {
    if (browserClaimRef.current?.token === claim.token) browserClaimRef.current = null
    stopHeartbeat()
    void fetch(`/api/v1/calls/${call.id}/browser-answer`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimToken: claim.token }),
    }).catch(() => {})
  }, [call.id, stopHeartbeat])

  const finishBrowserCall = useCallback((claim: BrowserAnswerClaim) => {
    browserCallRef.current = null
    stopHeartbeat()
    if (browserClaimRef.current?.token === claim.token) {
      if (claim.mediaStarted) browserClaimRef.current = null
      else releaseBrowserClaim(claim)
    }
    if (mountedRef.current) setAnswerPhase("idle")
    void onChanged?.()
  }, [onChanged, releaseBrowserClaim, stopHeartbeat])

  const renewBrowserClaim = useCallback(async (claim: BrowserAnswerClaim) => {
    try {
      const response = await fetch(`/api/v1/calls/${call.id}/browser-answer`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimToken: claim.token }),
      })
      if (response.status === 409 && browserClaimRef.current?.token === claim.token) {
        browserClaimRef.current = null
        stopHeartbeat()
        toast.error(t("inboundCallClaimLost"))
        browserCallRef.current?.hangUp()
        browserCallRef.current = null
        if (mountedRef.current) setAnswerPhase("idle")
        void onChanged?.()
      }
    } catch {
      // A transient poll failure is not proof that the claim was lost. The
      // next heartbeat retries; expiry then turns a stale browser into 409.
    }
  }, [call.id, onChanged, stopHeartbeat, t])

  const startHeartbeat = useCallback((claim: BrowserAnswerClaim) => {
    stopHeartbeat()
    heartbeatRef.current = setInterval(() => {
      void renewBrowserClaim(claim)
    }, INBOUND_CLAIM_RENEW_INTERVAL_MS)
  }, [renewBrowserClaim, stopHeartbeat])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const claim = browserClaimRef.current
      browserCallRef.current?.hangUp()
      browserCallRef.current = null
      stopHeartbeat()
      if (claim && !claim.mediaStarted) releaseBrowserClaim(claim)
      else browserClaimRef.current = null
    }
  }, [call.id, releaseBrowserClaim, stopHeartbeat])

  const startBrowserAnswer = useCallback(async () => {
    if (
      answerPhase !== "idle"
      || !browserCallsEnabled
      || !isAsteriskInbound
      || call.status !== "ringing"
    ) return

    setAnswerPhase("preparing")
    const microphoneEnvironment = await readMicrophoneEnvironment()
    const microphoneProblem = microphonePrecheck(microphoneEnvironment)
    if (microphoneProblem) {
      if (mountedRef.current) setAnswerPhase("idle")
      toast.error(voiceT(microphoneMessageKey(microphoneProblem)))
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (error) {
      if (mountedRef.current) setAnswerPhase("idle")
      toast.error(voiceT(microphoneMessageKey(
        diagnoseMicrophoneFailure(error, microphoneEnvironment),
      )))
      return
    }

    let prepared: Awaited<ReturnType<typeof prepareBrowserAudio>>
    try {
      // Capability failures happen before the atomic claim. A browser that
      // cannot build audio must never remove this call from the team queue.
      prepared = await prepareBrowserAudio({
        stream,
        captureWorkletUrl: "/gemini-live-capture.worklet.js",
        playbackWorkletUrl: "/gemini-live-playback.worklet.js",
      })
    } catch {
      stream.getTracks().forEach((track) => track.stop())
      if (mountedRef.current) setAnswerPhase("idle")
      toast.error(t("inboundCallAudioUnsupported"))
      return
    }

    if (!mountedRef.current) {
      prepared.dispose()
      return
    }

    let claim: BrowserAnswerClaim | null = null
    try {
      const response = await fetch(`/api/v1/calls/${call.id}/browser-answer`, { method: "POST" })
      const body = await response.json().catch(() => ({}))
      const relayUrl = typeof body?.relayUrl === "string" ? body.relayUrl : null
      const ticket = typeof body?.parkTicket === "string" ? body.parkTicket : null
      const claimToken = typeof body?.claimToken === "string" ? body.claimToken : null
      if (!response.ok || !relayUrl || !ticket || !claimToken) {
        prepared.dispose()
        if (mountedRef.current) setAnswerPhase("idle")
        toast.error(
          response.status === 409 || body?.error === "inbound_call_claimed"
            ? t("inboundCallClaimed")
            : t("inboundCallFailed"),
        )
        void onChanged?.()
        return
      }

      claim = { token: claimToken, mediaStarted: false }
      browserClaimRef.current = claim
      if (!mountedRef.current) {
        prepared.dispose()
        releaseBrowserClaim(claim)
        return
      }

      setAnswerPhase("connecting")
      startHeartbeat(claim)
      const activeClaim = claim
      browserCallRef.current = connectBrowserCall(prepared, {
        relayUrl,
        ticket,
        // A verified WebSocket is merely parked. Keep saying "connecting"
        // until the PBX half actually joins and delivers media.
        onConnected: () => {
          if (mountedRef.current) setAnswerPhase("connecting")
        },
        onMediaStarted: () => {
          if (browserClaimRef.current?.token !== activeClaim.token) return
          activeClaim.mediaStarted = true
          if (mountedRef.current) setAnswerPhase("live")
          void onChanged?.()
        },
        onEnded: () => finishBrowserCall(activeClaim),
      })
      void onChanged?.()
    } catch {
      prepared.dispose()
      if (claim) releaseBrowserClaim(claim)
      if (mountedRef.current) setAnswerPhase("idle")
      toast.error(t("inboundCallFailed"))
      void onChanged?.()
    }
  }, [
    answerPhase,
    browserCallsEnabled,
    call.id,
    call.status,
    finishBrowserCall,
    isAsteriskInbound,
    onChanged,
    releaseBrowserClaim,
    startHeartbeat,
    t,
    voiceT,
  ])

  const dismiss = useCallback(() => {
    browserCallRef.current?.hangUp()
    onDismiss()
  }, [onDismiss])

  const canAnswerInBrowser = browserCallsEnabled
    && isAsteriskInbound
    && call.status === "ringing"
  const statusLabel = answerPhase === "preparing"
    ? t("inboundCallPreparing")
    : answerPhase === "connecting"
      ? t("inboundCallConnecting")
      : answerPhase === "live"
        ? t("inboundCallLive")
        : call.status === "ringing"
          ? t("ringing")
          : t("connected")

  return (
    <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-top-2 fade-in duration-300">
      <div className="w-80 rounded-xl border-2 border-violet-500/50 bg-card p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
              <PhoneIncoming className="h-4 w-4 text-violet-600 animate-pulse" />
            </div>
            <div>
              <p className="text-xs font-medium text-violet-600">{title}</p>
              <p className="text-xs text-muted-foreground">{statusLabel}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={dismiss}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 mb-3">
          <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
            <User className="h-5 w-5 text-slate-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">
              {call.contact?.fullName || call.lead?.contactName || t("unknownCaller")}
            </p>
            <p className="text-xs text-muted-foreground font-mono">{displayNumber}</p>
          </div>
        </div>

        {(canAnswerInBrowser || answerPhase !== "idle") && (
          <div className="mb-3">
            {answerPhase === "idle" ? (
              <Button
                type="button"
                size="sm"
                className="w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => void startBrowserAnswer()}
              >
                <Headphones className="h-4 w-4" />
                {t("inboundCallAnswer")}
              </Button>
            ) : answerPhase === "preparing" ? (
              <Button type="button" size="sm" className="w-full gap-2" disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("inboundCallPreparing")}
              </Button>
            ) : (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="w-full gap-2"
                onClick={() => browserCallRef.current?.hangUp()}
              >
                <PhoneOff className="h-4 w-4" />
                {answerPhase === "live" ? t("inboundCallHangUp") : t("inboundCallConnecting")}
              </Button>
            )}
          </div>
        )}

        <div className="flex gap-2">
          {isWhatsApp ? (
            <Link href={inboxHref} className="flex-1">
              <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs">
                <MessageSquare className="h-3 w-3" /> {t("openConversation")}
              </Button>
            </Link>
          ) : call.contactId ? (
            <Link href={`/contacts/${call.contactId}`} className="flex-1">
              <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs">
                <User className="h-3 w-3" /> {t("viewContact")}
              </Button>
            </Link>
          ) : call.leadId && call.lead ? (
            <Link href={`/leads/${call.leadId}`} className="flex-1">
              <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs">
                <User className="h-3 w-3" /> {t("viewLead")}
              </Button>
            </Link>
          ) : (
            <Button variant="outline" size="sm" className="flex-1 text-xs" disabled>
              {t("noMatchingCaller")}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-xs" onClick={dismiss}>
            {t("dismiss")}
          </Button>
        </div>

        {isWhatsApp && (
          <WhatsAppCallControls
            call={whatsappCall}
            headers={{}}
            locale={locale}
            onChanged={onChanged}
          />
        )}
      </div>
    </div>
  )
}
