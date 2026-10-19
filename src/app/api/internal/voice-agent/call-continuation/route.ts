import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { noteDemoCallConnecting } from "@/lib/demo-center/call-prompt-match"
import {
  buildDemoCallContext,
  buildDemoCallPrompt,
  DEMO_CALL_CLOSING_KEY,
  DEMO_CALL_CLOSING_KEYS,
  demoCallFirstName,
  demoCallOpening,
  DEMO_CALL_MAX_SECONDS,
  isDemoPlacedCall,
} from "@/lib/demo-center/call-prompt"
import { CALLBACK_FRESHNESS_MS } from "@/lib/voice-agent/callback-decision"
import { inboundCallContext } from "@/lib/voip/inbound-answer"
import { loadInboundAnswerPolicy } from "@/lib/voip/inbound-answer-config"

export const dynamic = "force-dynamic"

/**
 * What the agent should already know when the call connects.
 *
 * Two independent things, each with its own fences:
 *   - `continuation`: the tail of a conversation a *callback* is continuing.
 *   - `conversation`: the recent written correspondence with this lead, so the
 *     agent stops opening with "your number was in our system" when the
 *     customer has been writing to the company for a week.
 *
 * Deliberately absent: the lead's name. Auto-created leads carry whatever the
 * channel supplied - often a handle or the word "lead" - and an agent
 * confidently mispronouncing a wrong name is worse than one that never uses it.
 * Also absent: phone, ids, deal values. The agent needs the thread, not the file.
 *
 * This deliberately crosses the boundary the sibling call-source endpoint
 * holds: it returns free text the customer actually said. That boundary exists
 * so a stolen runtime token yields nothing about anybody, and the token
 * otherwise only lets the PBX *write* the transcript of the call it is on.
 * Reading past conversations is a strictly larger power, so it is fenced in
 * four ways, each of which alone makes a stolen token useless here:
 *
 *   1. Only a call that is itself a callback has anything to return. An
 *      ordinary call id yields null no matter who asks.
 *   2. Only within the same freshness window that allowed the callback at all.
 *   3. Only the tail of the transcript, capped in lines and characters.
 *   4. Only around the first collection. A retried request inside the grace
 *      period still works — otherwise a dropped response would make the agent
 *      restart the conversation, which is the failure this feature exists to
 *      prevent — but the window then closes for good.
 *
 * The practical effect is that an attacker would have to hold the token, know
 * an unguessable call id, and arrive inside the same couple of minutes as a
 * callback that is already in flight.
 *
 * An inbound call the AI picked up also gets `opening` (the organisation's
 * inbound greeting, spoken word for word instead of the outbound "I am calling
 * you") and `context` (the incoming-call scope and organisation's inbound rules).
 * Both are settings text, not customer data, so they add nothing to what a
 * stolen token can read.
 *
 * A call the demo placed gets them too (2026-10-18): the approved LeadDrive
 * first sentence as `opening`, the demo's framing as `context` and the
 * two-minute ceiling as `maxSeconds`. The station speaks `opening` word for
 * word and appends `context` to that call only — read per call, with no
 * cache — so this is the one place that reliably reaches a demo call today.
 * Since 2026-10-19 it also says what kind of call this is, `variant: "demo"`,
 * and hands over the demo's whole script as `prompt`: the station's core from
 * voice-core-demo-max-seconds.patch then drops the line's own sales rules
 * (construction, measurements) for this call and ends it at `maxSeconds`, or
 * as soon as the agent's own closing has played (`closingKeys`, one per
 * language the script allows; `closingKey` is the first, for a core that read
 * only one). The core before that patch reads none of these fields. A core
 * that does says so on its call-less prompt request (`caps=demo-v1`), and
 * runtime-config then never guesses a demo call from the connect burst: the
 * script reaches the call only here, by its own id.
 * Without it the agent greeted the prospect with the line's own greeting,
 * another business's. The prospect's first name is the only thing about them
 * in it, reduced to letters, as in the demo's call prompt.
 */

/** How many trailing transcript lines the agent needs to pick the thread back up. */
const CONTINUATION_LINES = 6
const CONTINUATION_CHARS = 1_500
/** Written correspondence: enough to know the subject, not the whole history. */
const CONVERSATION_MESSAGES = 10
const CONVERSATION_CHARS = 1_800
const CONVERSATION_MESSAGE_CHARS = 300
/** Older than this and it is history, not context for the call being placed. */
const CONVERSATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
/** Retry grace after the first collection. */
const CONTINUATION_GRACE_MS = 2 * 60 * 1000
// The deployed PBX reads at most 8,192 bytes before parsing this JSON.
// Keep headroom and sacrifice only oldest written correspondence, never the
// current greeting/rules. Outbound and callback responses are unchanged.
const INBOUND_RESPONSE_BYTES = 8_000

