"use client"

/**
 * T8 Cobrowse — customer-side widget.
 *
 * Lifecycle this widget drives:
 *   1) Consent banner (granted / declined buttons)
 *   2) If granted → POST consent → `getDisplayMedia` → open SSE
 *      → start WebRTC peer (as answerer; agent will send offer)
 *   3) Status pills (connecting, connected, paused, ended) + a
 *      "Stop sharing" button that posts `ended` lifecycle signal
 *      and tears down
 *
 * Defense-in-depth posture:
 *   - SSE URL parameterized via `EventSource` constructor; only the
 *     URL builder controls the joinToken position so a malicious
 *     server response can't redirect anywhere
 *   - WebRTC peer wrapper does the SDP/ICE handling; this widget
 *     just plumbs the signals through `fetch` for outgoing +
 *     `EventSource.onmessage` for incoming
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Monitor, ShieldCheck, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { createCobrowsePeer, type CobrowsePeerHandle } from "@/lib/cobrowse/client"
import type { SignalEnvelope } from "@/lib/cobrowse/channels"

type UiPhase =
  | "consent"
  | "preparing"
  | "connecting"
  | "active"
  | "paused"
  | "ended"
  | "error"
  | "cancelled" // user dismissed the OS screen-share picker — recoverable via Retry

interface Props {
  joinToken: string
  sessionId: string
  initialStatus: "pending" | "awaiting_consent" | "active" | "paused"
  organizationName: string
}

export function CobrowseCustomerWidget({ joinToken, sessionId, initialStatus, organizationName }: Props) {
  const t = useTranslations("cobrowsePublic")
  const [phase, setPhase] = useState<UiPhase>(
    initialStatus === "active" || initialStatus === "paused"
      ? "preparing"
      : "consent",
  )
  const [error, setError] = useState<string | null>(null)

  // WebRTC + SSE lifecycle refs.
  const peerRef = useRef<CobrowsePeerHandle | null>(null)
  const sseRef = useRef<EventSource | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Send a signal envelope to the agent via the public signal route.
  const sendSignal = useCallback(
    async (env: { kind: SignalEnvelope["kind"]; payload: unknown }) => {
      try {
        await fetch("/api/v1/public/cobrowse/signal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ joinToken, kind: env.kind, payload: env.payload }),
        })
      } catch (e) {
        console.warn("[cobrowse/customer] sendSignal failed:", e)
      }
    },
    [joinToken],
  )

  // Tear down peer + SSE + screen-share stream. Idempotent.
  const teardown = useCallback(() => {
    peerRef.current?.close()
    peerRef.current = null
    sseRef.current?.close()
    sseRef.current = null
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop()
      streamRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => teardown()
  }, [teardown])

  // Auto-resume: if SSR snapshotted an active/paused session (page
  // reload mid-cobrowse), kick the screen-share flow immediately so
  // the customer isn't stuck on a spinner with no path forward.
  // Empty dependency-array because we ONLY want this to run on mount;
  // subsequent state changes are handled by the explicit buttons.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (initialStatus === "active" || initialStatus === "paused") {
      void startSharing()
    }
  }, [])

  const ensureJoined = useCallback(async () => {
    // If the SSR snapshot saw `pending`, the customer-side `/join`
    // transition hasn't fired yet — consent will 409 with
    // `invalid_transition` (only `awaiting_consent → active` is
    // valid). Call /join first to flip pending → awaiting_consent.
    // Idempotent server-side: if a concurrent tab already advanced
    // the session, /join returns 409 and we let consent surface
    // its own error.
    if (initialStatus !== "pending") return
    try {
      await fetch("/api/v1/public/cobrowse/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinToken }),
      })
    } catch (e) {
      console.warn("[cobrowse/customer] /join failed (will retry via consent):", e)
    }
  }, [initialStatus, joinToken])

  const startSharing = useCallback(async () => {
    setPhase("preparing")
    setError(null)
    try {
      // 1a) Make sure we're in awaiting_consent before posting consent.
      //     Server-side idempotent — concurrent tabs that already joined
      //     just see 409 here, which is harmless.
      await ensureJoined()

      // 1b) POST consent — server transitions awaiting_consent → active.
      const consentRes = await fetch("/api/v1/public/cobrowse/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinToken, granted: true }),
      })
      if (!consentRes.ok) {
        const body: { error?: string } = await consentRes.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${consentRes.status}`)
      }

      // 2) Capture the customer's screen. Browser shows its native
      //    picker — the customer chooses tab / window / entire screen.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 }, // 15fps is plenty for screen content; halves bandwidth vs 30fps
        audio: false, // explicitly no audio — privacy-safe default
      })
      streamRef.current = stream
      // Customer-side "stop sharing" from the browser's native picker.
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        void endSession("customer_left")
      })

      // 3) Open SSE stream BEFORE starting the peer so the agent's
      //    offer doesn't race past us.
      const sseUrl = `/api/v1/public/cobrowse/stream?joinToken=${encodeURIComponent(joinToken)}`
      const es = new EventSource(sseUrl)
      sseRef.current = es

      // 4) Build the peer wrapper as answerer (customer waits for the
      //    agent's offer; produces the screen-share track).
      const peer = createCobrowsePeer({
        role: "answerer",
        localStream: stream,
        sendSignal,
        onLifecycle: (event) => {
          if (event.kind === "connected") setPhase("active")
          if (event.kind === "peer-paused") setPhase("paused")
          if (event.kind === "peer-resumed") setPhase("active")
          if (event.kind === "ended") {
            teardown()
            setPhase("ended")
          }
          if (event.kind === "error") {
            setError(event.message)
            setPhase("error")
          }
        },
      })
      peerRef.current = peer
      await peer.connect()

      // 5) Wire SSE → peer.handleIncomingSignal.
      es.addEventListener("ready", () => {
        // Server confirms the channel is up. Slice-3b agent dashboard
        // listens for this too to flip its UI from "waiting" to
        // "connecting".
        setPhase("connecting")
      })
      es.onmessage = (ev) => {
        try {
          const env: SignalEnvelope = JSON.parse(ev.data)
          void peer.handleIncomingSignal(env)
        } catch (e) {
          console.warn("[cobrowse/customer] bad SSE frame:", e)
        }
      }
      es.onerror = () => {
        // Browsers auto-reconnect on transient drops; only escalate
        // if the SSE is permanently closed.
        if (es.readyState === EventSource.CLOSED) {
          setError("Connection lost")
          setPhase("error")
          teardown()
        }
      }
    } catch (e) {
      // Distinguish picker-cancelled (recoverable, common, NOT an
      // error worth red-banner UI) from real failures.
      const isCancelled =
        e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError")
      if (isCancelled) {
        setPhase("cancelled")
      } else {
        setError(e instanceof Error ? e.message : "Failed to start session")
        setPhase("error")
      }
      teardown()
    }
  }, [ensureJoined, joinToken, sendSignal, teardown])

  const declineConsent = useCallback(async () => {
    setPhase("preparing")
    try {
      await fetch("/api/v1/public/cobrowse/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinToken, granted: false }),
      })
    } finally {
      setPhase("ended")
      teardown()
    }
  }, [joinToken, teardown])

  const endSession = useCallback(
    async (reason?: string) => {
      try {
        await sendSignal({ kind: "ended", payload: { reason: reason ?? "customer_left" } })
      } catch {
        /* ignore */
      }
      teardown()
      setPhase("ended")
    },
    [sendSignal, teardown],
  )

  if (phase === "consent") {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-3 text-sm flex items-start gap-2">
          <ShieldCheck className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" />
          <p className="text-muted-foreground">
            <strong className="text-foreground">{organizationName}</strong>
            {" "}
            {t("consent.blurb")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={startSharing} className="flex-1">
            <Monitor className="h-4 w-4 mr-1.5" />
            {t("consent.allow")}
          </Button>
          <Button onClick={declineConsent} variant="ghost">{t("consent.decline")}</Button>
        </div>
      </div>
    )
  }

  if (phase === "preparing" || phase === "connecting") {
    return (
      <StatusBlock spinner>
        {phase === "preparing" ? t("status.preparing") : t("status.connecting")}
      </StatusBlock>
    )
  }

  if (phase === "active" || phase === "paused") {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Badge variant={phase === "active" ? "success" : "warning"}>
            {phase === "active" ? t("status.sharingLive") : t("status.pausedByAgent")}
          </Badge>
          <Button size="sm" variant="ghost" onClick={() => endSession("customer_left")}>
            <X className="h-4 w-4 mr-1" />
            {t("status.stopSharing")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("status.sharingExplain")}</p>
      </div>
    )
  }

  if (phase === "ended") {
    return <StatusBlock>{t("status.ended")}</StatusBlock>
  }

  if (phase === "cancelled") {
    // OS picker dismissed — friendly recoverable state, not an error.
    return (
      <div className="space-y-2">
        <StatusBlock>{t("status.cancelled")}</StatusBlock>
        <Button onClick={startSharing} size="sm">{t("status.retry")}</Button>
      </div>
    )
  }

  // phase === "error"
  return (
    <div className="space-y-2">
      <StatusBlock tone="error">{error || t("status.genericError")}</StatusBlock>
      <Button onClick={startSharing} variant="outline" size="sm">{t("status.retry")}</Button>
    </div>
  )
}

function StatusBlock({ children, spinner, tone }: { children: React.ReactNode; spinner?: boolean; tone?: "error" }) {
  const toneClass = tone === "error"
    ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300"
    : "bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700 text-muted-foreground"
  return (
    <div className={`rounded-lg border p-3 text-sm flex items-center gap-2 ${toneClass}`}>
      {spinner ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      <span>{children}</span>
    </div>
  )
}
