import { timingSafeEqual } from "node:crypto"

import { Prisma } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { INBOUND_BROWSER_CLAIM_LEASE_MS } from "@/lib/voip/browser-softphone"
import { shouldAiAnswer } from "@/lib/voip/inbound-answer"
import { loadInboundAnswerSelection } from "@/lib/voip/inbound-answer-config"

export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 1_024
const bodySchema = z.object({ callId: z.string().uuid() }).strict()
const AI_ROUTE_EVENT_TYPE = "asterisk_inbound_answer_route"
const AI_ROUTE_EVENT_HASH = "asterisk-inbound-answer-route-v1:ai"
/** Statuses an inbound call the AI already took can be in while it talks. */
const AI_TAKEN_STATUSES = ["answering", "in-progress"]

function authorized(request: NextRequest): boolean {
  const expected = process.env.FANUM_VOICE_RUNTIME_TOKEN?.trim() || ""
  const received = request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/iu)?.[1] || ""
  if (!expected || !received) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(received)
  return left.length === right.length && timingSafeEqual(left, right)
}

function relayReadyUrl(): string | null {
  const raw = process.env.SOFTPHONE_RELAY_PORT?.trim() || "8095"
  if (!/^\d{1,5}$/.test(raw)) return null
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null
  // Host is deliberately not configurable: this trust path stays loopback.
  return `http://127.0.0.1:${port}/internal/browser-ready`
}

const AI_ROUTE = { ready: false, route: "ai" } as const

/**
 * Hand a ringing inbound call to the AI voice agent, exactly once.
 *
 * A compare-and-set on the ringing human row: a salesperson whose claim is
 * still live wins, and so does a concurrent poll that already flipped the row.
 * Clearing the claim fields keeps the popup from showing an expired claimant
 * an "answering" call the AI is now on.
 */
async function routeToAi(params: {
  organizationId: string
  callLogId: string
  callId: string
  channelConfigId: string
  now: Date
}): Promise<boolean> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const taken = await tx.callLog.updateMany({
      where: {
        id: params.callLogId,
        organizationId: params.organizationId,
        provider: "asterisk",
        direction: "inbound",
        callMode: "human",
        providerCallId: params.callId,
        callSid: params.callId,
        status: "ringing",
        endedAt: null,
        AND: [{ OR: [{ channelConfigId: null }, { channelConfigId: params.channelConfigId }] }],
        OR: [
          { browserAnswerClaimToken: null },
          { browserAnswerClaimExpiresAt: null },
          { browserAnswerClaimExpiresAt: { lte: params.now } },
        ],
      },
      data: {
        callMode: "ai",
        channelConfigId: params.channelConfigId,
        status: "answering",
        userId: null,
        claimedByUserId: null,
        claimedAt: null,
        browserAnswerClaimToken: null,
        browserAnswerClaimExpiresAt: null,
      },
    })
    if (taken.count !== 1) return false
    await tx.callEvent.create({
      data: {
        organizationId: params.organizationId,
        callLogId: params.callLogId,
        provider: "asterisk",
        providerCallId: params.callId,
        eventType: AI_ROUTE_EVENT_TYPE,
        eventHash: AI_ROUTE_EVENT_HASH,
        payload: { version: 1, route: "ai", decidedAt: params.now.toISOString() },
      },
    })
    return true
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
}

/**
 * PBX polling gate. A database claim is necessary but not sufficient: only the
 * relay can prove the exact winning browser is still alive and parked. The
 * final updateMany is a CAS after that network check, closing the DB→relay race.
 *
 * While no browser is ready, the same poll also applies the organisation's
 * inbound answer setting: `{ ready: false, route: "ai" }` tells the station to
 * answer and connect the caller to the AI voice agent instead.
 */
