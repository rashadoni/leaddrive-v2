import { NextResponse } from "next/server"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { checkRateLimit } from "@/lib/rate-limit"
import { checkVoicePilotAccess } from "@/lib/ai/voice/gate"
import { getOrgModuleContext } from "@/lib/api-auth"
import { accessibleVoiceSectionKeys } from "@/lib/ai/voice/read-access"
import { assertVoiceRlsPolicies } from "@/lib/ai/voice/rls-assert"
import { settleVoiceSeconds, reserveVoiceSeconds } from "@/lib/ai/voice/budget"
import { voiceScopedWhere } from "@/lib/ai/voice/scoped-where"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"
import { voiceMarkerIsPreConnection } from "@/lib/ai/voice/session-marker"
import {
  MAX_SESSION_SECONDS,
  MAX_TOOL_CALLS,
  HEARTBEAT_INTERVAL_SECONDS,
  SESSION_TOKEN_TTL_SECONDS,
} from "@/lib/ai/voice/config"

/**
 * Start a voice conversation: gate → reserve minutes → create the CRM session.
 *
 * The response deliberately carries NO tenant identity or provider secret.
 * Tenant and user are re-derived server-side from the session cookie on every
 * subsequent request instead.
 */
export const POST = withRlsAuth("ai", "read", async (req, auth) => {
  // Capture ordering before any gate/database await. A slow older request must
  // never resume later and classify a session created by a newer click as its
  // orphan.
  const requestStartedAt = new Date()
  const mutationGuard = guardInteractiveJsonMutation(req)
  if (mutationGuard) return mutationGuard
  const gate = await checkVoicePilotAccess(auth)
  if (!gate.ok) {
    return NextResponse.json({ error: "Forbidden", reason: gate.reason }, { status: 403 })
  }

  // Navigation is a browser-side tool, so its exact sidebar/RBAC allowlist
  // travels with this authenticated session.  It contains stable section keys
  // only (no tenant identity, record data or provider secret).
  const orgCtx = await getOrgModuleContext(auth.orgId)
  const allowedSections = accessibleVoiceSectionKeys(auth.role, orgCtx)

  // Per-user bucket, not per-org: one talkative pilot user must not be able to
  // lock the feature for everyone else in the tenant.
  if (!checkRateLimit(`voice:mint:${auth.orgId}:${auth.userId}`, { maxRequests: 6, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  try {
    await assertVoiceRlsPolicies()
  } catch (err) {
    console.error("[voice] RLS policy probe failed:", err)
    return NextResponse.json({ error: "Voice storage is not ready" }, { status: 503 })
  }

  const now = new Date()

  /**
   * Close whatever the previous click left behind, before reserving again.
   *
   * Every start mints a session and reserves the ceiling. When the console
   * fails to come up — a stale cached build, a refused microphone — the user
   * clicks again, and again. Production recorded five sessions inside
   * twenty-three seconds, none of which ever connected, twenty-five minutes
   * gone. The reaper eventually closed them, but the cost was already booked.
   *
   * A prior session from THIS user that never connected is that click, not a
   * conversation: it is closed here and refunded in full, so retrying costs
   * nothing. One that did connect is left alone — the reaper settles it on its
   * own terms, and taking it down here would let a second tab end the first
   * tab's live call.
   */
  // Wrapped, and deliberately non-fatal.
  //
  // This is housekeeping: it saves the user's minutes when a previous click
  // never became a conversation. Useful, but not worth a conversation. It ran
  // unguarded and something inside it started throwing, which turned every
  // start into a 500 — the cleanup that exists to save five minutes cost the
  // whole feature. Anything that is not on the critical path must fail alone.
  try {
    const orphans = await prisma.voiceSession.findMany({
      where: voiceScopedWhere(auth.orgId, {
        userId: auth.userId,
        status: "active",
        OR: [
          { elevenlabsConversationId: null },
          { elevenlabsConversationId: { startsWith: "gemini:minting:" } },
          { elevenlabsConversationId: { startsWith: "gemini:issued:" } },
        ],
        // Request A may pause here while request B creates a newer session.
        // Only sessions that predate A are A's orphans; without this cutoff A
        // can resume and supersede B before B reaches /connect.
        startedAt: { lt: requestStartedAt },
      }),
      select: { id: true, reservedSeconds: true, startedAt: true, elevenlabsConversationId: true },
    })
    for (const o of orphans) {
      if (!voiceMarkerIsPreConnection(o.elevenlabsConversationId)) continue
      const closed = await prisma.voiceSession.updateMany({
        where: {
          id: o.id,
          organizationId: auth.orgId,
          userId: auth.userId,
          status: "active",
          elevenlabsConversationId: o.elevenlabsConversationId,
          startedAt: { lt: requestStartedAt },
        },
        // Статус несёт причину: поля endReason у VoiceSession нет.
        data: { status: "superseded", endedAt: now, billedSeconds: 0 },
      })
      if (closed.count === 1) {
        await settleVoiceSeconds(auth.orgId, auth.userId, o.reservedSeconds, 0, o.startedAt)
      }
    }
  } catch (err) {
    // Logged, not swallowed: the previous version returned 500 with an empty
    // body and wrote nothing, so the failure was invisible from both sides.
    //
    // And logging is what finally showed the cause. `voiceScopedWhere` was used
    // here without ever being imported, so this block threw ReferenceError on
    // every single start. Wrapping it stopped the 500s and hid the fact that
    // orphan cleanup had never once run: abandoned reservations sat until the
    // cron reaper instead of being refunded at the next click. A guard around a
    // fault is not a fix for it — the typecheck named this on line 70 all along
    // and nothing was blocking on the typecheck.
    console.error("[voice] orphan cleanup failed (non-fatal):", err)
  }

  const reservation = await reserveVoiceSeconds(auth.orgId, auth.userId, MAX_SESSION_SECONDS, now)
  if (!reservation.ok) {
    return NextResponse.json(
      { error: "Voice budget exhausted", remainingSeconds: reservation.remainingSeconds },
      { status: 429 },
    )
  }

  const session = await prisma.voiceSession.create({
    data: {
      organizationId: auth.orgId,
      userId: auth.userId,
      status: "active",
      locale: typeof req.headers.get("x-locale") === "string" ? req.headers.get("x-locale")! : "ru",
      reservedSeconds: MAX_SESSION_SECONDS,
      startedAt: now,
      lastHeartbeatAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TOKEN_TTL_SECONDS * 1000),
    },
    select: { id: true },
  })

  await logAudit(auth.orgId, "voice_session_started", "voice_session", session.id, undefined, {
    userId: auth.userId,
  })

  // First name for address. Read HERE rather than taken from anything the
  // client sends: the browser could put any string in a request body, and this
  // one is spoken aloud by the model.
  // Empty when the record has no name — the agent then greets without one
  // instead of saying an empty slot out loud.
  let firstName = ""
  try {
    const me = (await prisma.user.findFirst({
      where: { id: auth.userId, organizationId: auth.orgId },
      select: { name: true },
    })) as { name: string | null } | null
    firstName = (me?.name ?? "").trim().split(/\s+/)[0] ?? ""
  } catch {
    // Not worth failing a conversation over a missing name.
  }

  return NextResponse.json({
    data: {
      contract: 1,
      voiceSessionId: session.id,
      maxSessionSeconds: MAX_SESSION_SECONDS,
      maxToolCalls: MAX_TOOL_CALLS,
      heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
      remainingSeconds: reservation.remainingSeconds,
      firstName,
      allowedSections,
    },
  })
})
