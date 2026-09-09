import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { publish } from "@/lib/cobrowse/channels"
import { isValidJoinTokenShape } from "@/lib/cobrowse/tokens"
import {
  isPayloadTooLarge,
  isSignalingState,
  preflightContentLength,
  SIGNAL_KINDS,
} from "@/lib/cobrowse/signal-validation"
import type { CobrowseStatus } from "@/lib/cobrowse/types"

/**
 * POST /api/v1/public/cobrowse/signal
 *
 * T8 Cobrowse — slice-2b customer-side signal publish.
 *
 * Customer's RTCPeerConnection ICE/SDP messages are POSTed here
 * with the joinToken as the auth credential. Routed to the agent's
 * SSE listener via the in-memory channel manager.
 *
 * Auth: joinToken in body.
 * Rate-limit: per-`cobrowse-signal` bucket in middleware (carved
 * separately because ICE trickle commonly fires 50+ candidates
 * over ~5 seconds — the default public bucket of 10/min/ip would
 * 429 customers mid-handshake).
 *
 * Returns `{ delivered: boolean }`.
 */

const bodySchema = z.object({
  joinToken: z.string(),
  kind: z.enum(SIGNAL_KINDS),
  payload: z.unknown(),
})

export async function POST(req: NextRequest) {
  const preflight = preflightContentLength(req)
  if (preflight) return preflight

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  if (!isValidJoinTokenShape(parsed.data.joinToken)) {
    return NextResponse.json({ error: "Invalid joinToken" }, { status: 400 })
  }
  if (isPayloadTooLarge(parsed.data.payload)) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 })
  }

  // RLS phase 1 — org resolution: joinToken is a cross-tenant external
  // identifier, so the lookup runs bypass-scoped. The only DB access in
  // this route; everything after is the in-memory channel publish.
  const session = await runWithRlsBypass(() =>
    prisma.cobrowseSession.findUnique({
      where: { joinToken: parsed.data.joinToken },
      select: { id: true, status: true },
    })
  )
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 })
  if (!isSignalingState(session.status as CobrowseStatus)) {
    return NextResponse.json(
      { error: "session_not_signaling", currentStatus: session.status },
      { status: 409 },
    )
  }

  const delivered = publish(session.id, "customer", {
    kind: parsed.data.kind,
    payload: parsed.data.payload,
  })

  return NextResponse.json({ success: true, delivered })
}
