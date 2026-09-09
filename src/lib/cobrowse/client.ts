/**
 * T8 Cobrowse — WebRTC peer wrapper (transport-agnostic).
 *
 * Both the agent + customer UIs call `createCobrowsePeer(...)` to
 * negotiate a connection. The wrapper handles:
 *   - SDP offer/answer exchange via injected `sendSignal`
 *   - ICE trickle (queued until remote-description set, then drained)
 *   - Receiving remote signals (caller pumps via `handleIncomingSignal`)
 *   - Lifecycle: connect → connected → closed
 *
 * Why injection instead of fetching the signal API inside the
 * wrapper: lets the unit tests run without `RTCPeerConnection` being
 * a real browser API (vitest happy-dom is enough), and lets the
 * customer + agent paths share one implementation with different
 * signal-send / SSE-listen plumbing.
 *
 * The signal-stream owner (SSE consumer) calls
 * `handleIncomingSignal(env)` for every event the channel manager
 * dispatches; the peer wrapper routes to the right handler based on
 * `env.kind`.
 *
 * Pause/resume + ended are user-level lifecycle signals, not WebRTC
 * negotiation events — they ride through the same channel but the
 * peer wrapper just forwards them via `onLifecycle`.
 */

import type { SignalEnvelope } from "./channels"

/** Role this peer plays in the WebRTC negotiation:
 *   - `offerer` (agent) creates the SDP offer and sends it first
 *   - `answerer` (customer) waits for the offer + replies with answer
 * Aligning to the customer's screen-share direction: agent watches,
 * so the customer is the producer of the MediaStream and answers
 * with their SDP. */
export type PeerRole = "offerer" | "answerer"

/** Higher-level lifecycle events surfaced to UI. */
export type CobrowseLifecycle =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "remote-stream"; stream: MediaStream }
  | { kind: "peer-paused" }
  | { kind: "peer-resumed" }
  | { kind: "ended"; reason?: string }
  | { kind: "error"; message: string }

export interface CobrowsePeerHandle {
  /** Open the peer connection. Idempotent — second call is a no-op. */
  connect(): Promise<void>
  /** Receive an incoming signal envelope from the SSE channel.
   *  Caller is responsible for filtering by sessionId (slice-2b
   *  envelope carries no session field — channel is keyed in SSE). */
  handleIncomingSignal(env: SignalEnvelope): Promise<void>
  /** Send a pause / resume / ended signal to the peer. */
  sendLifecycle(kind: "pause" | "resume" | "ended", payload?: unknown): Promise<void>
  /** Tear everything down. Idempotent. */
  close(): void
  /** Read the peer-connection state for diagnostics. */
  getState(): RTCPeerConnectionState | "closed"
}

export interface CobrowsePeerOptions {
  role: PeerRole
  /** RTC config (STUN/TURN). Slice-3a uses public STUN; slice-3b
   *  may inject a tenant-specific TURN server via channel config. */
  rtcConfig?: RTCConfiguration
  /** Caller's local media stream — pass for offerer/answerer side
   *  that produces video (customer in our case). undefined when
   *  the peer is receive-only (agent). */
  localStream?: MediaStream
  /** Send a signal to the remote peer. Returns a promise so the
   *  wrapper can await delivery (best-effort, ok for `delivered:
   *  false` since WebRTC retries ICE candidates internally). */
  sendSignal(env: { kind: "offer" | "answer" | "ice" | "pause" | "resume" | "ended"; payload: unknown }): Promise<void>
  /** Lifecycle event callback. Implementations should be tolerant
   *  of out-of-order events (e.g. "ended" can arrive before
   *  "connected" in degenerate cases). */
  onLifecycle?: (event: CobrowseLifecycle) => void
  /** Optional factory for the underlying RTCPeerConnection so unit
   *  tests can inject a stub. Defaults to `new RTCPeerConnection(...)`
   *  in the browser. */
  peerConnectionFactory?: (cfg: RTCConfiguration | undefined) => RTCPeerConnection
}

const DEFAULT_RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302"] },
  ],
}

