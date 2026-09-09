"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Phone, PhoneOff, FileText, X, Loader2 } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { formatDateTime } from "@/lib/format-date"
import {
  CALL_DISPOSITIONS,
  CALL_DISPOSITION_I18N_KEYS,
  isCallDisposition,
  type CallDisposition,
} from "@/lib/calls/disposition"

interface CallWidgetProps {
  callLogId: string
  phoneNumber: string
  contactName?: string
  onClose: () => void
}

interface CallStatusRow {
  id: string
  status: string
  duration?: number | null
}

interface CallsListResponse {
  success?: boolean
  data?: CallStatusRow[]
}

interface CallProviderOption {
  id: string
  provider: string
  label: string
  ready: boolean
  missing?: string[]
}

interface CallProvidersResponse {
  success?: boolean
  data?: CallProviderOption[]
  error?: string
}

interface StartCallResponse {
  success?: boolean
  callLogId?: string
  error?: string
  message?: string
  providers?: CallProviderOption[]
}

function toDateTimeLocalValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
}

export function CallWidget({ callLogId, phoneNumber, contactName, onClose }: CallWidgetProps) {
  const t = useTranslations("voip")
  const locale = useLocale()
  const [status, setStatus] = useState("initiated")
  const [duration, setDuration] = useState(0)
  const [showNotes, setShowNotes] = useState(false)
  const [notes, setNotes] = useState("")
  const [disposition, setDisposition] = useState<CallDisposition | "">("")
  const [callbackAt, setCallbackAt] = useState("")
  const [callbackMin, setCallbackMin] = useState("")
  const [dispositionSaving, setDispositionSaving] = useState(false)
  const [dispositionError, setDispositionError] = useState<string | null>(null)
  const [dispositionSaved, setDispositionSaved] = useState<string | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // Poll call status every 2 seconds
    const pollStatus = async () => {
      try {
        const res = await fetch(`/api/v1/calls?limit=1`)
        const data = await res.json() as CallsListResponse
        const calls = data.data ?? []
        if (data.success && calls.length > 0) {
          const call = calls.find((c) => c.id === callLogId)
          if (call) {
            setStatus(call.status)
            if (call.duration) setDuration(call.duration)
            if (["completed", "busy", "no-answer", "failed", "canceled"].includes(call.status)) {
              if (pollRef.current) clearInterval(pollRef.current)
              if (timerRef.current) clearInterval(timerRef.current)
            }
          }
        }
      } catch { /* ignore */ }
    }

    pollRef.current = setInterval(pollStatus, 2000)
    pollStatus()

    // Duration timer
    timerRef.current = setInterval(() => {
      setDuration(d => d + 1)
    }, 1000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [callLogId])

  useEffect(() => {
    setDisposition("")
    setCallbackAt("")
    setDispositionError(null)
    setDispositionSaved(null)
  }, [callLogId])

  const formatDuration = (s: number) => {
    const min = Math.floor(s / 60)
    const sec = s % 60
    return `${min}:${sec.toString().padStart(2, "0")}`
  }

  const handleEndCall = async () => {
    try {
      await fetch(`/api/v1/calls/${callLogId}/end`, { method: "POST" })
    } catch { /* ignore — will be caught by status poll */ }
    setStatus("completed")
    if (timerRef.current) clearInterval(timerRef.current)
    if (pollRef.current) clearInterval(pollRef.current)
  }

  const handleSaveNotes = async () => {
    if (!notes.trim()) return
    try {
      await fetch(`/api/v1/calls/${callLogId}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      })
      setShowNotes(false)
    } catch { /* ignore */ }
  }

  const saveDisposition = async (nextDisposition: CallDisposition, callbackLocalTime?: string) => {
    let callbackAt: string | undefined
    if (nextDisposition === "callback") {
      if (!callbackLocalTime) {
        setDispositionError(t("outcomePicker.callbackTimeRequired"))
        return
      }
      const promisedAt = new Date(callbackLocalTime)
      if (Number.isNaN(promisedAt.getTime())) {
        setDispositionError(t("outcomePicker.callbackTimeRequired"))
        return
      }
      if (promisedAt.getTime() <= Date.now()) {
        setDispositionError(t("outcomePicker.callbackTimePast"))
        return
      }
      callbackAt = promisedAt.toISOString()
    }

    setDispositionSaving(true)
    setDispositionError(null)
    try {
      const response = await fetch(`/api/v1/calls/${callLogId}/disposition`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disposition: nextDisposition, callbackAt }),
      })
      if (!response.ok) throw new Error(String(response.status))
      setDispositionSaved(callbackAt
        ? t("outcomePicker.callbackSaved", { time: formatDateTime(callbackAt, locale) })
        : t("outcomePicker.saved"))
    } catch {
      setDispositionError(t("outcomePicker.failed"))
      // A select does not fire onChange when the same option is chosen again.
      // Reset ordinary outcomes so a failed save always has a retry path; keep
      // the callback form and its exact promise intact.
      if (nextDisposition !== "callback") setDisposition("")
    } finally {
      setDispositionSaving(false)
    }
  }

  const isActive = ["initiated", "ringing", "in-progress"].includes(status)
  const statusColors: Record<string, string> = {
    initiated: "text-yellow-500",
    ringing: "text-blue-500",
    "in-progress": "text-green-500",
    completed: "text-muted-foreground",
    busy: "text-red-500",
    "no-answer": "text-orange-500",
    failed: "text-red-500",
  }

  return (
    <Card className="fixed bottom-4 right-4 w-80 shadow-2xl z-50 border-2 border-primary/20">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Phone className={`h-5 w-5 ${isActive ? "animate-pulse text-green-500" : "text-muted-foreground"}`} />
            <span className="font-semibold text-sm">
              {isActive ? t("activeCall") : t("callEnded")}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("dismiss")}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2">
          {contactName && <div className="font-medium">{contactName}</div>}
          <div className="text-sm text-muted-foreground">{phoneNumber}</div>
          <div className="flex items-center justify-between">
            <span className={`text-sm font-medium capitalize ${statusColors[status] || ""}`}>
              {status === "in-progress" ? t("connected") : status}
            </span>
            {isActive && (
              <span className="text-sm font-mono">{formatDuration(duration)}</span>
            )}
            {!isActive && duration > 0 && (
              <span className="text-sm text-muted-foreground">{formatDuration(duration)}</span>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-3">
          {isActive && (
            <Button variant="destructive" size="sm" className="flex-1" onClick={handleEndCall}>
              <PhoneOff className="h-4 w-4 mr-1" /> {t("endCall")}
            </Button>
          )}
          <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowNotes(!showNotes)}>
            <FileText className="h-4 w-4 mr-1" /> {t("callNote")}
          </Button>
        </div>

        {/* Disposition selector — shown when call ends */}
        {!isActive && status !== "initiated" && (
          <div className="mt-3 space-y-2">
            <label
              htmlFor={`call-widget-disposition-${callLogId}`}
              className="text-xs font-medium text-muted-foreground"
            >
              {t("callOutcome")}
            </label>
            <select
              id={`call-widget-disposition-${callLogId}`}
              className="w-full text-sm border border-zinc-200 dark:border-zinc-700 rounded-md p-1.5 bg-background"
              value={disposition}
              disabled={dispositionSaving}
              onChange={(event) => {
                const nextDisposition = event.target.value
                setDispositionError(null)
                setDispositionSaved(null)
                if (!nextDisposition) {
                  setDisposition("")
                  return
                }
                if (!isCallDisposition(nextDisposition)) return
                setDisposition(nextDisposition)
                if (nextDisposition === "callback") {
                  setCallbackMin(toDateTimeLocalValue(new Date()))
                  setCallbackAt("")
                  return
                }
                setCallbackAt("")
                void saveDisposition(nextDisposition)
              }}
            >
              <option value="">{t("selectOutcome")}</option>
              {CALL_DISPOSITIONS.map((value) => (
                <option key={value} value={value}>{t(CALL_DISPOSITION_I18N_KEYS[value])}</option>
              ))}
            </select>
            {disposition === "callback" ? (
              <div className="grid gap-1.5">
                <label htmlFor={`call-widget-callback-${callLogId}`} className="text-xs font-medium text-muted-foreground">
                  {t("outcomePicker.callbackWhen")}
                </label>
                <Input
                  type="datetime-local"
                  id={`call-widget-callback-${callLogId}`}
                  value={callbackAt}
                  min={callbackMin}
                  required
                  aria-describedby={dispositionError ? `call-widget-disposition-error-${callLogId}` : undefined}
                  aria-invalid={dispositionError ? true : undefined}
                  onChange={(event) => {
                    setCallbackAt(event.target.value)
                    if (dispositionError) setDispositionError(null)
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={dispositionSaving}
                  onClick={() => void saveDisposition("callback", callbackAt)}
                >
                  {dispositionSaving ? t("outcomePicker.saving") : t("outcomePicker.saveCallback")}
                </Button>
              </div>
            ) : null}
            {dispositionError ? (
              <p id={`call-widget-disposition-error-${callLogId}`} role="alert" className="text-xs text-destructive">
                {dispositionError}
              </p>
            ) : null}
            {dispositionSaved ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400" role="status">
                {dispositionSaved}
              </p>
            ) : null}
          </div>
        )}

        {showNotes && (
          <div className="mt-3 space-y-2">
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={t("addCallNotes")}
              className="text-sm"
              rows={3}
            />
            <Button size="sm" onClick={handleSaveNotes} disabled={!notes.trim()}>
              {t("saveNote")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Click-to-call button component
export function ClickToCallButton({ phone, contactId, contactName, leadId, companyId, dealId, ticketId, conversationId, showLabel, label, className, onStarted, onError }: {
  phone: string
  contactId?: string
  contactName?: string
  leadId?: string
  companyId?: string
  dealId?: string
  ticketId?: string
  conversationId?: string
  showLabel?: boolean
  label?: string
  className?: string
  onStarted?: (callLogId: string) => void
  onError?: (error: string) => void
}) {
  const t = useTranslations("voip")
  const [calling, setCalling] = useState(false)
  const [activeCall, setActiveCall] = useState<{ callLogId: string } | null>(null)
  const [providers, setProviders] = useState<CallProviderOption[]>([])
  const [providerPickerOpen, setProviderPickerOpen] = useState(false)
  const [selectedProviderConfigId, setSelectedProviderConfigId] = useState("")
  const idempotencyKeyRef = useRef<string | null>(null)

  const reportError = (message: string) => {
    if (onError) onError(message)
    else alert(message)
  }

  const loadProviders = async () => {
    const res = await fetch("/api/v1/calls/providers")
    const data = await res.json().catch(() => ({} as CallProvidersResponse)) as CallProvidersResponse
    if (!res.ok || data.success === false) {
      throw new Error(data.error || t("failedToLoadCallProviders"))
    }
    const nextProviders = data.data ?? []
    setProviders(nextProviders)
    return nextProviders.filter((provider) => provider.ready)
  }

  const startCall = async (providerConfigId: string | null) => {
    setCalling(true)
    try {
      const idempotencyKey = idempotencyKeyRef.current || crypto.randomUUID()
      idempotencyKeyRef.current = idempotencyKey
      const res = await fetch("/api/v1/calls", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          provider: "voip",
          toNumber: phone,
          contactId,
          leadId,
          companyId,
          dealId,
          ticketId,
          conversationId,
          providerConfigId,
        }),
      })
      const data = await res.json().catch(() => ({} as StartCallResponse)) as StartCallResponse
      if (res.status === 409 && data.providers?.length) {
        // Provider selection is not a dispatch attempt. The final request may
        // safely use a fresh key once the user chooses a provider.
        idempotencyKeyRef.current = null
        setProviders(data.providers)
        setProviderPickerOpen(true)
        setSelectedProviderConfigId("")
        return
      }
      if (data.success) {
        idempotencyKeyRef.current = null
        if (data.callLogId) {
          setActiveCall({ callLogId: data.callLogId })
          onStarted?.(data.callLogId)
        }
      } else {
        // Keep the same key for a transport/unknown-delivery retry. A definite
        // validation or policy response authorizes a fresh explicit attempt.
        if (res.status < 500 && data.error !== "call_outcome_unknown_no_redial") {
          idempotencyKeyRef.current = null
        }
        const message = data.error === "voice_contact_blocked"
          ? t("voiceContactBlocked")
          : data.error === "lead_phone_mismatch"
            ? t("leadPhoneChanged")
            : data.error === "invalid_phone_number"
              ? t("invalidPhoneNumber")
              : data.error === "active_voice_call_exists"
                ? t("activeVoiceCallExists")
                : data.error === "call_outcome_unknown_no_redial"
                  ? t("callOutcomeUnknownNoRedial")
                  : data.error === "idempotency_key_conflict"
                    ? t("callRequestConflict")
                    : data.error === "agent_phone_required"
                      ? t("manualCallError.agent_phone_required")
                      : data.error === "agent_phone_unsupported"
                        ? t("manualCallError.agent_phone_unsupported")
              : data.message || data.error || t("callProviderRequired")
        reportError(message)
      }
    } catch (e) {
      reportError((e as Error).message || t("callProviderRequired"))
    } finally {
      setCalling(false)
    }
  }

  const handleCall = async () => {
    if (calling) return
    try {
      let readyProviders = providers.filter((provider) => provider.ready)
      if (providers.length === 0) readyProviders = await loadProviders()

      if (readyProviders.length === 0) {
        reportError(t("noCallProviders"))
        return
      }

      if (!providerPickerOpen) {
        setProviderPickerOpen(true)
        setSelectedProviderConfigId(readyProviders.length === 1 ? readyProviders[0].id : "")
        return
      }

      if (!selectedProviderConfigId) {
        reportError(t("callProviderRequired"))
        return
      }

      await startCall(selectedProviderConfigId)
    } catch (e) {
      reportError((e as Error).message || t("failedToLoadCallProviders"))
    }
  }

  const readyProviders = providers.filter((provider) => provider.ready)
  const showProviderPicker = providerPickerOpen && readyProviders.length > 0

  return (
    <>
      {showProviderPicker ? (
        <select
          aria-label={t("chooseCallProvider")}
          value={selectedProviderConfigId}
          onChange={(event) => setSelectedProviderConfigId(event.target.value)}
          className="h-8 max-w-[11rem] rounded-md border border-border bg-background px-2 text-xs text-foreground shadow-sm"
        >
          <option value="">{t("callProviderPlaceholder")}</option>
          {readyProviders.map((provider) => (
            <option key={provider.id} value={provider.id}>{provider.label}</option>
          ))}
        </select>
      ) : null}
      <Button
        variant="ghost"
        size={showLabel ? "sm" : "icon"}
        onClick={handleCall}
        disabled={calling || (showProviderPicker && !selectedProviderConfigId)}
        title={`Call ${phone}`}
        className={className || (showLabel ? "h-8 gap-1.5" : "h-8 w-8")}
      >
        {calling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4 text-green-600" />}
        {showLabel ? <span>{label || "Call"}</span> : null}
      </Button>
      {activeCall && (
        <CallWidget
          callLogId={activeCall.callLogId}
          phoneNumber={phone}
          contactName={contactName}
          onClose={() => setActiveCall(null)}
        />
      )}
    </>
  )
}
