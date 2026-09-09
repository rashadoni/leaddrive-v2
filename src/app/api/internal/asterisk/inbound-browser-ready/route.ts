import { timingSafeEqual } from "node:crypto"

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { INBOUND_BROWSER_CLAIM_LEASE_MS } from "@/lib/voip/browser-softphone"

export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 1_024
const bodySchema = z.object({ callId: z.string().uuid() }).strict()

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

/**
 * PBX polling gate. A database claim is necessary but not sufficient: only the
 * relay can prove the exact winning browser is still alive and parked. The
 * final updateMany is a CAS after that network check, closing the DB→relay race.
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
  const call = await runWithTenant(organizationId, () => prisma.callLog.findFirst({
    where: {
      organizationId,
      provider: "asterisk",
      direction: "inbound",
      callMode: "human",
      providerCallId: parsed.data.callId,
      callSid: parsed.data.callId,
      status: { in: ["ringing", "answering"] },
      endedAt: null,
      claimedByUserId: { not: null },
      browserAnswerClaimToken: { not: null },
      browserAnswerClaimExpiresAt: { gt: now },
    },
    select: {
      id: true,
      providerCallId: true,
      claimedByUserId: true,
      userId: true,
      browserAnswerClaimToken: true,
    },
  }))
  if (
    !call?.providerCallId
    || !call.claimedByUserId
    || !call.browserAnswerClaimToken
    || call.userId !== call.claimedByUserId
  ) {
    return NextResponse.json({ ready: false })
  }

  const relaySecret = process.env.SOFTPHONE_RELAY_SECRET || ""
  const readyUrl = relayReadyUrl()
  if (relaySecret.length < 32 || !readyUrl) return NextResponse.json({ ready: false })

  try {
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
