import { sseFrame, SSE_HEARTBEAT } from "@/lib/inbox-stream"
import { checkPermission } from "@/lib/permissions"
import { shellEventKindsFor } from "@/lib/shell-events/kinds"
import { markShellPresent } from "@/lib/shell-events/presence"
import { subscribeShellEvents } from "@/lib/shell-events/watcher"
import { withRlsAuth } from "@/lib/with-rls"

// SSE must never be cached or statically optimized; Prisma needs the node runtime.
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const HEARTBEAT_MS = 25_000 // Cloudflare drops a proxied connection silent for 100 s
// The permitted kinds are decided when the stream opens. Closing it after
// about half an hour makes the browser reconnect and decide them again, so a
// role change, a hidden module or an ended reviewer grant reaches it.
const MAX_STREAM_MS = 25 * 60_000
const MAX_STREAM_JITTER_MS = 10 * 60_000

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
  let leave = () => {}
  let beat: ReturnType<typeof setInterval> | undefined
  let lifetime: ReturnType<typeof setTimeout> | undefined

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
        leave()
        if (beat) clearInterval(beat)
        if (lifetime) clearTimeout(lifetime)
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
      // The tab may have gone while authentication ran: `abort` will not fire again.
      if (req.signal.aborted) {
        cleanup()
        return
      }
      req.signal.addEventListener("abort", cleanup)
      lifetime = setTimeout(cleanup, MAX_STREAM_MS + Math.floor(Math.random() * MAX_STREAM_JITTER_MS))

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
      // Beat from the start: while the database is down `ready` waits, and the
      // proxies must not drop the connection meanwhile.
      beat = setInterval(() => send(SSE_HEARTBEAT), HEARTBEAT_MS)
      await subscription.ready
      if (closed) return
      send(sseFrame({ kinds: [...kinds] }, "connected"))
      // Someone who would see an incoming call's popup and may answer it: the
      // AI offers a transfer to a manager only while there is one.
      if (kinds.has("calls") && checkPermission(auth.role, "voip", "write")) leave = markShellPresent(auth.orgId, auth.userId)
    },
    cancel() {
      closed = true
      unsubscribe()
      leave()
      if (beat) clearInterval(beat)
      if (lifetime) clearTimeout(lifetime)
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
