/**
 * Realtime change-detection for the inbox SSE bridge (Phase 6, slice-1).
 *
 * Pure + server-safe (NO React / lucide imports — the SSE route imports this).
 * The stream is a cheap *change detector*: it watches a lightweight signature of
 * the org's ChannelMessage table and tells the client "refresh" when it changes.
 * The client then re-runs its existing `GET /api/v1/inbox` fetch — so the heavy
 * inbox-building logic stays in ONE place and the stream never duplicates it.
 *
 * slice-1 mechanism = server-side poll bridge (aggregate count + max(createdAt)).
 * A future slice-2 can swap the poll for Postgres LISTEN/NOTIFY without touching
 * the client contract (still just a "refresh" event).
 */

export interface InboxSnapshot {
  /** Total ChannelMessage rows for the org. */
  count: number
  /** Epoch ms of the most recent ChannelMessage, or null if the org has none. */
  latestMs: number | null
  /** Total CallLog rows for the org. Included so call-only WhatsApp threads refresh live. */
  callCount?: number
  /** Epoch ms of the most recent CallLog, or null if the org has none. */
  callLatestMs?: number | null
}

/**
 * Stable signature for a snapshot. Changes iff a message was added OR the latest
 * message timestamp moved (covers insert + the practical edit cases). `count`
 * alone would miss a delete+insert that nets zero; pairing it with `latestMs`
 * catches the common "new inbound message" path, which is what realtime is for.
 */
export function inboxSignature(s: InboxSnapshot): string {
  return `${s.count}:${s.latestMs ?? 0}:${s.callCount ?? 0}:${s.callLatestMs ?? 0}`
}

/**
 * Decide whether to push a refresh. Returns the new signature and whether it
 * changed from `prev`.
 *
 * The FIRST observation (prev === null) is deliberately NOT a change: the client
 * already loaded initial data via its own fetch when it opened the stream, so we
 * only ever push on a genuine *delta* after that baseline — never an immediate
 * redundant refresh on connect.
 */
export function nextInboxSignal(
  prev: string | null,
  snap: InboxSnapshot,
): { signature: string; changed: boolean } {
  const signature = inboxSignature(snap)
  return { signature, changed: prev !== null && prev !== signature }
}

/**
 * Serialize a Server-Sent Events frame. `data` is JSON-encoded; `event` is the
 * optional event name the client's EventSource listens for. Always terminated by
 * the blank line SSE requires to flush the frame.
 */
export function sseFrame(data: unknown, event?: string): string {
  const lines: string[] = []
  if (event) lines.push(`event: ${event}`)
  lines.push(`data: ${JSON.stringify(data)}`)
  return lines.join("\n") + "\n\n"
}

/** An SSE comment line — used as a keepalive heartbeat (ignored by EventSource). */
export const SSE_HEARTBEAT = ": heartbeat\n\n"
