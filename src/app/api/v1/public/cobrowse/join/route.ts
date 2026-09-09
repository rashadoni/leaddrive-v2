import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { canTransition } from "@/lib/cobrowse/state-machine"
import { isValidJoinTokenShape } from "@/lib/cobrowse/tokens"
import type { CobrowseStatus } from "@/lib/cobrowse/types"

/**
 * POST /api/v1/public/cobrowse/join
 *
 * T8 Cobrowse — slice-2 customer-side join.
 *
 * Customer presents `joinToken` (received from the agent via link,
 * QR, or chat). On success:
 *   - Session must be in `pending` status (otherwise 409 — already
 *     joined, ended, or paused)
 *   - Transitions pending → awaiting_consent (so the consent banner
 *     can render)
 *   - Returns minimal session context (org name for the consent
 *     banner, no PII)
 *
 * Auth: PUBLIC, no session required — customer is anonymous on the
 * portal until they grant consent.
 *
 * Rate-limit: middleware applies the public-POST 10/min/ip bucket
 * (rate-limit-policy.md §2).
 *
 * The token alone identifies the session globally; there's no `org`
 * query param like the form-builder route. Slice-2b will lift the
 * org from the token-bound session at the SSE connection point.
 */

const bodySchema = z.object({
  joinToken: z.string(),
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
    // Pre-DB shape check — cheap defense against random scraper traffic.
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
        organization: { select: { name: true, slug: true } },
      },
    })
  )
  // Use a uniform 404 for both "no row" and "wrong status" to avoid
  // leaking which tokens have ever existed.
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  const result = canTransition(
    { currentStatus: session.status as CobrowseStatus, consentGiven: session.consentGivenAt !== null },
    "awaiting_consent",
  )
  if (!result.ok) {
    // pending → awaiting_consent is the only valid first transition;
    // anything else means the session was already joined or ended.
    return NextResponse.json({ error: "Session is not available to join" }, { status: 409 })
  }

  // RLS phase 2 — the state transition runs tenant-scoped.
  // Conditional-where closes the check-then-write race: between the
  // findUnique above and this update, an agent could have ended or
  // paused the session. updateMany no-ops on drift.
  const updateRes = await runWithTenant(session.organizationId, () =>
    prisma.cobrowseSession.updateMany({
      where: { id: session.id, status: "pending" },
      data: { status: "awaiting_consent" },
    })
  )
  if (updateRes.count === 0) {
    return NextResponse.json({ error: "Session is not available to join" }, { status: 409 })
  }

  // Minimal context for the consent banner — no PII, no token in the
  // response. Customer already has the token (they sent it).
  return NextResponse.json({
    success: true,
    session: {
      id: session.id,
      organizationName: session.organization.name,
    },
  })
}
