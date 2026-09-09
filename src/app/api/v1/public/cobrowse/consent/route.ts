import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { canTransition } from "@/lib/cobrowse/state-machine"
import { isValidJoinTokenShape } from "@/lib/cobrowse/tokens"
import type { CobrowseStatus } from "@/lib/cobrowse/types"

/**
 * POST /api/v1/public/cobrowse/consent
 *
 * T8 Cobrowse — slice-2 customer-side consent grant.
 *
 * Customer ticks the consent checkbox on the consent banner. On
 * success:
 *   - Stamps `consentGivenAt`
 *   - Transitions awaiting_consent → active
 *   - Returns minimal session ack
 *
 * `granted: false` is also accepted — customer declined; session
 * transitions to `ended` with reason `customer_left`.
 *
 * Auth: PUBLIC, no session required. Token in body identifies the
 * session. Rate-limited by middleware public-POST bucket.
 */

const bodySchema = z.object({
  joinToken: z.string(),
  granted: z.boolean(),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  if (!isValidJoinTokenShape(parsed.data.joinToken)) {
    return NextResponse.json({ error: "Invalid joinToken" }, { status: 400 })
  }

  // RLS phase 1 — org resolution: joinToken is a cross-tenant external
  // identifier, so the lookup runs bypass-scoped (resolution only).
  const session = await runWithRlsBypass(() =>
    prisma.cobrowseSession.findUnique({
      where: { joinToken: parsed.data.joinToken },
      select: {
        id: true,
        organizationId: true,
        status: true,
        consentGivenAt: true,
      },
    })
  )
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  // RLS phase 2 — all remaining handler work runs tenant-scoped.
  return await runWithTenant(session.organizationId, async () => {

  // Customer declined — terminal transition with explicit reason.
  if (!parsed.data.granted) {
    const result = canTransition(
      {
        currentStatus: session.status as CobrowseStatus,
        consentGiven: session.consentGivenAt !== null,
      },
      "ended",
    )
    if (!result.ok) {
      return NextResponse.json({ error: result.reason, currentStatus: session.status }, { status: 409 })
    }
    // Conditional-where closes the check-then-write race.
    const updateRes = await prisma.cobrowseSession.updateMany({
      where: { id: session.id, status: session.status },
      data: { status: "ended", endedAt: new Date(), endReason: "customer_left" },
    })
    if (updateRes.count === 0) {
      return NextResponse.json({ error: "session_state_changed", currentStatus: session.status }, { status: 409 })
    }
    return NextResponse.json({ success: true, session: { id: session.id, status: "ended" } })
  }

  // Customer granted — gate-check uses `consentGiven: true` because
  // we're about to set it in the same updateMany below; the
  // conditional-where (`status: "awaiting_consent"`) ensures the
  // write only lands if no concurrent transition has flipped the
  // session away from awaiting_consent.
  const result = canTransition(
    {
      currentStatus: session.status as CobrowseStatus,
      consentGiven: true,
    },
    "active",
  )
  if (!result.ok) {
    return NextResponse.json({ error: result.reason, currentStatus: session.status }, { status: 409 })
  }

  const updateRes = await prisma.cobrowseSession.updateMany({
    where: { id: session.id, status: session.status },
    data: { status: "active", consentGivenAt: new Date() },
  })
  if (updateRes.count === 0) {
    return NextResponse.json({ error: "session_state_changed", currentStatus: session.status }, { status: 409 })
  }

  return NextResponse.json({ success: true, session: { id: session.id, status: "active" } })
  }) // end runWithTenant (tenant-scoped handler body)
}
