/**
 * T8 Cobrowse — shared SSE helper.
 *
 * Both the agent (`/api/v1/cobrowse/sessions/[id]/stream`) and
 * customer (`/api/v1/public/cobrowse/stream`) SSE routes call into
 * this so the connection lifecycle stays identical.
 *
 * Lifecycle invariants:
 *   - One-shot `event: ready` on connect so the client UI can flip
 *     from "connecting" to "ready"
 *   - 25s heartbeat comments (`:`) keep the connection through
 *     CDN/proxy idle timeouts (nginx 60s, Cloudflare 100s)
 *   - On client abort OR stream cancel: clear heartbeat +
 *     unsubscribe from channel manager; both paths idempotent
 *     so double-fire (rare under racing client+server close) is safe
 *
 * Single-process scope (see `channels.ts` doc comment) — slice-2c
 * will migrate to Redis pub-sub without changing this surface.
 */

import type { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { subscribe, type SignalEnvelope, type ChannelRole } from "./channels"

/** Heartbeat interval — chosen to undercut typical proxy idle
 *  timeouts. Override only for tests. */
export const SSE_HEARTBEAT_MS = 25_000

export function openSseStream(
  req: NextRequest,
  sessionId: string,
  role: ChannelRole,
): Response {
  const encoder = new TextEncoder()
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let unsubscribe: (() => void) | null = null
  let closed = false

  const cleanup = () => {
    if (closed) return
    closed = true
    if (heartbeat) {
      clearInterval(heartbeat)
      heartbeat = null
    }
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return
        try {
          controller.enqueue(chunk)
        } catch {
          // Controller closed underneath us — fall into cleanup so
          // the channel manager subscription doesn't leak.
          cleanup()
          try { controller.close() } catch { /* already closed */ }
        }
      }

      safeEnqueue(encoder.encode(`event: ready\ndata: ${JSON.stringify({ role, sessionId })}\n\n`))

      const onSignal = (env: SignalEnvelope) => {
        safeEnqueue(encoder.encode(`data: ${JSON.stringify(env)}\n\n`))
      }
      unsubscribe = subscribe(sessionId, role, onSignal)

      // Initial `lastSeenAt` poke on connect — the reaper cron uses
      // this as the liveness signal; without it a healthy active
      // session whose state isn't transitioning would get reaped
      // at the 15-min threshold (slice-3c P1 fix).
      void pokeLastSeen(sessionId)

      heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(`: keep-alive\n\n`))
        // Heartbeat-rate DB poke. At 25s × small N concurrent
        // sessions, write load is trivial. Fire-and-forget — a
        // failed poke is logged but does NOT close the stream
        // (a stuck DB shouldn't kill a working WebRTC connection).
        void pokeLastSeen(sessionId)
      }, SSE_HEARTBEAT_MS)

      const onAbort = () => {
        cleanup()
        try { controller.close() } catch { /* already closed */ }
      }
      req.signal.addEventListener("abort", onAbort)
    },
    cancel() {
      // Client cancelled the stream (e.g. nav away). Same cleanup
      // path as abort — cleanup is idempotent so double-fire is safe.
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "Connection": "keep-alive",
      // nginx-specific — disable response buffering so frames flush
      // immediately. Harmless on other proxies. See DEPLOYMENT.md
      // for per-tenant proxy configuration notes.
      "X-Accel-Buffering": "no",
    },
  })
}

/** Fire-and-forget `lastSeenAt` poke. Uses `updateMany` so a row
 *  that's been ended underneath us (concurrent transition) doesn't
 *  raise a Prisma `RecordNotFound` error — count=0 is a no-op. */
async function pokeLastSeen(sessionId: string): Promise<void> {
  try {
    await prisma.cobrowseSession.updateMany({
      where: { id: sessionId, status: { in: ["pending", "awaiting_consent", "active", "paused"] } },
      data: { lastSeenAt: new Date() },
    })
  } catch (e) {
    console.warn(`[cobrowse/sse] lastSeenAt poke failed for ${sessionId}:`, e)
  }
}
