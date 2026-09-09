import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { canTransition } from "@/lib/cobrowse/state-machine"
import { COBROWSE_END_REASONS, COBROWSE_STATUSES, type CobrowseStatus } from "@/lib/cobrowse/types"
import { generateJoinToken } from "@/lib/cobrowse/tokens"
import { withRlsAuth } from "@/lib/with-rls"

/**
 * T8 Cobrowse — slice-2 agent-side session lifecycle.
 *
 * GET /api/v1/cobrowse/sessions/[id] — fetch current state. Cross-
 *   tenant guard via `findFirst({ id, organizationId })`. Slice-2b
 *   will add an SSE variant of this for live status updates.
 *
 * PATCH /api/v1/cobrowse/sessions/[id] — agent-initiated status
 *   transition. Body: `{ status: "paused" | "active" | "ended",
 *   endReason? }`. The slice-1 state-machine `canTransition` gates
 *   every move and surfaces specific 409 reasons (consent_required,
 *   invalid_transition, terminal). Side-effects:
 *     - active → paused: rotates `joinToken` (a leaked URL can't
 *       resume after pause)
 *     - * → ended: stamps `endedAt` + persists `endReason` (must be
 *       in COBROWSE_END_REASONS when supplied)
 *     - paused → active: requires `consentGivenAt` to be set
 *       (state-machine enforces; consent gate re-applies on resume)
 */

const patchSchema = z.object({
  status: z.enum(COBROWSE_STATUSES),
  endReason: z.enum(COBROWSE_END_REASONS).optional(),
})

export const GET = withRlsAuth("settings", "read", async (_req, auth, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params

  const session = await prisma.cobrowseSession.findFirst({
    where: { id, organizationId: auth.orgId },
    select: {
      id: true,
      organizationId: true,
      agentUserId: true,
      contactId: true,
      status: true,
      joinToken: true,
      consentGivenAt: true,
      endReason: true,
      startedAt: true,
      endedAt: true,
      updatedAt: true,
    },
  })
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true, session })
})

export const PATCH = withRlsAuth("settings", "write", async (req, auth, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params

  let body: unknown
  try { body = await req.json() } catch { body = {} }
  const parsed = patchSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const next: CobrowseStatus = parsed.data.status

  // endReason only meaningful on terminal transition.
  if (next !== "ended" && parsed.data.endReason !== undefined) {
    return NextResponse.json(
      { error: "endReason is only valid on transitions to 'ended'" },
      { status: 400 },
    )
  }

  // Cross-tenant guard.
  const existing = await prisma.cobrowseSession.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { id: true, status: true, consentGivenAt: true },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const result = canTransition(
    { currentStatus: existing.status as CobrowseStatus, consentGiven: existing.consentGivenAt !== null },
    next,
  )
  if (!result.ok) {
    // All transition-rejection cases surface as 409 (state conflict).
    // The error code in the body lets the client differentiate
    // (consent_required vs invalid_transition vs terminal) without
    // burning two distinct status codes.
    return NextResponse.json({ error: result.reason, currentStatus: existing.status }, { status: 409 })
  }

  // Side-effects for each transition.
  const updateData: {
    status: CobrowseStatus
    joinToken?: string
    endedAt?: Date
    endReason?: string
  } = { status: next }

  if (next === "paused" && existing.status === "active") {
    // Rotate token on pause so a leaked URL can't resume after the
    // agent has explicitly intervened. Customer-side reconnect
    // requires the agent to share a refreshed link.
    updateData.joinToken = generateJoinToken()
  }
  if (next === "ended") {
    updateData.endedAt = new Date()
    // Default to agent_ended when the agent doesn't specify a reason.
    // Avoids NULL endReason rows for routes that always trigger from
    // the agent UI, which the slice-2 telemetry filters by reason.
    updateData.endReason = parsed.data.endReason ?? "agent_ended"
  }

  // Conditional-where closes the check-then-write race: the
  // `findFirst` snapshot above and this update are separate awaits,
  // so a concurrent transition (e.g. customer hitting consent /
  // another agent ending the session) could land between them.
  // updateMany with `where: { status: <expected> }` no-ops when the
  // row drifted; we treat 0 affected as a 409 retry hint.
  const result2 = await prisma.cobrowseSession.updateMany({
    where: { id, status: existing.status },
    data: updateData,
  })
  if (result2.count === 0) {
    return NextResponse.json(
      { error: "session_state_changed", currentStatus: existing.status },
      { status: 409 },
    )
  }
  // Re-read the updated row for the response.
  const updated = await prisma.cobrowseSession.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      joinToken: true,
      consentGivenAt: true,
      endReason: true,
      endedAt: true,
      updatedAt: true,
    },
  })
  return NextResponse.json({ success: true, session: updated })
})
