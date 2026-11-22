/**
 * The phone agent of an organization without a catalog: its call's session
 * and its tools.
 *
 * Owner, 2026-11-22 («Давай» on the plan). Until now only the pharmacy line's
 * calls got their rules, their voice and their spend from the CRM per call;
 * every other call took the station core's general path — the model's own
 * voice, no tools, no spend record, and for a tenant other than the default
 * one not even its own rules (the core caches one prompt for the station).
 * A call whose channel has «ИИ записывает на приём по телефону» on now takes
 * the same branch of the station as the line (docs/voice-agents-per-number.md,
 * stage 3): the CRM answers the station's `session` with the organization's
 * own rules, the line's TTS voice and the tools this call has, and the station
 * sends every tool call back here as `tool`.
 *
 * Three boundaries:
 *  - a station that cannot run CRM-named tools never gets such a session: it
 *    says what it can do in a header (PHONE_AGENT_CAPS_HEADER), and a request
 *    without it is not looked at at all — the pharmacy line's handler answers
 *    it exactly as before;
 *  - the pharmacy line's own channel is never taken (heldByLine);
 *  - a tool runs for the organization of the CALL, found by the station's call
 *    id; nothing in the model's arguments names a tenant, a page id or a phone
 *    the caller did not ring from.
 *
 * `route` returns null for everything that is not this agent's: the caller
 * then hands the request to the pharmacy line's handler unchanged.
 */
import { timingSafeEqual } from "node:crypto"
import { z } from "zod"

import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { readInboundAnswerPolicy } from "@/lib/voip/inbound-answer"
import { normalizeLineNumber } from "@/lib/voip/line-numbers"

import type { BookingToolContext, ToolResult } from "./booking-tools"
import { PHONE_AGENT_MARKER, phoneAgentMarker, type PhoneAgentMarker } from "./marker"
import { bookingPromptBlock, bookingToolDeclarations, composePhoneAgentPrompt, PHONE_AGENT_CLOSING, phoneBookingEnabled,
  type PhoneService } from "./prompt"

/** What the station says it can do. `tools-1`: it declares the tools a session names and sends their calls back as `tool`. */
export const PHONE_AGENT_CAPS_HEADER = "x-voice-agent-caps"
export const PHONE_AGENT_CAPABILITY = "tools-1"
export const PHONE_AGENT_VARIANT = "agent_tools"
/** A booking call is short; every minute makes all its minutes dearer (the whole context is billed per turn). */
export const PHONE_AGENT_MAX_SECONDS = 600
/**
 * The voice the owner chose for the line (2026-10-23 «эту ставь», 2026-10-30
 * manner «C»), with the line's words for its trade taken out. The station
 * re-voices the model's answers with it; the model's own voice is never heard.
 */
export const PHONE_AGENT_SPEECH = { engine: "tts", model: "gemini-3.8-flash-tts", voice: "Sulafat",
  style: "always Azerbaijani as spoken in Baku: every word, number and name read the Azerbaijani way, never English; relaxed, friendly phone conversation; warm and smiling, natural unhurried pace with small natural pauses; a real front-desk administrator talking to a caller, not a narrator reading a script" } as const

const BODY_MAX_BYTES = 16 * 1024

export type PhoneAgentCall = {
  id: string
  organizationId: string
  channelConfigId: string
  providerCallId: string
  direction: string
  callMode: string
  status: string
  wasAnswered: boolean
  endedAt: string | null
  fromNumber: string | null
  /** call_logs.consentAudit.phoneAgent, as stored. */
  marker: unknown
  /** The call's VoIP channel settings; null when the channel is gone or switched off. */
  settings: unknown
}

export type PhoneAgentBooking = { services: PhoneService[]; timezone: string }

export type PhoneAgentDependencies = {
  clock?: () => number
  /** The call by its station id with its channel's settings. Null unless exactly one active organization has it. */
  loadCall(callId: string): Promise<PhoneAgentCall | null>
  /** Whether the pharmacy line holds this call's channel: its own handler answers then. Unreadable counts as held. */
  heldByLine(call: PhoneAgentCall): Promise<boolean>
  /** What the organization can book by phone; null when «Встречи» is off or nothing is bookable. */
  loadBooking(organizationId: string): Promise<PhoneAgentBooking | null>
  /** Writes the call's record (its services by code) while the call is live; false when it could not. */
  mark(call: PhoneAgentCall, marker: PhoneAgentMarker): Promise<boolean>
  /** One tool call inside the organization's tenant scope. */
  runTool(context: BookingToolContext, name: string, args: unknown): Promise<ToolResult>
}

const sessionSchema = z.strictObject({ action: z.literal("session"), callId: z.uuid() })
const toolSchema = z.strictObject({
  action: z.literal("tool"), callId: z.uuid(), name: z.string().regex(/^[a-z][a-z0-9_]{2,39}$/u),
  args: z.record(z.string(), z.unknown()).optional(), id: z.string().min(1).max(128).optional(),
})

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers })

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Without booking the agent still needs to end the call: the station hangs up on this sentence. */
const closingRule = `When the caller says goodbye or has nothing more, say exactly this closing sentence and nothing after it: "${PHONE_AGENT_CLOSING}" The line is hung up after it. Never say it earlier.`

