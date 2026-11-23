/**
 * What the phone agent is told and which tools it is given: the pure half of
 * the agent (no database, no Node-only module), so the VoIP settings page can
 * measure the same text the call will get.
 *
 * Everything here is sent to the model with EVERY turn of a call, and every
 * turn bills the whole context again (measured 2026-11-22: about 0.007 AZN a
 * minute per 1,000 tokens of fixed text). So the booking rules and the tool
 * descriptions are English — the same sentences in Azerbaijani cost about
 * twice the tokens, and the model answers in the caller's language either way —
 * and a service is a two-character code, not its page's id.
 */
import { composeVoiceAgentInstruction } from "@/lib/voice-agent/default-prompt"
import { dateInputValueInTimezone, formatInTimezone } from "@/lib/timezone"
import { inboundCallContext, readInboundAnswerPolicy } from "@/lib/voip/inbound-answer"

/** How many services one call is told about: each is a line of every billed turn. */
export const PHONE_SERVICES_MAX = 12
export const FIND_TOOL = "find_free_times"
export const BOOK_TOOL = "book_appointment"
export const CANCEL_TOOL = "cancel_appointment"
export const BOOKING_TOOL_NAMES = [FIND_TOOL, BOOK_TOOL, CANCEL_TOOL] as const

/** A service as the call knows it: a short code instead of the page's id. */
export type PhoneService = { code: string; pageId: string; title: string; minutes: number; price: string | null; currency: string | null }

/** The station refuses a longer prompt (MAX_PROMPT_CHARS in scripts/pbx/fanum-zeytun-inbound.py). */
export const PHONE_AGENT_PROMPT_MAX_CHARS = 12_000
/** The station hangs up once the agent has said this in full, as on the line. */
export const PHONE_AGENT_CLOSING = "Sağ olun, xoş günlər!"

/** «ИИ записывает на приём по телефону» on the VoIP page. Off unless someone turned it on. */
export function phoneBookingEnabled(settings: unknown): boolean {
  return Boolean(settings) && typeof settings === "object" && !Array.isArray(settings)
    && (settings as Record<string, unknown>).phoneBookingEnabled === true
}

