/**
 * T8 Cobrowse — in-memory signaling channel manager.
 *
 * Slice-2b carries WebRTC offer/answer/ICE messages between the
 * agent + customer sides of a session over server-sent events.
 * This module is the pub-sub broker:
 *
 *   subscribe(sessionId, role, listener) → unsubscribe()
 *   publish(sessionId, fromRole, payload)
 *
 * Single-process scope: messages only fan out within ONE Node.js
 * instance. For LeadDrive's single-PM2-process-per-tenant
 * deployment this is fine. Multi-instance deployments will need a
 * slice-2c upgrade to Redis pub-sub — documented in the operator
 * notes for the route.
 *
 * Memory bounds: every subscription holds a reference until
 * unsubscribe(). The SSE route MUST call unsubscribe() on connection
 * close (req.signal.addEventListener('abort', ...)). The channel
 * manager actively prunes empty session entries on the last
 * unsubscribe so a long-running process doesn't leak the channel
 * map indefinitely.
 *
 * Message shape is opaque here — the route layer validates SDP/ICE
 * structure before publishing. Channel manager just routes bytes.
 */

/** Per-session subscriber role. Each side has at most one active
 *  SSE connection; reconnects supersede the previous listener. */
export type ChannelRole = "agent" | "customer"

/** Signal-payload envelope. `kind` lets the recipient route to the
 *  right RTCPeerConnection handler. */
export interface SignalEnvelope {
  /** Higher-level type — see slice-3 client for the consumers. */
  kind: "offer" | "answer" | "ice" | "pause" | "resume" | "ended"
  /** Opaque payload — JSON-serialized SDP / ICE candidate / etc. */
  payload: unknown
  /** Server-stamped timestamp (ms since epoch). Set by `publish`. */
  ts: number
  /** Which side originated this. */
  from: ChannelRole
}

export type SignalListener = (env: SignalEnvelope) => void

interface ChannelEntry {
  agent?: SignalListener
  customer?: SignalListener
}

/** Internal registry. Exported only for tests via `__resetChannelsForTest`. */
const CHANNELS = new Map<string, ChannelEntry>()

/** Subscribe a listener for one role on a session. Returns the
 *  unsubscribe function. A new subscription on the same role
 *  REPLACES the existing listener — slice-2c may allow multiple
 *  agents but slice-2b is 1:1. */
export function subscribe(
  sessionId: string,
  role: ChannelRole,
  listener: SignalListener,
): () => void {
  let entry = CHANNELS.get(sessionId)
  if (!entry) {
    entry = {}
    CHANNELS.set(sessionId, entry)
  }
  entry[role] = listener

  return function unsubscribe() {
    const e = CHANNELS.get(sessionId)
    if (!e) return
    // Only remove if it's still THIS listener — a reconnect with a
    // fresh subscription would have replaced it, and we mustn't
    // wipe the new listener when the OLD connection closes.
    if (e[role] === listener) {
      delete e[role]
    }
    if (!e.agent && !e.customer) {
      CHANNELS.delete(sessionId)
    }
  }
}

/** Publish a signal envelope from one role; routes to the OTHER
 *  role's listener if present. Returns true when a listener was
 *  notified, false when the recipient hasn't connected yet
 *  (e.g. agent fires an offer before the customer joins). */
export function publish(
  sessionId: string,
  from: ChannelRole,
  envWithoutMeta: Pick<SignalEnvelope, "kind" | "payload">,
): boolean {
  const entry = CHANNELS.get(sessionId)
  if (!entry) return false
  const recipientRole: ChannelRole = from === "agent" ? "customer" : "agent"
  const listener = entry[recipientRole]
  if (!listener) return false
  const env: SignalEnvelope = {
    kind: envWithoutMeta.kind,
    payload: envWithoutMeta.payload,
    ts: Date.now(),
    from,
  }
  try {
    listener(env)
    return true
  } catch (e) {
    // A throwing listener (e.g. closed stream) shouldn't cascade
    // back to the publisher. Best-effort delivery; the SSE route
    // owns the connection-cleanup signal.
    console.warn(`[cobrowse/channels] listener throw on ${sessionId}/${recipientRole}:`, e)
    return false
  }
}

/** Inspect current subscription state. Used by tests + the
 *  agent's "is customer connected?" status check. */
export function getSubscribersInfo(sessionId: string): {
  agent: boolean
  customer: boolean
} {
  const entry = CHANNELS.get(sessionId)
  return {
    agent: !!entry?.agent,
    customer: !!entry?.customer,
  }
}

/** Test helper — drops all channel state. Don't call from app code. */
export function __resetChannelsForTest(): void {
  CHANNELS.clear()
}