export function createPhoneAgentHandler(runtimeToken: string, dependencies: PhoneAgentDependencies) {
  const clock = dependencies.clock ?? Date.now
  const token = Buffer.from(runtimeToken)
  let windowStart = clock(), inFlight = 0
  const perCall = new Map<string, number>()

  /** Null for a call this agent does not serve: it is then answered as it was before this agent existed. */
  async function session(call: PhoneAgentCall): Promise<Response | null> {
    if (call.direction !== "inbound" || call.callMode !== "ai" || call.endedAt !== null) return null
    const policy = readInboundAnswerPolicy(call.settings)
    if (policy.mode === "human") return null
    // The station's own media handler reports "answered" and asks once more, as on the line.
    if (call.status === "answering" && !call.wasAnswered) return json({ enabled: false, status: "awaiting_answered" })
    if (call.status !== "in-progress" || !call.wasAnswered) return null
    const booking = await dependencies.loadBooking(call.organizationId).catch(() => null)
    const now = new Date(clock())
    const services = booking?.services ?? []
    const marker: PhoneAgentMarker = { version: 1, providerCallId: call.providerCallId,
      services: services.map(({ code, pageId }) => ({ code, pageId })) }
    // The record is what later lets a tool run and the call's spend be written:
    // without it the call still gets its own rules and voice, with no tools.
    const marked = await dependencies.mark(call, marker).catch(() => false)
    const offered = marked && booking ? services : []
    const tail = offered.length
      ? bookingPromptBlock({ services: offered, timezone: booking!.timezone, now, closing: PHONE_AGENT_CLOSING })
      : closingRule
    const { prompt, knowledgeCut } = composePhoneAgentPrompt({ settings: call.settings, tail })
    console.log("[phone-agent] session", JSON.stringify({ call: call.providerCallId, services: offered.length, marked,
      promptChars: prompt.length, knowledgeCut }))
    return json({
      enabled: true, variant: PHONE_AGENT_VARIANT, prompt, opening: policy.greeting, closing: PHONE_AGENT_CLOSING,
      voice: null, pinSpeechLanguage: true, speech: PHONE_AGENT_SPEECH, maxSeconds: PHONE_AGENT_MAX_SECONDS,
      // Service names help the recognizer hear them; the station takes short words only.
      vocabulary: offered.map((item) => item.title).filter((title) => title.length <= 40),
      tools: offered.length ? bookingToolDeclarations(offered) : [],
    })
  }

  async function tool(call: PhoneAgentCall | null, input: z.infer<typeof toolSchema>): Promise<Response> {
    const refused = () => json({ error: "not_authorized" }, 403)
    if (!call || !phoneBookingEnabled(call.settings)) return refused()
    if (call.direction !== "inbound" || call.callMode !== "ai" || call.status !== "in-progress" || !call.wasAnswered || call.endedAt !== null) return refused()
    const marker = phoneAgentMarker({ [PHONE_AGENT_MARKER]: call.marker }, input.callId)
    if (!marker || await dependencies.heldByLine(call)) return refused()
    const result = await dependencies.runTool({
      organizationId: call.organizationId, callLogId: call.id, callerNumber: normalizeLineNumber(call.fromNumber),
      services: marker.services, now: new Date(clock()),
    }, input.name, input.args ?? {})
    // The tool and its status, never its arguments: they carry a name and a phone.
    console.log("[phone-agent] tool", JSON.stringify({ call: call.providerCallId, tool: input.name, status: result.status ?? "ok" }))
    return json({ result })
  }

  /** The agent's answer, or null when the request is not its own. */
  return async function route(request: Request): Promise<Response | null> {
    // A station that does not name the capability is the one installed before
    // this existed: nothing of its request is read here.
    const caps = (request.headers.get(PHONE_AGENT_CAPS_HEADER) ?? "").split(",").map((value) => value.trim())
    if (!caps.includes(PHONE_AGENT_CAPABILITY)) return null
    const auth = Buffer.from(request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9._~-]{32,1024})$/i)?.[1] ?? "")
    if (token.length < 32 || token.length > 1024 || auth.length !== token.length || !timingSafeEqual(auth, token)) return null
    if (request.method !== "POST" || !/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return null
    const body = await readJsonRequestWithinLimit(request, BODY_MAX_BYTES)
    if (!body.ok) return null
    const action = record(body.value).action
    if (action !== "session" && action !== "tool") return null
    if (clock() - windowStart >= 60_000) { windowStart = clock(); perCall.clear() }
    if (inFlight >= 16) return action === "tool" ? json({ error: "rate_limited" }, 429) : null
    inFlight++
    try {
      if (action === "session") {
        const input = sessionSchema.safeParse(body.value)
        if (!input.success) return null
        const call = await dependencies.loadCall(input.data.callId)
        // Not this agent's call: no switch on its channel, or the pharmacy line's own channel.
        if (!call || !phoneBookingEnabled(call.settings) || await dependencies.heldByLine(call)) return null
        return await session(call)
      }
      const input = toolSchema.safeParse(body.value)
      if (!input.success) return json({ error: "invalid_request" }, 400)
      const used = perCall.get(input.data.callId) ?? 0
      if (used >= 60) return json({ error: "rate_limited" }, 429)
      perCall.set(input.data.callId, used + 1)
      return await tool(await dependencies.loadCall(input.data.callId), input.data)
    } catch (error) {
      console.error("[phone-agent] failed", action, error instanceof Error ? error.name : "error")
      // A session that could not be decided is left to the handler that answered before this existed.
      return action === "tool" ? json({ error: "unavailable" }, 503) : null
    } finally {
      inFlight--
    }
  }
}
