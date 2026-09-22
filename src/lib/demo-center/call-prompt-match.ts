import { prisma } from "@/lib/prisma"
import { DEMO_CALL_AUDIT_VIA, isDemoPlacedCall, PROMPT_SERVED_EVENT, PROMPT_SERVED_HASH } from "./call-prompt"

/**
 * Giving a demo call the demo's script while the PBX does not name the call
 * when it asks for the prompt.
 *
 * What the PBX does today, read from the production access log on
 * 2026-09-22: when an AI call connects it sends, within the same second,
 *   GET runtime-config                 (no call id: "the line's prompt")
 *   GET call-source?callId=<id>
 *   GET call-continuation?callId=<id>
 * in no fixed order. The two with the id say which call is connecting, so a
 * runtime-config request in the same burst can be answered for that call.
 *
 * Only a call the demo placed is ever matched (owner decision 2026-09-22:
 * this is for the demo; working tenants keep exactly what they had). Every
 * other call gets the line's prompt, and waits for nothing unless a demo
 * call is in flight at that very moment.
 */

/** A demo call is connecting: written by call-source / call-continuation. */
export const DEMO_CALL_CONNECTING_EVENT = "voice_demo_call_connecting"
const CONNECTING_HASH = "voice_demo_call_connecting:v1"

/** How far apart the requests of one burst can land. */
export const DEMO_BURST_WINDOW_MS = 4_000
/** How long runtime-config waits for the burst's other half when a demo call is in flight. */
export const DEMO_BURST_WAIT_MS = 1_500
/** A demo call still waiting for its prompt after this long is not connecting any more. */
const IN_FLIGHT_MS = 10 * 60_000
const POLL_MS = 100

/**
 * Called by call-source and call-continuation with the call they already
 * looked up. Records the signal only for a call the demo placed, once per
 * call; never throws, because those endpoints answer the agent whatever
 * happens.
 */
export async function noteDemoCallConnecting(
  organizationId: string,
  providerCallId: string,
  call: { id: string; consentAudit?: unknown } | null,
): Promise<void> {
  try {
    if (!call || !isDemoPlacedCall(call.consentAudit)) return
    await prisma.callEvent.createMany({
      data: [{
        organizationId,
        callLogId: call.id,
        provider: "asterisk",
        providerCallId,
        eventType: DEMO_CALL_CONNECTING_EVENT,
        eventHash: CONNECTING_HASH,
        payload: {},
      }],
      skipDuplicates: true,
    })
  } catch (error) {
    console.error("[demo-call] connecting signal not recorded", {
      errorType: error instanceof Error ? error.name : "unknown",
    })
  }
}

export interface ConnectingDemoCall {
  readonly callLogId: string
  readonly providerCallId: string
  readonly leadId: string | null
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * For a runtime-config request that names no call: the demo call whose burst
 * it belongs to, claimed so that no second request can take it, or null for
 * everything else.
 */
export async function claimConnectingDemoCall(
  organizationId: string,
  options: { now?: () => number; wait?: (ms: number) => Promise<unknown> } = {},
): Promise<ConnectingDemoCall | null> {
  const now = options.now ?? (() => Date.now())
  const wait = options.wait ?? sleep
  const started = now()

  // Demo calls placed recently that have not been given a prompt yet.
  const recent = await prisma.callLog.findMany({
    where: {
      organizationId,
      consentAudit: { path: ["via"], equals: DEMO_CALL_AUDIT_VIA },
      createdAt: { gte: new Date(started - IN_FLIGHT_MS) },
      providerCallId: { not: null },
    },
    select: { id: true, providerCallId: true, leadId: true },
  })
  if (!recent.length) return null
  const served = await prisma.callEvent.findMany({
    where: { organizationId, eventType: PROMPT_SERVED_EVENT, callLogId: { in: recent.map((call) => call.id) } },
    select: { callLogId: true },
  })
  const servedIds = new Set(served.map((event) => event.callLogId))
  const pending = recent.filter((call) => !servedIds.has(call.id))
  if (!pending.length) return null

  for (;;) {
    const connecting = await prisma.callEvent.findFirst({
      where: {
        organizationId,
        eventType: DEMO_CALL_CONNECTING_EVENT,
        callLogId: { in: pending.map((call) => call.id) },
        receivedAt: { gte: new Date(now() - DEMO_BURST_WINDOW_MS) },
      },
      orderBy: { receivedAt: "desc" },
      select: { callLogId: true },
    })
    const call = connecting ? pending.find((candidate) => candidate.id === connecting.callLogId) : undefined
    if (call?.providerCallId) {
      // Claim: one prompt-served row per call. A request that loses the race
      // gets the line's prompt, as it would have without this module.
      const claimed = await prisma.callEvent.createMany({
        data: [{
          organizationId,
          callLogId: call.id,
          provider: "asterisk",
          providerCallId: call.providerCallId,
          eventType: PROMPT_SERVED_EVENT,
          eventHash: PROMPT_SERVED_HASH,
          payload: { variant: "demo", matchedBy: "connect-burst" },
        }],
        skipDuplicates: true,
      })
      return claimed.count === 1 ? { callLogId: call.id, providerCallId: call.providerCallId, leadId: call.leadId } : null
    }
    if (now() - started >= DEMO_BURST_WAIT_MS) return null
    await wait(POLL_MS)
  }
}