export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const organizationId = process.env.VOICE_AGENT_ORGANIZATION_ID?.trim()
  if (!organizationId) return NextResponse.json({ ready: false })

  const raw = await request.text()
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    body = null
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const now = new Date()
  try {
    const call = await runWithTenant(organizationId, () => prisma.callLog.findFirst({
      where: {
        organizationId,
        provider: "asterisk",
        direction: "inbound",
        callMode: { in: ["human", "ai"] },
        providerCallId: parsed.data.callId,
        callSid: parsed.data.callId,
        status: { in: ["ringing", "answering", "in-progress"] },
        endedAt: null,
      },
      select: {
        id: true,
        callMode: true,
        status: true,
        startedAt: true,
        createdAt: true,
        providerCallId: true,
        claimedByUserId: true,
        userId: true,
        browserAnswerClaimToken: true,
        browserAnswerClaimExpiresAt: true,
      },
    }))
    if (!call?.providerCallId) return NextResponse.json({ ready: false })

    // A repeated poll after the AI took the call must keep saying so; a bare
    // "not ready" would let the station time out and hang up on the caller.
    if (call.callMode === "ai") {
      return NextResponse.json(
        AI_TAKEN_STATUSES.includes(call.status) ? AI_ROUTE : { ready: false },
      )
    }

    const hasLiveBrowserClaim = Boolean(
      call.claimedByUserId
      && call.browserAnswerClaimToken
      && call.browserAnswerClaimExpiresAt
      && call.browserAnswerClaimExpiresAt.getTime() > now.getTime(),
    )

    if (!hasLiveBrowserClaim) {
      if (call.status !== "ringing") return NextResponse.json({ ready: false })
      const { policy, channelConfigId } = await runWithTenant(organizationId, () => loadInboundAnswerSelection(organizationId))
      const aiNow = shouldAiAnswer({
        policy,
        ringingSince: call.startedAt ?? call.createdAt,
        now,
        hasLiveBrowserClaim,
      })
      if (!aiNow || !channelConfigId) return NextResponse.json({ ready: false })
      const routed = await runWithTenant(organizationId, () => routeToAi({
        organizationId,
        callLogId: call.id,
        callId: call.providerCallId as string,
        channelConfigId,
        now,
      }))
      // Losing the CAS means a salesperson claimed it in the same instant;
      // the next poll serves their browser instead.
      return NextResponse.json(routed ? AI_ROUTE : { ready: false })
    }

    if (call.userId !== call.claimedByUserId || !["ringing", "answering"].includes(call.status)) {
      return NextResponse.json({ ready: false })
    }

    const relaySecret = process.env.SOFTPHONE_RELAY_SECRET || ""
    const readyUrl = relayReadyUrl()
    if (relaySecret.length < 32 || !readyUrl) return NextResponse.json({ ready: false })

    const response = await fetch(readyUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relay-secret": relaySecret,
      },
      body: JSON.stringify({
        correlationId: call.providerCallId,
        claimToken: call.browserAnswerClaimToken,
      }),
      signal: AbortSignal.timeout(1_000),
    })
    if (!response.ok) return NextResponse.json({ ready: false })
    const result = await response.json().catch(() => null) as { ready?: unknown } | null
    if (result?.ready !== true) return NextResponse.json({ ready: false })

    const reservedAt = new Date()
    const reserved = await runWithTenant(organizationId, () => prisma.callLog.updateMany({
      where: {
        id: call.id,
        organizationId,
        provider: "asterisk",
        direction: "inbound",
        callMode: "human",
        status: { in: ["ringing", "answering"] },
        endedAt: null,
        claimedByUserId: call.claimedByUserId,
        userId: call.userId,
        browserAnswerClaimToken: call.browserAnswerClaimToken,
        browserAnswerClaimExpiresAt: { gt: reservedAt },
      },
      data: {
        status: "answering",
        browserAnswerClaimExpiresAt: new Date(
          reservedAt.getTime() + INBOUND_BROWSER_CLAIM_LEASE_MS,
        ),
      },
    }))
    return NextResponse.json({ ready: reserved.count === 1 })
  } catch {
    return NextResponse.json({ ready: false })
  }
}
