import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { openSseStream } from "@/lib/cobrowse/sse"
import { withRlsAuth } from "@/lib/with-rls"

/**
 * GET /api/v1/cobrowse/sessions/[id]/stream
 *
 * T8 Cobrowse — slice-2b agent-side SSE channel.
 *
 * Long-lived event-stream connection. The agent subscribes once
 * after creating the session; every signal posted by the customer
 * (via `/api/v1/public/cobrowse/signal`) is broadcast here.
 *
 * Auth: session JWT, `settings.read`. Cross-tenant guard verifies
 * the session belongs to the caller's org before binding the
 * SSE subscription.
 *
 * Connection lifecycle, heartbeat, and cleanup all live in the
 * shared `src/lib/cobrowse/sse.ts` helper so this route + the
 * customer-side public stream route share an identical contract.
 */

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export const GET = withRlsAuth("settings", "read", async (req, auth, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params

  const session = await prisma.cobrowseSession.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { id: true, status: true },
  })
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return openSseStream(req, id, "agent")
})