export function createCobrowsePeer(opts: CobrowsePeerOptions): CobrowsePeerHandle {
  const factory = opts.peerConnectionFactory ?? ((cfg) => new RTCPeerConnection(cfg))
  let pc: RTCPeerConnection | null = null
  let connecting: Promise<void> | null = null
  let closed = false
  let remoteSet = false
  const pendingIce: RTCIceCandidateInit[] = []

  const emit = (event: CobrowseLifecycle) => {
    try {
      opts.onLifecycle?.(event)
    } catch (e) {
      // Don't let UI errors propagate into the peer connection.
      console.warn("[cobrowse-peer] onLifecycle threw:", e)
    }
  }

  function ensureOpen(): RTCPeerConnection {
    if (!pc) throw new Error("Cobrowse peer not connected")
    return pc
  }

  async function negotiateOffer(): Promise<void> {
    const conn = ensureOpen()
    const offer = await conn.createOffer()
    await conn.setLocalDescription(offer)
    await opts.sendSignal({ kind: "offer", payload: offer })
  }

  async function setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    const conn = ensureOpen()
    await conn.setRemoteDescription(desc)
    remoteSet = true
    // Drain any ICE candidates that arrived before the description.
    for (const c of pendingIce.splice(0)) {
      await conn.addIceCandidate(c).catch((e) => {
        console.warn("[cobrowse-peer] queued ICE add failed:", e)
      })
    }
  }

  async function handleOffer(payload: unknown): Promise<void> {
    if (!isSessionDescription(payload)) return
    const conn = ensureOpen()
    await setRemoteDescription(payload)
    const answer = await conn.createAnswer()
    await conn.setLocalDescription(answer)
    await opts.sendSignal({ kind: "answer", payload: answer })
  }

  async function handleAnswer(payload: unknown): Promise<void> {
    if (!isSessionDescription(payload)) return
    await setRemoteDescription(payload)
  }

  async function handleIce(payload: unknown): Promise<void> {
    if (!isIceCandidate(payload)) return
    const conn = ensureOpen()
    if (!remoteSet) {
      // Queue until remote description is in.
      pendingIce.push(payload)
      return
    }
    await conn.addIceCandidate(payload).catch((e) => {
      console.warn("[cobrowse-peer] ICE add failed:", e)
    })
  }

  return {
    async connect() {
      if (closed) return
      if (pc) return
      if (connecting) return connecting

      connecting = (async () => {
        emit({ kind: "connecting" })
        pc = factory(opts.rtcConfig ?? DEFAULT_RTC_CONFIG)

        pc.onicecandidate = (e) => {
          if (e.candidate) {
            // Fire-and-forget — ICE is internally retried by WebRTC.
            void opts.sendSignal({ kind: "ice", payload: e.candidate.toJSON() })
          }
        }
        pc.ontrack = (e) => {
          // First track delivers the remote MediaStream. Browsers
          // emit `streams[0]` reliably for normal addStream usage.
          const stream = e.streams[0]
          if (stream) emit({ kind: "remote-stream", stream })
        }
        pc.onconnectionstatechange = () => {
          if (!pc) return
          if (pc.connectionState === "connected") emit({ kind: "connected" })
          if (pc.connectionState === "failed") {
            emit({ kind: "error", message: "WebRTC connection failed" })
          }
          if (pc.connectionState === "closed") {
            emit({ kind: "ended" })
          }
        }

        if (opts.localStream) {
          for (const track of opts.localStream.getTracks()) {
            pc.addTrack(track, opts.localStream)
          }
        }

        if (opts.role === "offerer") {
          await negotiateOffer()
        }
        // Answerer waits for the incoming "offer" signal.
      })()
      await connecting
    },

    async handleIncomingSignal(env) {
      if (closed) return
      switch (env.kind) {
        case "offer":
          if (opts.role !== "answerer") return // ignore wrong-side offers
          await handleOffer(env.payload)
          break
        case "answer":
          if (opts.role !== "offerer") return
          await handleAnswer(env.payload)
          break
        case "ice":
          await handleIce(env.payload)
          break
        case "pause":
          emit({ kind: "peer-paused" })
          break
        case "resume":
          emit({ kind: "peer-resumed" })
          break
        case "ended":
          emit({ kind: "ended", reason: extractEndReason(env.payload) })
          break
      }
    },

    async sendLifecycle(kind, payload) {
      if (closed) return
      await opts.sendSignal({ kind, payload: payload ?? null })
    },

    close() {
      if (closed) return
      closed = true
      if (pc) {
        try {
          pc.close()
        } catch {
          /* ignore */
        }
        pc = null
      }
    },

    getState() {
      if (closed) return "closed"
      return pc?.connectionState ?? "new"
    },
  }
}

function isSessionDescription(v: unknown): v is RTCSessionDescriptionInit {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return typeof o.type === "string" && typeof o.sdp === "string"
}

function isIceCandidate(v: unknown): v is RTCIceCandidateInit {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  // candidate-init may have a null candidate field (end-of-candidates),
  // sdpMid/sdpMLineIndex are typical. Permissive check — WebRTC
  // implementation validates the rest.
  return "candidate" in o || "sdpMid" in o || "sdpMLineIndex" in o
}

/** Accept two payload shapes for `ended`:
 *   - `"agent_ended"` — bare reason string (sent by `sendLifecycle`
 *     with just a reason)
 *   - `{ reason: "agent_ended" }` — envelope shape (sent by the
 *     agent route which posts `{reason}` in the JSON body)
 *  Anything else returns undefined and the lifecycle event omits
 *  the reason field. */
function extractEndReason(payload: unknown): string | undefined {
  if (typeof payload === "string") return payload
  if (payload && typeof payload === "object" && "reason" in payload) {
    const r = (payload as { reason: unknown }).reason
    if (typeof r === "string") return r
  }
  return undefined
}