function authorized(request: NextRequest): boolean {
  const expected = process.env.FANUM_VOICE_RUNTIME_TOKEN
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || ""
  if (!expected || !received) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(received)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function trimTranscriptTail(transcript: string): string {
  const lines = transcript
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const tail = lines.slice(-CONTINUATION_LINES).join("\n")
  return tail.length > CONTINUATION_CHARS
    // Keep the end rather than the start: the thread is picked up from the last
    // thing said, not the first.
    ? tail.slice(tail.length - CONTINUATION_CHARS)
    : tail
}

/** Recent written correspondence with the lead, oldest first, capped. */
export async function leadConversation(params: {
  organizationId: string
  leadId: string
  now: Date
}): Promise<string | null> {
  const messages = await prisma.channelMessage.findMany({
    where: {
      organizationId: params.organizationId,
      leadId: params.leadId,
      createdAt: { gte: new Date(params.now.getTime() - CONVERSATION_MAX_AGE_MS) },
    },
    orderBy: { createdAt: "desc" },
    take: CONVERSATION_MESSAGES,
    select: { direction: true, body: true },
  })
  if (messages.length === 0) return null
  const lines: string[] = []
  let budget = CONVERSATION_CHARS
  // Walk newest-first so the cap sacrifices the OLDEST messages, then flip:
  // the agent needs what was said last, and reading order must be natural.
  for (const message of messages) {
    const body = message.body.replace(/\s+/g, " ").trim()
    if (!body) continue
    const speaker = message.direction === "inbound" ? "Müştəri" : "Biz"
    const line = `${speaker}: ${body.slice(0, CONVERSATION_MESSAGE_CHARS)}`
    if (line.length > budget) break
    budget -= line.length
    lines.push(line)
  }
  lines.reverse()
  return lines.length > 0 ? lines.join("\n") : null
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const organizationId = process.env.VOICE_AGENT_ORGANIZATION_ID
  if (!organizationId) {
    return NextResponse.json({ error: "Voice agent is not configured" }, { status: 503 })
  }

  const callId = request.nextUrl.searchParams.get("callId")?.trim()
  if (!callId || !/^[0-9a-fA-F-]{36}$/.test(callId)) {
    return NextResponse.json({ error: "callId is required" }, { status: 400 })
  }

  const now = new Date()
  const context = await runWithTenant(organizationId, async () => {
    const call = await prisma.callLog.findFirst({
      where: { organizationId, providerCallId: callId },
      select: {
        id: true,
        continuesCallId: true,
        continuationServedAt: true,
        leadId: true,
        callMode: true,
        direction: true,
        consentAudit: true,
      },
    })
    // Part of the PBX's connect burst: lets runtime-config give a demo call
    // the demo's script on a core that does not read it per call
    // (src/lib/demo-center/call-prompt-match.ts).
    await noteDemoCallConnecting(organizationId, callId, call)
    if (!call) return { continuation: null, conversation: null }
    if (call.callMode === "ai" && call.direction !== "inbound" && isDemoPlacedCall(call.consentAudit)) {
      const lead = call.leadId
        ? await prisma.lead.findFirst({ where: { id: call.leadId, organizationId }, select: { contactName: true } })
        : null
      const firstName = demoCallFirstName(lead?.contactName)
      return {
        continuation: null,
        conversation: null,
        opening: demoCallOpening(firstName),
        context: buildDemoCallContext(),
        maxSeconds: DEMO_CALL_MAX_SECONDS,
        variant: "demo" as const,
        prompt: buildDemoCallPrompt({ firstName }),
        closingKey: DEMO_CALL_CLOSING_KEY,
        closingKeys: DEMO_CALL_CLOSING_KEYS,
      }
    }
    const inboundAi = call.callMode === "ai" && call.direction === "inbound" && !call.continuesCallId
    const inboundPolicy = inboundAi
      ? await loadInboundAnswerPolicy(organizationId)
      : null
    // The written thread is available on every AI call, not only callbacks:
    // opening with "your number was in our system" to somebody who has been
    // writing to the company all week is the complaint this answers.
    const conversation = call.callMode === "ai" && call.leadId
      ? await leadConversation({ organizationId, leadId: call.leadId, now })
      : null
    const continuation = await continuationFor(call, organizationId, now)
    if (!inboundPolicy) return { continuation, conversation }
    const inboundContext = {
      continuation,
      conversation,
      opening: inboundPolicy.greeting,
      context: inboundCallContext(inboundPolicy),
    }
    while (inboundContext.conversation && Buffer.byteLength(JSON.stringify(inboundContext), "utf8") > INBOUND_RESPONSE_BYTES) {
      const lines = inboundContext.conversation.split("\n")
      lines.shift()
      inboundContext.conversation = lines.join("\n") || null
    }
    return inboundContext
  })

  return NextResponse.json(
    context,
    { headers: { "Cache-Control": "no-store" } },
  )
}

async function continuationFor(
  call: {
    id: string
    continuesCallId: string | null
    continuationServedAt: Date | null
  },
  organizationId: string,
  now: Date,
): Promise<string | null> {
  {
    // Fence 1: nothing to continue unless this call was created as a callback.
    if (!call?.continuesCallId) return null
    // Fence 4: outside the grace period around the first collection.
    if (
      call.continuationServedAt
      && now.getTime() - call.continuationServedAt.getTime() > CONTINUATION_GRACE_MS
    ) {
      return null
    }

    const original = await prisma.callLog.findFirst({
      where: { id: call.continuesCallId, organizationId },
      select: { transcription: true, endedAt: true },
    })
    if (!original?.transcription || !original.endedAt) return null
    // Fence 2: the same window that authorised the callback in the first place.
    if (now.getTime() - original.endedAt.getTime() > CALLBACK_FRESHNESS_MS + CONTINUATION_GRACE_MS) {
      return null
    }

    if (!call.continuationServedAt) {
      // Stamped on first collection only, so the grace period is measured from
      // the PBX's first attempt rather than being extended by every retry.
      await prisma.callLog.updateMany({
        where: { id: call.id, organizationId, continuationServedAt: null },
        data: { continuationServedAt: now },
      })
    }
    // Fence 3.
    return trimTranscriptTail(original.transcription) || null
  }
}
