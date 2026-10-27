import { sseFrame, SSE_HEARTBEAT } from "@/lib/inbox-stream"
import { shellEventKindsFor } from "@/lib/shell-events/kinds"
import { subscribeShellEvents } from "@/lib/shell-events/watcher"
import { withRlsAuth } from "@/lib/with-rls"

// SSE must never be cached or statically optimized; Prisma needs the node runtime.
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const HEARTBEAT_MS = 25_000 // Cloudflare drops a proxied connection silent for 100 s, nginx after 60 s

/**
 * GET /api/v1/shell/events — what changed for the CRM shell, as Server-Sent
 * Events: `calls`, `notifications`, `tickets`, `webchat`, each with no data
 * beyond its name. The tab reads the change through the route it always used.
 * `connected` comes once the watcher has recorded the organisation's current
 * state, so a tab that reads after it misses nothing.
 *
 * Browser sessions only: the path names no module, so requireAuth refuses an
 * API key, and a mobile token never reaches requireAuth routes.
 */
export const GET = withRlsAuth(undefined, undefined, async (req, auth) => {
  const kinds = await shellEventKindsFor(auth)
  const encoder = new TextEncoder()
  let closed = false
  let unsubscribe = () => {}
  let beat: ReturnType<typeof setInterval> | undefined

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          /* controller already closed */
        }
      }
      const cleanup = () => {
        if (closed) return
        closed = true
        unsubscribe()
        if (beat) clearInterval(beat)
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
      req.signal.addEventListener("abort", cleanup)

      // EventSource reconnects by itself. Spread the reconnects, so a restart
      // does not bring every open tab back in the same second.
      send(`retry: ${3_000 + Math.floor(Math.random() * 7_000)}\n\n`)

      const subscription = subscribeShellEvents(auth.orgId, (event) => {
        if (!kinds.has(event.kind)) return
        if (event.kind === "notifications" && !event.userIds?.some((id) => id === auth.userId || id === "")) return
        send(sseFrame({ kind: event.kind }, event.kind))
      })
      unsubscribe = subscription.unsubscribe
      if (closed) {
        unsubscribe()
        return
      }
      await subscription.ready
      if (closed) return
      send(sseFrame({ kinds: [...kinds] }, "connected"))
      beat = setInterval(() => send(SSE_HEARTBEAT), HEARTBEAT_MS)
    },
    cancel() {
      closed = true
      unsubscribe()
      if (beat) clearInterval(beat)
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx: stream chunks immediately, no proxy buffering (as /api/v1/inbox/stream).
      "X-Accel-Buffering": "no",
    },
  })
})
