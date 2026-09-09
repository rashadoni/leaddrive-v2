/**
 * The relay asks the CRM who this browser is. It never learns how to answer.
 *
 * The relay joins two halves of a call — a browser and the PBX — and the
 * browser's claim to be on that call is a signed parking ticket. Verification
 * lives HERE rather than in the relay, and that is the whole point:
 *
 *  - one implementation of the ticket, in the app that mints it, so the two
 *    can never drift apart;
 *  - the relay never holds the signing secret, so a relay that is compromised
 *    (it is the process most exposed to the network) cannot mint tickets for
 *    calls it was not given;
 *  - a signature proves the ticket was issued, nothing more. Only the database
 *    knows whether that call exists, belongs to this organisation, is this
 *    user's, and is recent enough to still be ringing. A stateless token cannot
 *    check any of that, and all four have to be true.
 *
 * The relay authenticates with its own shared secret, deliberately NOT the one
 * the PBX control channel uses: a leak on either side must not become a forged
 * call record on the other.
 */

import { NextResponse } from "next/server"
import { timingSafeEqual } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { readParkTicket } from "@/lib/voip/browser-softphone"

export const dynamic = "force-dynamic"

/** A call that has been ringing this long is not one a browser is waiting on. */
const PARK_WINDOW_MS = 120_000

function relayAuthorized(request: Request): boolean {
  const expected = process.env.SOFTPHONE_RELAY_SECRET
  if (!expected || expected.length < 32) return false
  const received = request.headers.get("x-relay-secret") || ""
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!relayAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let ticket: unknown
  try {
    ticket = (await request.json())?.ticket
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const claims = readParkTicket(ticket)
  if (!claims) {
    // One answer for every way of being wrong. The relay has nothing to do with
    // the difference, and an error that names it tells an attacker which half
    // of the ticket to keep working on.
    return NextResponse.json({ error: "invalid_ticket" }, { status: 401 })
  }

  // The signature says the ticket was issued. The database says whether the
  // call it names is real, is this user's, and is still worth joining. This
  // read is deliberately outside tenant RLS because the relay has no session —
  // and it is safe precisely because every field it filters on comes from the
  // signed ticket, not from the caller.
  const inboundClaim = claims.claimToken
    ? {
        provider: "asterisk",
        direction: "inbound",
        status: "ringing",
        endedAt: null,
        claimedByUserId: claims.userId,
        userId: claims.userId,
        browserAnswerClaimToken: claims.claimToken,
        browserAnswerClaimExpiresAt: { gt: new Date() },
      }
    : null
  const call = await runWithRlsBypass(() => prisma.callLog.findFirst({
    where: {
      id: claims.callLogId,
      organizationId: claims.orgId,
      callMode: "human",
      OR: [
        {
          direction: "outbound",
          userId: claims.userId,
        },
        ...(inboundClaim ? [inboundClaim] : []),
      ],
    },
    select: {
      id: true,
      direction: true,
      createdAt: true,
      endedAt: true,
      providerCallId: true,
    },
  }))
  if (!call) return NextResponse.json({ error: "unknown_call" }, { status: 404 })
  if (call.endedAt) return NextResponse.json({ error: "call_already_ended" }, { status: 409 })
  if (call.direction === "outbound" && Date.now() - call.createdAt.getTime() > PARK_WINDOW_MS) {
    return NextResponse.json({ error: "park_window_expired" }, { status: 409 })
  }

  return NextResponse.json({
    orgId: claims.orgId,
    userId: claims.userId,
    callLogId: call.id,
    // What the PBX will announce itself with, so the relay pairs the two halves
    // on a value neither of them chose for itself.
    correlationId: call.providerCallId,
    ...(call.direction === "inbound" && claims.claimToken
      ? { claimToken: claims.claimToken }
      : {}),
  })
}
