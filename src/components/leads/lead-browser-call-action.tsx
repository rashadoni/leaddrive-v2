"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Headphones, PhoneOff } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  connectBrowserCall,
  prepareBrowserAudio,
  type BrowserCallHandle,
} from "@/lib/voip/browser-call-audio"
import { formatDateTime } from "@/lib/format-date"
import { BROWSER_LEAD_CALL_CLAIM_RENEW_INTERVAL_MS } from "@/lib/voip/browser-lead-claim"
import {
  QUICK_CALL_DISPOSITIONS,
  type CallDisposition,
} from "@/lib/calls/disposition"
import {
  diagnoseMicrophoneFailure,
  microphoneMessageKey,
  microphonePrecheck,
  readMicrophoneEnvironment,
} from "@/lib/ai/voice/microphone-diagnosis"

type BrowserLeadClaim = {
  callLogId: string
  token: string
}

// The list renders up to 500 rows. Keep availability shared per browser tab so
// adding the action does not turn one page load into 500 identical requests.
let browserCallAvailabilityPromise: Promise<boolean> | null = null

function getBrowserCallAvailability(): Promise<boolean> {
  if (!browserCallAvailabilityPromise) {
    browserCallAvailabilityPromise = fetch("/api/v1/voip/capabilities", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : { browserCalls: false }))
      .then((data) => data?.browserCalls === true)
      .catch(() => false)
  }
  return browserCallAvailabilityPromise
}

function toDateTimeLocalValue(date: Date): string {
  // `datetime-local` intentionally has no zone. Offset the instant before
  // slicing ISO so the control shows the seller's wall-clock time rather than
  // UTC; `new Date(value).toISOString()` reverses this when saving.
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
}

/**
 * Call a lead and talk from this browser — no second phone rings anywhere.
 *
 * The order matters and is the whole reason this exists. The customer is dialled
 * first, as always; the difference is that the salesperson is already on the
 * line when they answer, instead of being rung afterwards on a phone that may
 * not be picked up. That second leg is what let customers answer into silence.
 *
 * The button hides itself where the feature is not enabled rather than failing
 * on click, and it refuses rather than falling back to the phone path when the
 * microphone is unavailable: a salesperson staring at a silent browser while a
 * phone rings somewhere else is the same defect wearing a different hat.
 */
