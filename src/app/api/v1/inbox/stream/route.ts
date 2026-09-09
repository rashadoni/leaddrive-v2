import { prisma } from "@/lib/prisma"
import { nextInboxSignal, sseFrame, SSE_HEARTBEAT, type InboxSnapshot } from "@/lib/inbox-stream"
import { withRlsAuth } from "@/lib/with-rls"

// SSE must never be cached or statically optimized; Prisma needs the node runtime.
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const POLL_MS = 5_000 // change-detection cadence (replaces the client's 15s poll while connected)
const HEARTBEAT_MS = 25_000 // keepalive so idle proxies don't drop the connection

/** Cheap org-scoped snapshot — uses org indexes on ChannelMessage and CallLog. */
async function snapshot(orgId: string): Promise<InboxSnapshot> {
  const [messages, calls] = await Promise.all([
    prisma.channelMessage.aggregate({
      where: { organizationId: orgId },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.callLog.aggregate({
      where: { organizationId: orgId },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
  ])
  return {
    count: messages._count._all,
    latestMs: messages._max.createdAt?.getTime() ?? null,
    callCount: calls._count._all,
    callLatestMs: calls._max.createdAt?.getTime() ?? null,
  }
}

/**
 * GET /api/v1/inbox/stream — Server-Sent Events change-detector for /inbox/v2.
 *
 * Auth is normally the browser cookie (EventSource cannot set custom headers),
 * while the route-level inbox/read guard also keeps non-browser HTTP clients
 * on the same explicit permission boundary.
 * Emits `connected` once, then `refresh` whenever the org's message signature
 * changes. The client re-fetches /api/v1/inbox on `refresh`; if the stream drops,
 * the client falls back to its existing 15s poll. Net-new + additive: the legacy
 * /inbox and the shared GET/POST are untouched.
 */
export const GET = withRlsAuth("inbox", "read", async (req, { orgId }) => {
  const encoder = new TextEncoder()
  let sig: string | null = null
  let poll: ReturnType<typeof setInterval> | undefined
  let beat: ReturnType<typeof setInterval> | undefined
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          /* controller already closed — stop trying */
        }
      }
      const cleanup = () => {
        if (closed) return
        closed = true
        if (poll) clearInterval(poll)
        if (beat) clearInterval(beat)
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      // Client disconnect (tab close, navigation, network drop) → tear down so the
      // server-side poll loop never leaks past the connection.
      req.signal.addEventListener("abort", cleanup)

      // Baseline the signature WITHOUT pushing (client already has initial data).
      try {
        const snap = await snapshot(orgId)
        sig = nextInboxSignal(null, snap).signature
      } catch {
        /* first snapshot failed — the poll below will retry and re-baseline */
      }

      // If the client aborted during that await, the intervals must NOT be armed.
      if (closed) return

      safeEnqueue(sseFrame({ type: "connected" }, "connected"))

      poll = setInterval(async () => {
        if (closed) return
        try {
          const snap = await snapshot(orgId)
          const { signature, changed } = nextInboxSignal(sig, snap)
          sig = signature
          if (changed) safeEnqueue(sseFrame({ type: "refresh" }, "refresh"))
        } catch {
          /* transient DB error — keep the stream open, retry next tick */
        }
      }, POLL_MS)

      beat = setInterval(() => safeEnqueue(SSE_HEARTBEAT), HEARTBEAT_MS)
    },
    cancel() {
      closed = true
      if (poll) clearInterval(poll)
      if (beat) clearInterval(beat)
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx: stream chunks immediately, no proxy buffering — so NO nginx.conf
      // change is required for this route (verify on first prod deploy).
      "X-Accel-Buffering": "no",
    },
  })
})
