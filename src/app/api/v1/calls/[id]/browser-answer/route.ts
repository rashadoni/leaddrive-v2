import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"

import { getOrgModuleContext } from "@/lib/api-auth"
import { accessibleCallWhere } from "@/lib/calls/access"
import { checkPermission, type Role } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import {
  browserSoftphoneAllowed,
  browserSoftphoneConfigured,
  INBOUND_BROWSER_CLAIM_LEASE_MS,
  issueParkTicket,
} from "@/lib/voip/browser-softphone"
import { withRlsSessionAuth } from "@/lib/with-rls"

type RouteCtx = { params: Promise<{ id: string }> }

const CLAIM_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function readClaimToken(request: Request): Promise<string | null> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return null
  }
  if (!body || typeof body !== "object") return null
  const token = (body as { claimToken?: unknown }).claimToken
  return typeof token === "string" && CLAIM_TOKEN_RE.test(token) ? token : null
}

function permissionDenied(role: Role): NextResponse | null {
  return checkPermission(role, "voip", "write")
    ? null
    : NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

/**
 * Claim one ringing inbound call for one browser.
 *
 * The updateMany is the linearization point. Availability and mutation live in
 * the SAME statement, including lease expiry, so two salespeople cannot both
 * read "free" and then both answer. The following read only obtains the PBX
 * correlation id for a claim that has already been won.
 */
export const POST = withRlsSessionAuth(async (_request, auth, ctx: RouteCtx) => {
  const denied = permissionDenied(auth.role)
  if (denied) return denied
  if (!browserSoftphoneConfigured()) {
    return NextResponse.json({ error: "browser_calls_unavailable" }, { status: 503 })
  }

  const org = await getOrgModuleContext(auth.orgId).catch(() => null)
  if (!browserSoftphoneAllowed(org?.modules, auth.userId)) {
    return NextResponse.json({ error: "browser_calls_unavailable" }, { status: 422 })
  }

  const { id } = await ctx.params
  const now = new Date()
  const claimToken = randomUUID()
  const claimExpiresAt = new Date(now.getTime() + INBOUND_BROWSER_CLAIM_LEASE_MS)
  const claimed = await prisma.callLog.updateMany({
    where: {
      id,
      organizationId: auth.orgId,
      provider: "asterisk",
      direction: "inbound",
      callMode: "human",
      status: "ringing",
      endedAt: null,
      AND: [accessibleCallWhere(auth.role, auth.userId)],
      OR: [
        { browserAnswerClaimToken: null },
        { browserAnswerClaimExpiresAt: null },
        { browserAnswerClaimExpiresAt: { lte: now } },
      ],
    },
    data: {
      browserAnswerClaimToken: claimToken,
      browserAnswerClaimExpiresAt: claimExpiresAt,
      claimedByUserId: auth.userId,
      claimedAt: now,
      userId: auth.userId,
      status: "ringing",
    },
  })
  if (claimed.count !== 1) {
    return NextResponse.json({ error: "inbound_call_claimed" }, { status: 409 })
  }

  const call = await prisma.callLog.findFirst({
    where: {
      id,
      organizationId: auth.orgId,
      provider: "asterisk",
      direction: "inbound",
      callMode: "human",
      status: "ringing",
      endedAt: null,
      claimedByUserId: auth.userId,
      userId: auth.userId,
      browserAnswerClaimToken: claimToken,
      browserAnswerClaimExpiresAt: { gt: now },
    },
    select: { id: true, providerCallId: true },
  })
  if (!call?.providerCallId) {
    // Fail closed. The short lease releases this row even if the process dies
    // here; a compensating write would turn the one-statement claim into a
    // second state transition with its own race.
    return NextResponse.json({ error: "inbound_call_unavailable" }, { status: 409 })
  }

  const parkTicket = issueParkTicket({
    orgId: auth.orgId,
    userId: auth.userId,
    callLogId: call.id,
    claimToken,
  })
  const relayUrl = process.env.SOFTPHONE_RELAY_URL || ""
  if (!parkTicket || !relayUrl) {
    return NextResponse.json({ error: "browser_calls_unavailable" }, { status: 503 })
  }

  return NextResponse.json({ success: true, parkTicket, relayUrl, claimToken })
})

/** Release only this browser's not-yet-answered claim. */
export const DELETE = withRlsSessionAuth(async (request, auth, ctx: RouteCtx) => {
  const denied = permissionDenied(auth.role)
  if (denied) return denied
  const claimToken = await readClaimToken(request)
  if (!claimToken) {
    return NextResponse.json({ error: "invalid_inbound_call_claim" }, { status: 400 })
  }

  const { id } = await ctx.params
  const released = await prisma.callLog.updateMany({
    where: {
      id,
      organizationId: auth.orgId,
      provider: "asterisk",
      direction: "inbound",
      callMode: "human",
      status: "ringing",
      endedAt: null,
      claimedByUserId: auth.userId,
      browserAnswerClaimToken: claimToken,
    },
    data: {
      status: "ringing",
      claimedByUserId: null,
      claimedAt: null,
      userId: null,
      browserAnswerClaimToken: null,
      browserAnswerClaimExpiresAt: null,
    },
  })
  if (released.count !== 1) {
    return NextResponse.json({ error: "inbound_call_claim_lost" }, { status: 409 })
  }
  return NextResponse.json({ success: true })
})

/** Renew only the same live claim; an old tab cannot renew a replacement. */
export const PATCH = withRlsSessionAuth(async (request, auth, ctx: RouteCtx) => {
  const denied = permissionDenied(auth.role)
  if (denied) return denied
  const claimToken = await readClaimToken(request)
  if (!claimToken) {
    return NextResponse.json({ error: "invalid_inbound_call_claim" }, { status: 400 })
  }

  const { id } = await ctx.params
  const now = new Date()
  const renewed = await prisma.callLog.updateMany({
    where: {
      id,
      organizationId: auth.orgId,
      provider: "asterisk",
      direction: "inbound",
      callMode: "human",
      status: { in: ["ringing", "answering", "in-progress"] },
      endedAt: null,
      claimedByUserId: auth.userId,
      userId: auth.userId,
      browserAnswerClaimToken: claimToken,
      browserAnswerClaimExpiresAt: { gt: now },
    },
    data: {
      browserAnswerClaimExpiresAt: new Date(now.getTime() + INBOUND_BROWSER_CLAIM_LEASE_MS),
    },
  })
  if (renewed.count !== 1) {
    return NextResponse.json({ error: "inbound_call_claim_lost" }, { status: 409 })
  }
  return NextResponse.json({ success: true })
})