/** The tools as the Live session declares them. English and terse: sent with every turn. */
export function bookingToolDeclarations(services: readonly PhoneService[]) {
  const service = { type: "STRING", enum: services.map((item) => item.code) }
  const date = { type: "STRING", description: "YYYY-MM-DD" }
  return [
    { name: FIND_TOOL,
      description: "Every free start time of one service on one day. free is ranges: 09:00-12:30 with every 30 means 09:00, 09:30 ... 12:30. next: the nearest day with free times when that day has none.",
      parameters: { type: "OBJECT", properties: { service, date }, required: ["service", "date"] } },
    { name: BOOK_TOOL,
      description: "Book once the caller gave service, day, time and name. booked: confirm it; all is every appointment the caller now holds. taken: offer its times. need_phone: ask the caller's number and call again with phone.",
      parameters: { type: "OBJECT", properties: { service, date, time: { type: "STRING", description: "HH:MM, 24-hour" },
        name: { type: "STRING", description: "The caller's name as said." },
        phone: { type: "STRING", description: "Only after need_phone." } }, required: ["service", "date", "time", "name"] } },
    { name: CANCEL_TOOL,
      description: "Cancel the caller's own appointment, only after they asked and said yes to your question. several: ask which one.",
      parameters: { type: "OBJECT", properties: { date, time: { type: "STRING", description: "HH:MM, if the caller named it." } }, required: ["date"] } },
  ]
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const
export const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
export const clockIn = (instant: string | Date, timezone: string) => formatInTimezone(instant, timezone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

/**
 * What the agent is told about booking, appended to the organization's own
 * rules. English: the same sentences in Azerbaijani cost about twice the
 * tokens, and the model answers in the caller's language either way.
 */
export function bookingPromptBlock(input: { services: readonly PhoneService[]; timezone: string; now: Date; closing: string }): string {
  const today = dateInputValueInTimezone(input.now, input.timezone)
  const week = Array.from({ length: 7 }, (_, index) => addDays(today, index + 1)).map((date) => `${weekdayOf(date).slice(0, 3)} ${date.slice(5)}`).join(", ")
  const list = input.services.map((item) =>
    `${item.code}: ${item.title}, ${item.minutes} min${item.price ? `, ${item.price} ${item.currency ?? ""}`.trimEnd() : ""}`).join("; ")
  return [
    "# Appointments",
    `You book appointments yourself, with the tools. Today is ${weekdayOf(today)} ${today}, now ${clockIn(input.now, input.timezone)}. Next days (month-day): ${week}. Work out every date the caller names from this.`,
    `Services (code: name, length, price): ${list}.`,
    "To book you need the service, the day, the time and the caller's name: ask only for what is missing, one question at a time.",
    `When the caller names a day and a time, call ${BOOK_TOOL} at once: it checks the time itself. Call ${FIND_TOOL} only when the caller asks what is free or names no time, and offer at most three of its times.`,
    `Say an appointment is booked or cancelled only after the tool returned that status in this call, and name its day and time once. Never say a time is taken or free from memory or from an older answer: only ${BOOK_TOOL} decides. taken: say that time is taken and offer the times returned, or the day in next when that day has none. unavailable or any other status: say the administrator will call back, never that it is booked.`,
    `When you repeat or sum up appointments, name only those in all of the latest booked answer. One the caller asked for that is not there is NOT booked: book it now or say it is not booked.`,
    // Stand on the real core, 2026-11-23: what the caller hears is the TTS reading the transcript
    // of the model's speech. A time said as digits reached it as "11:00-a" and was voiced
    // "on bir:sıfıra", "on beş sıfır sıfıra". Said in words it stays words ("11-ə" is "on birə").
    "Speak every clock time in Azerbaijani words as people do, never as digits and never with the word sıfır: 09:00 is saat doqquz, 11:00 saat on bir (saat on birə, saat on birdə), 15:00 saat üç, 10:30 on yarım, 16:20 dörd iyirmi. Add səhər, gündüz or axşam only when the hour could be either. HH:MM is for tool arguments only.",
    `To cancel, ask "Qəbulu ləğv edək?" and call ${CANCEL_TOOL} only after a clear yes. To move an appointment, book the new time first, then cancel the old one.`,
    "A service that is not in the list is not booked by phone: take the request for the administrator.",
    `When the caller says goodbye or has nothing more, say exactly this closing sentence and nothing after it: "${input.closing}" The line is hung up after it. Never say it earlier.`,
  ].join("\n")
}


function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/**
 * The rules the agent speaks by: the organization's own prompt and knowledge,
 * the inbound-call paragraph, then the booking block. When the organization's
 * text leaves no room, its knowledge is cut at a line end rather than the call
 * refused: the settings page refuses such a text when it is saved, so this is
 * only for settings older than the switch.
 */
export function composePhoneAgentPrompt(input: { settings: unknown; tail: string }): { prompt: string; knowledgeCut: boolean } {
  const settings = record(input.settings)
  const context = inboundCallContext(readInboundAnswerPolicy(settings))
  const compose = (knowledge: unknown) =>
    `${composeVoiceAgentInstruction({ prompt: settings.voiceAgentPrompt, knowledge })}\n\n${context}\n\n${input.tail}`
  const whole = compose(settings.voiceAgentKnowledge)
  if (whole.length <= PHONE_AGENT_PROMPT_MAX_CHARS) return { prompt: whole, knowledgeCut: false }
  const knowledge = typeof settings.voiceAgentKnowledge === "string" ? settings.voiceAgentKnowledge.trim() : ""
  const room = Math.max(0, knowledge.length - (whole.length - PHONE_AGENT_PROMPT_MAX_CHARS))
  const kept = knowledge.slice(0, room)
  const cut = compose(kept.slice(0, Math.max(kept.lastIndexOf("\n"), 0)).trim())
  // The prompt alone does not fit: the rules that end the call and the tools come first.
  return { prompt: cut.length <= PHONE_AGENT_PROMPT_MAX_CHARS ? cut : cut.slice(cut.length - PHONE_AGENT_PROMPT_MAX_CHARS), knowledgeCut: true }
}

/** How long the organization's own prompt and knowledge may be together with the switch on (the settings route checks it). */
export function phoneAgentTextFits(settings: unknown): boolean {
  // The longest booking block: every service slot taken by the longest title.
  const services: PhoneService[] = Array.from({ length: PHONE_SERVICES_MAX }, (_, index) =>
    ({ code: `s${index + 1}`, pageId: "", title: "x".repeat(80), minutes: 999, price: "9999999.99", currency: "AZN" }))
  const tail = bookingPromptBlock({ services, timezone: "Asia/Baku", now: new Date(0), closing: PHONE_AGENT_CLOSING })
  return !composePhoneAgentPrompt({ settings, tail }).knowledgeCut
}
