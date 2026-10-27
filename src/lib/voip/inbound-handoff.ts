import { Prisma, type PrismaClient } from "@prisma/client"

/**
 * The AI voice agent hands an inbound call to a salesperson's browser.
 * Owner, 2026-10-27, Zeytun: «переводить на менеджеров Зейтуна в браузере CRM,
 * как обычный входящий». When nobody answers, the call goes back to the AI,
 * which takes the order itself.
 *
 * Four compare-and-set steps on the call's row, each once:
 * - requested: the agent asked (the AI still talks; `callMode` stays `ai`);
 * - ringing: the AI leg has ended and the station rings the browsers. The row
 *   is an ordinary ringing human call from here, so the popup, the browser
 *   claim and the readiness gate need nothing new;
 * - connected: the station reserved a parked browser;
 * - returned: nobody answered in time and the AI has the call again.
 *
 * A call is handed off at most once: a second request is refused, so a caller
 * cannot be bounced between the AI and an empty queue.
 */

export type HandoffState = "requested" | "ringing" | "connected" | "returned"

/** How long the station rings the browsers before giving the call back to the AI. */
export const HANDOFF_RING_SECONDS = 30

const HANDOFF_EVENT_TYPE = "asterisk_inbound_ai_handoff"

type Db = Pick<PrismaClient, "$transaction">

type CallRef = { organizationId: string; callLogId: string; providerCallId: string }

const inboundAsterisk = (call: CallRef): Prisma.CallLogWhereInput => ({
  id: call.callLogId,
  organizationId: call.organizationId,
  provider: "asterisk",
  direction: "inbound",
  providerCallId: call.providerCallId,
  callSid: call.providerCallId,
  endedAt: null,
})

async function step(db: Db, call: CallRef, where: Prisma.CallLogWhereInput, data: Prisma.CallLogUpdateManyMutationInput,
  to: HandoffState, now: Date): Promise<boolean> {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const moved = await tx.callLog.updateMany({ where: { ...inboundAsterisk(call), ...where }, data: { ...data, handoffState: to } })
    if (moved.count !== 1) return false
    // One journal row per step and call: the fixed hash makes a replay a
    // unique conflict rather than a second transition.
    await tx.callEvent.create({
      data: {
        organizationId: call.organizationId,
        callLogId: call.callLogId,
        provider: "asterisk",
        providerCallId: call.providerCallId,
        eventType: HANDOFF_EVENT_TYPE,
        eventHash: `asterisk-inbound-ai-handoff-v1:${to}`,
        payload: { version: 1, state: to, at: now.toISOString() },
      },
    })
    return true
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
}

/**
 * The agent asks for a person. Only a live AI call that was never handed off;
 * asking again before the AI leg ends is the same request (the agent may not
 * have heard the first answer), so it says the phrase and the leg ends.
 */
export async function requestAiHandoff(db: Db & Pick<PrismaClient, "callLog">, call: CallRef, now = new Date()): Promise<boolean> {
  const live: Prisma.CallLogWhereInput = { callMode: "ai", status: "in-progress", wasAnswered: true }
  if (await step(db, call, { ...live, handoffState: null }, { handoffRequestedAt: now }, "requested", now).catch(() => false)) return true
  const pending = await db.callLog.findFirst({ where: { ...inboundAsterisk(call), ...live, handoffState: "requested" }, select: { id: true } })
  return pending !== null
}

/**
 * The AI leg has ended: ring the browsers. A fresh request time puts the call
 * in the popup's five-minute window even after a long talk with the AI.
 */
export function startHandoffRinging(db: Db, call: CallRef, now = new Date()): Promise<boolean> {
  return step(db, call, { callMode: "ai", handoffState: "requested" }, {
    callMode: "human",
    status: "ringing",
    handoffRequestedAt: now,
    userId: null,
    claimedByUserId: null,
    claimedAt: null,
    browserAnswerClaimToken: null,
    browserAnswerClaimExpiresAt: null,
  }, "ringing", now).catch(() => false)
}

/** The station reserved a parked browser for a handed-off call (inside its own CAS). */
export const HANDOFF_CONNECTED: Prisma.CallLogUpdateManyMutationInput = { handoffState: "connected" }

/**
 * Nobody answered in time: the AI takes the call back. A browser that claimed
 * the call but never became ready loses its claim; one already reserved by
 * the station (status answering) keeps the call.
 */
export function returnHandoffToAi(db: Db, call: CallRef, now = new Date()): Promise<boolean> {
  return step(db, call, { callMode: "human", status: "ringing", handoffState: "ringing" }, {
    callMode: "ai",
    status: "in-progress",
    userId: null,
    claimedByUserId: null,
    claimedAt: null,
    browserAnswerClaimToken: null,
    browserAnswerClaimExpiresAt: null,
  }, "returned", now).catch(() => false)
}