export function LeadBrowserCallAction({ leadId, phone }: { leadId: string; phone?: string | null }) {
  const t = useTranslations("voip")
  const voiceT = useTranslations("voice")
  const locale = useLocale()
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [onCall, setOnCall] = useState(false)
  const [connected, setConnected] = useState(false)
  // The call that has just ended and has no outcome on it yet. Held here
  // rather than in a global store because it belongs to this card: the
  // salesperson is looking at the person they just spoke to.
  const [labelling, setLabelling] = useState<string | null>(null)
  const [saving, setSaving] = useState<CallDisposition | null>(null)
  // null = outcome choices; an empty string = the callback time form is open
  // but no promise has been entered yet. Keeping these distinct means a failed
  // save leaves the exact value on screen for a safe retry.
  const [callbackAt, setCallbackAt] = useState<string | null>(null)
  const [callbackMin, setCallbackMin] = useState("")
  const [callbackError, setCallbackError] = useState<string | null>(null)
  const callRef = useRef<BrowserCallHandle | null>(null)
  const leadClaimRef = useRef<BrowserLeadClaim | null>(null)
  const leadClaimHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)
  // Read inside a callback that outlives the render it was made in, so it has
  // to be a ref rather than the state value closed over at creation time.
  const connectedRef = useRef(false)
  connectedRef.current = connected

  const stopLeadClaimHeartbeat = useCallback(() => {
    if (leadClaimHeartbeatRef.current !== null) {
      clearInterval(leadClaimHeartbeatRef.current)
      leadClaimHeartbeatRef.current = null
    }
  }, [])

  const stopLeadClaim = useCallback((claim: BrowserLeadClaim | null = leadClaimRef.current) => {
    if (!claim) return
    if (leadClaimRef.current?.token === claim.token) {
      leadClaimRef.current = null
      stopLeadClaimHeartbeat()
    }
  }, [stopLeadClaimHeartbeat])

  const renewLeadClaim = useCallback(async (claim: BrowserLeadClaim) => {
    try {
      const response = await fetch(`/api/v1/calls/${claim.callLogId}/lead-claim`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: claim.token }),
      })
      if (response.status === 409 && leadClaimRef.current?.token === claim.token) {
        toast.error(t("manualCallError.lead_call_claim_lost"))
        stopLeadClaim(claim)
        callRef.current?.hangUp()
      }
    } catch {
      // A transient network loss should not end a live call. The next interval
      // retries; if the lease actually expires, the server returns 409.
    }
  }, [stopLeadClaim, t])

  const startLeadClaimHeartbeat = useCallback((claim: BrowserLeadClaim) => {
    stopLeadClaimHeartbeat()
    leadClaimRef.current = claim
    leadClaimHeartbeatRef.current = setInterval(() => {
      void renewLeadClaim(claim)
    }, BROWSER_LEAD_CALL_CLAIM_RENEW_INTERVAL_MS)
  }, [renewLeadClaim, stopLeadClaimHeartbeat])

  useEffect(() => {
    let cancelled = false
    void getBrowserCallAvailability()
      .then((isAvailable) => {
        if (!cancelled) setAvailable(isAvailable)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // A call belongs to the lead it was placed for, and only to that lead.
  //
  // Moving to another lead's card does NOT remount this component: it sits in
  // the same place in the tree, so React keeps it and changes `leadId`. The
  // cleanup below is keyed to unmount, which therefore never runs, and the
  // previous lead's call state arrives on the next card — the button reads
  // "end call", pressing it hangs up instead of dialling, and no call is
  // placed at all. Reported from production on 2026-08-25: a second lead
  // "was still talking" while neither the relay nor the call log had ever
  // heard of a second call.
  //
  // Declared BEFORE the unmount effect on purpose. Cleanups run in declaration
  // order, so on a real unmount this one runs while the component is still
  // mounted and its state updates are still meaningful.
  useEffect(() => () => {
    callRef.current?.hangUp()
    stopLeadClaim()
    callRef.current = null
    setOnCall(false)
    setConnected(false)
    setBusy(false)
    setLabelling(null)
    setCallbackAt(null)
    setCallbackError(null)
  }, [leadId, stopLeadClaim])

  // A tab that closes mid-call must not leave the microphone or heartbeat
  // running. The server lease expires if the PBX cannot later confirm terminal
  // state, so a dead browser never locks the lead forever.
  useEffect(() => () => {
    mountedRef.current = false
    callRef.current?.hangUp()
    stopLeadClaim()
  }, [stopLeadClaim])

  const hangUp = useCallback(() => {
    callRef.current?.hangUp()
    callRef.current = null
    setOnCall(false)
    // Cleared here too: `connectedRef` decides whether a later failure has to
    // cancel the call, and a value left over from the previous one answers for
    // the wrong call.
    setConnected(false)
  }, [])

  const saveOutcome = useCallback(async (callLogId: string, outcome: CallDisposition, callbackAt?: string) => {
    setSaving(outcome)
    try {
      const res = await fetch(`/api/v1/calls/${callLogId}/disposition`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disposition: outcome, callbackAt }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setLabelling(null)
      setCallbackAt(null)
      setCallbackError(null)
      toast.success(callbackAt
        ? t("outcomePicker.callbackSaved", { time: formatDateTime(callbackAt, locale) })
        : t("outcomePicker.saved"))
    } catch {
      // Said out loud rather than swallowed. The neighbouring notes panel
      // closes on failure exactly as it does on success, so a lost note looks
      // like a saved one — that is the mistake this refuses to repeat.
      toast.error(t("outcomePicker.failed"))
    } finally {
      setSaving(null)
    }
  }, [locale, t])

  const saveCallback = useCallback((callLogId: string) => {
    if (!callbackAt) {
      setCallbackError(t("outcomePicker.callbackTimeRequired"))
      return
    }
    const promisedAt = new Date(callbackAt)
    if (Number.isNaN(promisedAt.getTime())) {
      setCallbackError(t("outcomePicker.callbackTimeRequired"))
      return
    }
    if (promisedAt.getTime() <= Date.now()) {
      setCallbackError(t("outcomePicker.callbackTimePast"))
      return
    }
    setCallbackError(null)
    void saveOutcome(callLogId, "callback", promisedAt.toISOString())
  }, [callbackAt, saveOutcome, t])

  const start = useCallback(async () => {
    if (busy || onCall) return
    setBusy(true)

    // A call that was started must be cancellable from every path that can
    // fail, including the ones that fail after this function has returned.
    const cancel = (callLogId: string | null) => {
      if (!callLogId) return
      void fetch(`/api/v1/calls/${callLogId}/end`, { method: "POST" }).catch(() => {})
    }

    let stream: MediaStream | null = null
    let prepared: Awaited<ReturnType<typeof prepareBrowserAudio>> | null = null
    const microphoneEnvironment = await readMicrophoneEnvironment()
    const microphoneProblem = microphonePrecheck(microphoneEnvironment)
    if (microphoneProblem) {
      setBusy(false)
      toast.error(voiceT(microphoneMessageKey(microphoneProblem)))
      return
    }

    try {
      // Ask for the microphone BEFORE dialling. A permission prompt answered
      // while the customer is already saying hello is a lost call.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (error) {
      setBusy(false)
      toast.error(voiceT(microphoneMessageKey(
        diagnoseMicrophoneFailure(error, microphoneEnvironment),
      )))
      return
    }

    try {
      // Build the whole audio path before dialling too. Everything that can
      // fail for capability reasons — an 8 kHz context this browser will not
      // open, a worklet that will not load — fails here, with nobody's phone
      // ringing. Building it afterwards is how a customer answers into silence.
      prepared = await prepareBrowserAudio({
        stream,
        captureWorkletUrl: "/gemini-live-capture.worklet.js",
        playbackWorkletUrl: "/gemini-live-playback.worklet.js",
      })
    } catch {
      stream.getTracks().forEach((track) => track.stop())
      setBusy(false)
      toast.error(t("browserCallAudioUnsupported"))
      return
    }

    // The tab can be closed between here and the call being answered. Without
    // this the teardown on unmount finds no handle yet and lets a dialled call
    // run on with nobody attached.
    if (!mountedRef.current) {
      prepared.dispose()
      setBusy(false)
      return
    }

    let callLogId: string | null = null
    let leadClaim: BrowserLeadClaim | null = null
    try {
      const res = await fetch("/api/v1/calls", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ provider: "voip", toNumber: phone, leadId, browserAudio: true }),
      })
      const json = await res.json().catch(() => ({}))
      // Read the id BEFORE anything that can throw: it is the only handle on a
      // call that may already be ringing.
      callLogId = typeof json?.callLogId === "string" ? json.callLogId : null
      const leadCallClaimToken = typeof json?.leadCallClaimToken === "string"
        ? json.leadCallClaimToken
        : null

      if (!res.ok || !callLogId || !leadCallClaimToken || !json?.parkTicket || !json?.relayUrl) {
        const key = typeof json?.error === "string" ? json.error : ""
        const known = [
          "voice_contact_blocked",
          "active_voice_call_exists",
          "invalid_phone_number",
          "browser_calls_unavailable",
          "lead_call_claimed",
        ]
        toast.error(known.includes(key) ? t(`manualCallError.${key}`) : t("manualCallFailed"))
        prepared.dispose()
        // A 503 means the station may have taken the request anyway.
        if (!res.ok) cancel(callLogId)
        return
      }

      leadClaim = { callLogId, token: leadCallClaimToken }

      if (!mountedRef.current) {
        prepared.dispose()
        stopLeadClaim(leadClaim)
        cancel(callLogId)
        return
      }

      const startedFor = callLogId
      startLeadClaimHeartbeat(leadClaim)
      callRef.current = connectBrowserCall(prepared, {
        relayUrl: json.relayUrl,
        ticket: json.parkTicket,
        onConnected: () => setConnected(true),
        onEnded: (reason) => {
          const everConnected = connectedRef.current
          callRef.current = null
          setOnCall(false)
          setConnected(false)
          // A closed browser socket does not prove the PBX leg is terminal.
          // Stop renewing; the server clears the CAS lease with the terminal
          // lifecycle event, and its TTL protects against a dead browser.
          stopLeadClaim(leadClaim)
          // Ending before the two halves ever met means the audio path failed
          // while the customer's phone was ringing. Nothing else will hang that
          // call up — the relay is forbidden to, and the station waits two
          // minutes — so it has to be done here.
          if (!everConnected) {
            cancel(startedFor)
            toast.error(t("browserCallAudioFailed"))
          }
          // Ask what happened, now, while the salesperson still remembers and
          // is still looking at this person. A call labelled later is labelled
          // from memory across sixty other calls, and mostly is not labelled at
          // all: every browser call so far has gone into the log unlabelled,
          // because the only outcome selector in the product lives in a widget
          // this path never mounts.
          //
          // Offered even when the halves never met — "no answer" and "wrong
          // number" are outcomes too, and they are the ones a manager most
          // needs counted.
          if (startedFor) {
            setCallbackAt(null)
            setCallbackError(null)
            setLabelling(startedFor)
          }
          void reason
        },
      })
      setOnCall(true)
      // "Dialling", not "ringing": the station reports only answered and ended,
      // so a ringing indicator would be a guess dressed as a fact.
      toast.success(t("browserCallDialling"))
    } catch {
      prepared.dispose()
      stopLeadClaim(leadClaim)
      cancel(callLogId)
      toast.error(t("browserCallAudioFailed"))
    } finally {
      setBusy(false)
    }
  }, [busy, leadId, onCall, phone, startLeadClaimHeartbeat, stopLeadClaim, t, voiceT])

  if (!available || !phone) return null

  // The outcome panel replaces the call button rather than sitting beside it.
  // The next call cannot start until this one is labelled or skipped, which is
  // the only thing that reliably gets calls labelled at volume — and skipping
  // is one click, so it never becomes a wall.
  if (labelling && !onCall) {
    const callbackInputId = `callback-at-${labelling}`
    const callbackErrorId = `callback-at-error-${labelling}`

    if (callbackAt !== null) {
      return (
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <label htmlFor={callbackInputId} className="text-xs font-medium text-muted-foreground">
              {t("outcomePicker.callbackWhen")}
            </label>
            <Input
              type="datetime-local"
              id={callbackInputId}
              value={callbackAt}
              min={callbackMin}
              required
              aria-describedby={callbackError ? callbackErrorId : undefined}
              aria-invalid={callbackError ? true : undefined}
              className="h-9 min-w-56"
              onChange={(event) => {
                setCallbackAt(event.target.value)
                if (callbackError) setCallbackError(null)
              }}
              onBlur={() => {
                if (!callbackAt) setCallbackError(t("outcomePicker.callbackTimeRequired"))
              }}
            />
            {callbackError ? (
              <span id={callbackErrorId} role="alert" className="max-w-64 text-xs text-destructive">
                {callbackError}
              </span>
            ) : null}
          </div>
          <Button
            type="button"
            size="sm"
            disabled={saving !== null}
            onClick={() => saveCallback(labelling)}
          >
            {t("outcomePicker.saveCallback")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving !== null}
            onClick={() => {
              setCallbackAt(null)
              setCallbackError(null)
            }}
          >
            {t("outcomePicker.back")}
          </Button>
        </div>
      )
    }

    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">{t("outcomePicker.title")}</span>
        {QUICK_CALL_DISPOSITIONS.map((outcome) => (
          <Button
            key={outcome}
            type="button"
            variant="outline"
            size="sm"
            disabled={saving !== null}
            onClick={() => {
              if (outcome === "callback") {
                setCallbackMin(toDateTimeLocalValue(new Date()))
                setCallbackAt("")
                setCallbackError(null)
                return
              }
              void saveOutcome(labelling, outcome)
            }}
          >
            {t(`outcomePicker.${outcome}`)}
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving !== null}
          onClick={() => {
            setLabelling(null)
            setCallbackAt(null)
            setCallbackError(null)
          }}
        >
          {t("outcomePicker.skip")}
        </Button>
      </div>
    )
  }

  return onCall ? (
    <Button type="button" variant="destructive" size="sm" onClick={hangUp} className="gap-2">
      <PhoneOff className="h-4 w-4" />
      {/* Two states, and neither is a guess: "dialling" until the halves meet,
          "on the call" once audio is actually moving. There is no ringing
          state because the station never reports one. */}
      {connected ? t("browserCallHangUp") : t("browserCallDiallingShort")}
    </Button>
  ) : (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={start}
      title={t("browserCallHint")}
      className="gap-2"
    >
      <Headphones className="h-4 w-4" />
      {t("browserCall")}
    </Button>
  )
}
