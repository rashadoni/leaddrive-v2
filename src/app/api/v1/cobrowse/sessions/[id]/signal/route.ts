import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { publish } from "@/lib/cobrowse/channels"
import {
  isPayloadTooLarge,
  isSignalingState,
  preflightContentLength,
  SIGNAL_KINDS,
} from "@/lib/cobrowse/signal-validation"
import type { CobrowseStatus } from "@/lib/cobrowse/types"

/**
 * POST /api/v1/cobrowse/sessions/[id]/signal
 *
 * T8 Cobrowse — slice-2b agent-side signal publish.
 *
 * Agent's RTCPeerConnection ICE/SDP messages are POSTed here and
 * fanned out to the customer's SSE listener via the in-memory
 * channel manager.
 *
 * Auth: session JWT, `settings.write`. Cross-tenant guard ensures
 * the agent can only signal into sessions in their own org.
 *
 * State guard: only `active` + `paused`. `awaiting_consent` is
 * NOT allowed — without a persistence layer, an offer fired before
 * the customer's SSE is up would be silently dropped. Slice-3
 * client waits for `active` before initiating the WebRTC handshake.
 *
 * Returns `{ delivered: boolean }` — false when customer hasn't
 * connected to the stream yet (slice-3 client buffers + retries).
 */

const bodySchema = z.object({
  kind: z.enum(SIGNAL_KINDS),
  payload: z.unknown(),
})

export const POST = withRlsAuth("settings", "write", async (req: NextRequest, auth, ctx: { params: Promise<{ id: string }> }) => {
  // Pre-flight Content-Length check — avoid buffering a multi-MB body
  // just to reject it as oversized.
  const preflight = preflightContentLength(req)
  if (preflight) return preflight

  const { id } = await ctx.params

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  if (isPayloadTooLarge(parsed.data.payload)) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 })
  }

  // Cross-tenant guard + state check.
  const session = await prisma.cobrowseSession.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { id: true, status: true },
  })
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!isSignalingState(session.status as CobrowseStatus)) {
    return NextResponse.json(
      { error: "session_not_signaling", currentStatus: session.status },
      { status: 409 },
    )
  }

  const delivered = publish(id, "agent", {
    kind: parsed.data.kind,
    payload: parsed.data.payload,
  })

  return NextResponse.json({ success: true, delivered })
})
