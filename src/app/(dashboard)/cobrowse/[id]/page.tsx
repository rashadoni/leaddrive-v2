"use client"

/**
 * T8 Cobrowse — agent session viewer.
 *
 * `/cobrowse/[id]` — live cobrowse panel for the agent. Shows the
 * shareable join URL + QR-friendly token, then opens the SSE stream
 * + WebRTC peer (offerer role) once the customer joins.
 *
 * On `connected`: customer's screen renders in the `<video>` element.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Copy, Pause, Play, X, RefreshCw, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { createCobrowsePeer, type CobrowsePeerHandle } from "@/lib/cobrowse/client"
import type { SignalEnvelope } from "@/lib/cobrowse/channels"
import type { CobrowseStatus } from "@/lib/cobrowse/types"
import { HelpButton } from "@/components/help/help-button"

interface SessionInfo {
  id: string
  status: CobrowseStatus
  joinToken: string
  consentGivenAt: string | null
  startedAt: string
  endedAt: string | null
}

type ViewState =
  | "loading"
  | "waiting" // session created, customer hasn't joined
  | "connecting" // SSE + peer up but no remote track yet
  | "live" // remote-stream received
  | "paused"
  | "ended"
  | "error"

export default function CobrowseSessionPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params.id

  const [session, setSession] = useState<SessionInfo | null>(null)
  const [view, setView] = useState<ViewState>("loading")
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const peerRef = useRef<CobrowsePeerHandle | null>(null)
  const sseRef = useRef<EventSource | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const sendSignal = useCallback(async (env: { kind: SignalEnvelope["kind"]; payload: unknown }) => {
    try {
      await fetch(`/api/v1/cobrowse/sessions/${id}/signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: env.kind, payload: env.payload }),
      })
    } catch (e) {
      console.warn("[cobrowse/agent] sendSignal failed:", e)
    }
  }, [id])

  const teardown = useCallback(() => {
    peerRef.current?.close()
    peerRef.current = null
    sseRef.current?.close()
    sseRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  useEffect(() => () => teardown(), [teardown])

  // Track the latest view-state in a ref so navigate-away handlers
  // can read it without re-binding listeners on every state change.
  const viewRef = useRef<ViewState>("loading")
  useEffect(() => {
    viewRef.current = view
  }, [view])

  // Skip-flag for intentional navigation (Back to sessions / End
  // button). Without it, the on-unmount auto-end PATCH would fire
  // on every Back-click and silently kill a live customer's session
  // every time the agent navigates between sessions. Buttons set
  // this BEFORE calling router.push().
  const skipAutoEndRef = useRef(false)

  // Belt-and-suspenders to the 15-min reaper cron (slice-3c) for
  // the common "agent closes the tab while session is active" case.
  // Two layers:
  //   1) beforeunload prompts the agent ("are you sure?") so an
  //      accidental tab-close doesn't silently end a real customer's
  //      session.
  //   2) on unmount (when skipAutoEndRef is false — i.e. NOT an
  //      intentional Back/End click), if we were in live/paused,
  //      fire a best-effort PATCH so the row flips to ended
  //      immediately instead of waiting for the reaper.
  // The `connecting` state is intentionally EXCLUDED — a session
  // that never reached `live` and gets agent-closed would be
  // marked `agent_ended` even though no media actually flowed, and
  // the reaper's lastSeenAt-stale path catches never-connected
  // pending rows anyway. Slice-2 telemetry stays honest.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const v = viewRef.current
      if (v !== "live" && v !== "paused") return
      // Modern browsers ignore custom strings — they show their own
      // generic "leave site?" prompt when returnValue is set. We set
      // both for older browser compat.
      e.preventDefault()
      e.returnValue = ""
      return ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      if (skipAutoEndRef.current) return // intentional in-app nav
      const v = viewRef.current
      if (v === "live" || v === "paused") {
        // fetch + keepalive is the modern post-page-unload-safe
        // alternative to sendBeacon (sendBeacon forces POST and
        // doesn't speak PATCH). Spec caps keepalive bodies at
        // 64KB; our payload is ~50 bytes. The PATCH route's
        // conditional-where makes redundant PATCHes a no-op 409
        // so racing with a manual End is safe.
        fetch(`/api/v1/cobrowse/sessions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "ended", endReason: "agent_ended" }),
          keepalive: true,
        }).catch(() => {/* best-effort — reaper backstops */})
      }
    }
  }, [id])

  // 1) Load session metadata. Repolled when user clicks "Refresh" to
  //    detect customer-join transitions before SSE wakes up.
  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/cobrowse/sessions/${id}`)
      if (!res.ok) {
        setError(`Failed to load session (HTTP ${res.status})`)
        setView("error")
        return
      }
      const body: { session: SessionInfo } = await res.json()
      setSession(body.session)
      // Drive the view-state from the persisted session status.
      if (body.session.status === "active" || body.session.status === "paused") {
        // Customer is connected — open SSE + peer if not already.
        if (!sseRef.current) void connectPeer(body.session)
        // Functional setView reads fresh state — avoids the stale-
        // closure trap on `view` (architect P1: closure capture in
        // useCallback without `view` in deps).
        setView((prev) => {
          if (body.session.status === "paused") return "paused"
          return prev === "live" ? "live" : "connecting"
        })
      } else if (body.session.status === "ended") {
        teardown()
        setView("ended")
      } else {
        // pending / awaiting_consent — customer hasn't accepted yet.
        setView("waiting")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load session")
      setView("error")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, teardown])

  useEffect(() => {
    void refreshSession()
  }, [refreshSession])

  // Auto-poll while waiting for customer (every 5s). Stops once SSE
  // is up — by then status is active and we listen there instead.
  useEffect(() => {
    if (view !== "waiting") return
    const handle = setInterval(() => {
      void refreshSession()
    }, 5_000)
    return () => clearInterval(handle)
  }, [view, refreshSession])

  // 2) Build SSE + WebRTC peer (offerer role; receive-only — no
  //    local stream).
  //
  // ORDERING IS CRITICAL (architect P1):
  //   1) Build peer + assign to peerRef BEFORE any await — unifies
  //      the concurrency guard with refreshSession's outer
  //      `if (!sseRef.current)` check (architect: asymmetric
  //      sentinels invite TOCTOU drift).
  //   2) Wire `es.onmessage` + `addEventListener("ready")` BEFORE
  //      `peer.connect()` — agent emits offer synchronously inside
  //      connect()'s negotiateOffer(). If the customer answers
  //      before our onmessage is attached, the SSE frame is
  //      dropped (no buffering at channel layer; EventSource
  //      doesn't queue messages for absent listeners). Visible
  //      under fast-customer-pickup / load test.
  const connectPeer = useCallback(async (sess: SessionInfo) => {
    if (peerRef.current || sseRef.current) return
    try {
      const sseUrl = `/api/v1/cobrowse/sessions/${sess.id}/stream`
      const es = new EventSource(sseUrl)
      sseRef.current = es

      const peer = createCobrowsePeer({
        role: "offerer",
        sendSignal,
        onLifecycle: (event) => {
          if (event.kind === "connected") setView("live")
          if (event.kind === "remote-stream") {
            if (videoRef.current) {
              videoRef.current.srcObject = event.stream
              videoRef.current.play().catch(() => {/* autoplay may need a tap */})
            }
            setView("live")
          }
          if (event.kind === "peer-paused") setView("paused")
          if (event.kind === "peer-resumed") setView("live")
          if (event.kind === "ended") {
            teardown()
            setView("ended")
          }
          if (event.kind === "error") {
            setError(event.message)
            setView("error")
          }
        },
      })
      // Pin peerRef BEFORE the connect() await so subsequent
      // refreshSession ticks see both sentinels and skip the
      // re-init branch unconditionally.
      peerRef.current = peer

      // Wire SSE listeners BEFORE connect() so the customer's
      // answer (which races the agent's outgoing offer) can't
      // arrive while onmessage is still unset.
      es.addEventListener("ready", () => {
        setView((v) => (v === "live" ? "live" : "connecting"))
      })
      es.onmessage = (ev) => {
        try {
          const env: SignalEnvelope = JSON.parse(ev.data)
          void peer.handleIncomingSignal(env)
        } catch (e) {
          console.warn("[cobrowse/agent] bad SSE frame:", e)
        }
      }
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          setError("Lost connection to customer")
          setView("error")
          teardown()
        }
      }

      // Now safe to negotiate — listeners are armed.
      await peer.connect()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect")
      setView("error")
      teardown()
    }
  }, [sendSignal, teardown])

  const copyJoinUrl = async () => {
    if (!session) return
    const url = `${window.location.origin}/c/${session.joinToken}`
    // `navigator.clipboard` only exists on secure contexts (https or
    // localhost). Some multi-client deployments may still be HTTP-only
    // before TLS is provisioned — fall back silently and let the
    // selectable readonly input cover the manual-copy path.
    if (!navigator.clipboard) {
      console.warn("[cobrowse/agent] clipboard unavailable — use the readonly URL field")
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      console.warn("[cobrowse/agent] clipboard write failed:", e)
    }
  }

  // Set the skip-flag before the Back-button navigates. This is
  // the entry the agent uses to navigate BETWEEN sessions — we
  // must NOT auto-end the one they're leaving.
  const navigateBack = () => {
    skipAutoEndRef.current = true
    router.push("/cobrowse")
  }

  const transitionStatus = async (status: "paused" | "active" | "ended", endReason?: string) => {
    // Manual End → mark skip BEFORE the PATCH so the on-unmount
    // path doesn't fire a redundant ended PATCH if the user
    // immediately navigates away (e.g. via Back). The conditional-
    // where on the route would 409 the redundant call anyway, but
    // skipping is cleaner.
    if (status === "ended") {
      skipAutoEndRef.current = true
    }
    try {
      const res = await fetch(`/api/v1/cobrowse/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...(endReason ? { endReason } : {}) }),
      })
      if (!res.ok) {
        const body: { error?: string } = await res.json().catch(() => ({}))
        setError(body.error || `HTTP ${res.status}`)
        return
      }
      // Also tell the customer via signal channel so their UI flips immediately.
      if (status === "paused") await sendSignal({ kind: "pause", payload: null })
      else if (status === "active") await sendSignal({ kind: "resume", payload: null })
      else if (status === "ended") await sendSignal({ kind: "ended", payload: { reason: endReason } })
      await refreshSession()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transition failed")
    }
  }

  if (view === "loading") {
    return <div className="p-6 text-sm text-muted-foreground">Loading session…</div>
  }
  if (view === "error" && !session) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={navigateBack}>← Back to sessions</Button>
        <div className="mt-4 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      </div>
    )
  }
  if (!session) return null

  const joinUrl = typeof window !== "undefined" ? `${window.location.origin}/c/${session.joinToken}` : `/c/${session.joinToken}`
  const VIEW_BADGE: Record<ViewState, { variant: "secondary" | "success" | "warning" | "destructive"; label: string }> = {
    loading: { variant: "secondary", label: "Loading" },
    waiting: { variant: "secondary", label: "Waiting for customer" },
    connecting: { variant: "secondary", label: "Connecting…" },
    live: { variant: "success", label: "Live" },
    paused: { variant: "warning", label: "Paused" },
    ended: { variant: "destructive", label: "Ended" },
    error: { variant: "destructive", label: "Error" },
  }
  const badge = VIEW_BADGE[view]

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Button variant="ghost" size="sm" onClick={navigateBack}>← Back to sessions</Button>
          <h1 className="text-2xl font-semibold mt-2 font-mono flex items-center gap-2">Session {session.id.slice(0, 8)}… <HelpButton slug="cobrowse-session-detail" variant="label" /></h1>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <Badge variant={badge.variant}>{badge.label}</Badge>
            <span>·</span>
            <span>Started {new Date(session.startedAt).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {view === "live" || view === "paused" ? (
            <>
              {view === "paused" ? (
                <Button variant="outline" onClick={() => transitionStatus("active")}>
                  <Play className="h-4 w-4 mr-1.5" />
                  Resume
                </Button>
              ) : (
                <Button variant="outline" onClick={() => transitionStatus("paused")}>
                  <Pause className="h-4 w-4 mr-1.5" />
                  Pause
                </Button>
              )}
              <Button variant="destructive" onClick={() => transitionStatus("ended", "agent_ended")}>
                <X className="h-4 w-4 mr-1.5" />
                End
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {/* Join URL block — visible while waiting + during the
          session so agent can re-share if customer lost the tab.
          Renders both a copy button (secure context) AND a
          readonly selectable input (HTTP-only multi-client
          deploys where navigator.clipboard is undefined). */}
      {view !== "ended" ? (
        <section className="rounded-md border p-4 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Customer join URL</h2>
          <div className="flex gap-2">
            <input
              readOnly
              value={joinUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 rounded-md border bg-muted px-3 py-2 text-xs font-mono"
            />
            <Button variant="outline" size="sm" onClick={copyJoinUrl}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span className="ml-1.5">{copied ? "Copied" : "Copy"}</span>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Send this to the customer via chat, email, or SMS. When they open it, they&apos;ll be asked to share a screen / tab / window.
          </p>
        </section>
      ) : null}

      {/* Live video region */}
      <section className="rounded-md border bg-black aspect-video flex items-center justify-center text-zinc-500 relative overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-contain ${view === "live" || view === "paused" ? "block" : "hidden"}`}
        />
        {view === "waiting" ? (
          <div className="text-center space-y-2">
            <p className="text-sm">Waiting for customer to join…</p>
            <Button variant="ghost" size="sm" onClick={() => refreshSession()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Check now
            </Button>
          </div>
        ) : view === "connecting" ? (
          <p className="text-sm">Customer accepted — negotiating peer connection…</p>
        ) : view === "ended" ? (
          <p className="text-sm">Session ended.</p>
        ) : null}
      </section>
    </div>
  )
}
