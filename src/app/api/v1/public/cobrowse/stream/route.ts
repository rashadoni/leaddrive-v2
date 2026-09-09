import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { isValidJoinTokenShape } from "@/lib/cobrowse/tokens"
import { openSseStream } from "@/lib/cobrowse/sse"

/**
 * GET /api/v1/public/cobrowse/stream?joinToken=<x>
 *
 * T8 Cobrowse — slice-2b customer-side SSE channel.
 *
 * Customer subscribes via joinToken (the only credential available
 * before WebRTC peer connection is up). Receives every signal the
 * agent posts to `/api/v1/cobrowse/sessions/[id]/signal`.
 *
 * Auth: joinToken query parameter (validated against unique
 * cobrowse_sessions row + state). Public route, rate-limited via
 * middleware public-GET bucket.
 *
 * Same SSE plumbing as the agent route — shared `openSseStream`
 * helper guarantees identical lifecycle (heartbeat, abort, close).
 */

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const joinToken = url.searchParams.get("joinToken") || ""
  if (!isValidJoinTokenShape(joinToken)) {
    return NextResponse.json({ error: "Invalid joinToken" }, { status: 400 })
  }

  // RLS phase 1 — org resolution: joinToken is a cross-tenant external
  // identifier, so the lookup runs bypass-scoped (resolution only).
  const session = await runWithRlsBypass(() =>
    prisma.cobrowseSession.findUnique({
      where: { joinToken },
      select: { id: true, organizationId: true, status: true },
    })
  )
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }
  // Customer SSE is only valid AFTER consent has flipped the session
  // to active (or paused, where the agent can resume). awaiting_consent
  // pre-WebRTC + pending/ended should never see SSE traffic.
  if (session.status !== "active" && session.status !== "paused") {
    return NextResponse.json(
      { error: "session_not_signaling", currentStatus: session.status },
      { status: 409 },
    )
  }

  // RLS phase 2 — tenant-scoped. openSseStream registers the SSE
  // ReadableStream synchronously inside this scope, so the connect-time
  // `lastSeenAt` poke AND the 25s heartbeat setInterval ticks (timers
  // capture the ALS context active at registration) keep tenant context
  // for their cobrowse_sessions writes.
  return await runWithTenant(session.organizationId, () =>
    openSseStream(req, session.id, "customer")
  )
}
