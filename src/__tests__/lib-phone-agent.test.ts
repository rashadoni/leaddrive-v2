/**
 * The phone agent's decisions (src/lib/voice-agent/phone-agent/handler.ts), with
 * its database replaced by plain objects: whose call it takes, what the station
 * is told, what a tool is run with. The same handler against a real Postgres,
 * with real bookings, is phone-agent-booking-postgres.test.ts.
 *
 * The station side is not mocked where it decides anything: the session the CRM
 * composes is handed to the station bridge's own `open()` (Python), because a
 * session the station refuses is a call that never starts.
 */
import { execFileSync } from "node:child_process"
import { describe, expect, it, vi } from "vitest"

import { createPhoneAgentHandler, PHONE_AGENT_CAPABILITY, PHONE_AGENT_CAPS_HEADER, type PhoneAgentCall,
  type PhoneAgentDependencies } from "@/lib/voice-agent/phone-agent/handler"
import { PHONE_AGENT_MARKER } from "@/lib/voice-agent/phone-agent/marker"
import { bookingPromptBlock, bookingToolDeclarations, composePhoneAgentPrompt, PHONE_AGENT_CLOSING, PHONE_AGENT_PROMPT_MAX_CHARS,
  PHONE_SERVICES_MAX, phoneAgentTextFits, type PhoneService } from "@/lib/voice-agent/phone-agent/prompt"

const TOKEN = "t".repeat(48)
const CALL_ID = "aaaaaaaa-1111-4111-8111-111111111111"
const NOW = Date.parse("2026-11-22T10:00:00Z") // a Sunday, 14:00 in Baku

const SETTINGS = { provider: "asterisk", voiceAgentEnabled: true, inboundAnswerMode: "ai", phoneBookingEnabled: true,
  voiceAgentPrompt: "Sən klinikanın qeydiyyat operatorusan.", voiceAgentKnowledge: "Stomatoloq hər gün qəbul edir.",
  voiceAgentInboundGreeting: "Klinikanın qeydiyyatı, salam! Buyurun." }
const SERVICES: PhoneService[] = [
  { code: "s1", pageId: "page-dentist", title: "Stomatoloq müayinəsi", minutes: 30, price: "30", currency: "AZN" },
  { code: "s2", pageId: "page-cardio", title: "Kardioloq", minutes: 40, price: null, currency: null },
]

function liveCall(extra: Partial<PhoneAgentCall> = {}): PhoneAgentCall {
  return { id: "call-row", organizationId: "org-clinic", channelConfigId: "cfg-clinic", providerCallId: CALL_ID, direction: "inbound",
    callMode: "ai", status: "in-progress", wasAnswered: true, endedAt: null, fromNumber: "994501112233", marker: undefined,
    settings: SETTINGS, ...extra }
}

function fixture(call: PhoneAgentCall | null = liveCall()) {
  const dependencies = {
    clock: () => NOW,
    loadCall: vi.fn(async () => call),
    heldByLine: vi.fn(async () => false),
    loadBooking: vi.fn(async () => ({ services: SERVICES, timezone: "Asia/Baku" })),
    mark: vi.fn(async () => true),
    runTool: vi.fn(async () => ({ status: "booked", date: "2026-11-23", weekday: "Monday", time: "11:00" })),
  } satisfies PhoneAgentDependencies
  return { dependencies, route: createPhoneAgentHandler(TOKEN, dependencies) }
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://app.leaddrivecrm.org/api/internal/voice-agent/pharmacy-inbound", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", [PHONE_AGENT_CAPS_HEADER]: PHONE_AGENT_CAPABILITY, ...headers },
    body: JSON.stringify(body),
  })
}
const session = { action: "session", callId: CALL_ID }
const marked = (services = SERVICES) => ({ version: 1, providerCallId: CALL_ID, services: services.map(({ code, pageId }) => ({ code, pageId })) })

/** What the station bridge makes of a CRM session: its own open(), tools() and transcription(). */
function stationOpens(answer: unknown): { ok: boolean; tools: string[]; behaviours: string[]; prompt?: string } {
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("bridge", "scripts/pbx/fanum-zeytun-inbound.py")
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
answer = json.load(sys.stdin)
bridge = module.ZeytunInboundBridge("https://app.leaddrivecrm.org/api/internal/voice-agent/runtime-config", "t" * 48,
    "${CALL_ID}", lambda body: answer, lambda: 100)
try:
    pilot = bridge.open()
    declared = [d for group in bridge.tools() for d in group["functionDeclarations"]]
    print(json.dumps({"ok": True, "tools": [d["name"] for d in declared], "behaviours": sorted({d["behavior"] for d in declared}), "prompt": pilot["prompt"]}))
except module.ZeytunPilotUnavailable:
    print(json.dumps({"ok": False, "tools": [], "behaviours": []}))
`
  return JSON.parse(execFileSync("python3", ["-I", "-c", script], { input: JSON.stringify(answer), encoding: "utf8" }))
}

describe("whose call the phone agent takes", () => {
  it("does not read a request from a station that cannot run its tools", async () => {
    const f = fixture()
    for (const headers of [{ [PHONE_AGENT_CAPS_HEADER]: "" }, { [PHONE_AGENT_CAPS_HEADER]: "tools-0" }]) {
      expect(await f.route(request(session, headers))).toBeNull()
    }
    expect(f.dependencies.loadCall).not.toHaveBeenCalled()
  })

  it("leaves everything it is not asked for to the line's handler: a wrong token, another action, a broken body", async () => {
    const f = fixture()
    expect(await f.route(request(session, { authorization: `Bearer ${"x".repeat(48)}` }))).toBeNull()
    expect(await f.route(request({ action: "search", callId: CALL_ID, query: { text: "Adefa" } }))).toBeNull()
    expect(await f.route(request({ action: "order", callId: CALL_ID, lines: [] }))).toBeNull()
    expect(await f.route(request({ action: "session", callId: "not-a-uuid" }))).toBeNull()
    expect(await f.route(request({ action: "session", callId: CALL_ID, extra: 1 }))).toBeNull()
    expect(f.dependencies.loadCall).not.toHaveBeenCalled()
    expect(f.dependencies.mark).not.toHaveBeenCalled()
  })

  it("hands a long phrase of the line on at once, whole, even when the request does not say its length", async () => {
    const f = fixture()
    const text = JSON.stringify({ action: "utterance", callId: CALL_ID, seq: 1, audio: "A".repeat(320_000) })
    const bytes = new TextEncoder().encode(text)
    const original = new Request("https://app.leaddrivecrm.org/api/internal/voice-agent/pharmacy-inbound", {
      method: "POST", duplex: "half",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", [PHONE_AGENT_CAPS_HEADER]: PHONE_AGENT_CAPABILITY },
      body: new ReadableStream({ start(controller) {
        for (let at = 0; at < bytes.length; at += 8192) controller.enqueue(bytes.subarray(at, at + 8192))
        controller.close()
      } }),
    } as RequestInit)
    // The route gives the agent a copy and the line's handler the request itself.
    const answer = await Promise.race([f.route(original.clone()), new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 1_000))])
    expect(answer).toBeNull()
    expect(f.dependencies.loadCall).not.toHaveBeenCalled()
    expect(await original.text()).toBe(text)
  })

  it("leaves a call to the handler that answered before when its channel has no switch, or is the pharmacy line's own", async () => {
    const off = fixture(liveCall({ settings: { ...SETTINGS, phoneBookingEnabled: false } }))
    expect(await off.route(request(session))).toBeNull()
    const unknown = fixture(null)
    expect(await unknown.route(request(session))).toBeNull()
    const line = fixture()
    line.dependencies.heldByLine.mockResolvedValue(true)
    expect(await line.route(request(session))).toBeNull()
    for (const f of [off, unknown, line]) expect(f.dependencies.mark).not.toHaveBeenCalled()
  })

  it("serves only a live inbound call the AI itself answers", async () => {
    for (const extra of [{ direction: "outbound" }, { callMode: "human" }, { endedAt: "2026-11-22T10:00:00.000Z" }, { status: "completed" },
      { status: "ringing", wasAnswered: false }, { settings: { ...SETTINGS, inboundAnswerMode: "human" } },
      { settings: { ...SETTINGS, voiceAgentEnabled: false } }] as Partial<PhoneAgentCall>[]) {
      const f = fixture(liveCall(extra))
      expect(await f.route(request(session)), JSON.stringify(extra)).toBeNull()
      expect(f.dependencies.mark).not.toHaveBeenCalled()
    }
    // The station's media handler has the call but its "answered" has not arrived: it reports it and asks again.
    const waiting = fixture(liveCall({ status: "answering", wasAnswered: false }))
    const answer = await waiting.route(request(session))
    expect(await answer!.json()).toEqual({ enabled: false, status: "awaiting_answered" })
    expect(waiting.dependencies.mark).not.toHaveBeenCalled()
  })
})

describe("the session the station is given", () => {
  it("carries the organization's own rules, the line's voice and the tools of its services", async () => {
    const f = fixture()
    const answer = await (await f.route(request(session)))!.json()
    expect(answer).toMatchObject({ enabled: true, variant: "agent_tools", opening: "Klinikanın qeydiyyatı, salam! Buyurun.",
      closing: PHONE_AGENT_CLOSING, pinSpeechLanguage: true, voice: null, maxSeconds: 600,
      speech: { engine: "tts", model: "gemini-3.8-flash-tts", voice: "Sulafat" }, vocabulary: ["Stomatoloq müayinəsi", "Kardioloq"] })
    expect(answer.tools.map((tool: { name: string }) => tool.name)).toEqual(["find_free_times", "book_appointment", "cancel_appointment"])
    expect(answer.tools[1].parameters.properties.service.enum).toEqual(["s1", "s2"])
    // The model is told the services by code and what day it is; no page id leaves the CRM.
    expect(answer.prompt).toContain("Sən klinikanın qeydiyyat operatorusan.")
    expect(answer.prompt).toContain("Stomatoloq hər gün qəbul edir.")
    expect(answer.prompt).toContain("s1: Stomatoloq müayinəsi, 30 min, 30 AZN; s2: Kardioloq, 40 min.")
    expect(answer.prompt).toContain("Today is Sunday 2026-11-22, now 14:00.")
    expect(answer.prompt).toContain("Mon 11-23, Tue 11-24, Wed 11-25, Thu 11-26")
    // The caller hears the transcript of the model's speech: "11:00-a" was voiced "on bir:sıfıra".
    expect(answer.prompt).toContain("never as digits and never with the word sıfır")
    expect(answer.prompt).toContain("15:00 saat üç")
    expect(JSON.stringify(answer)).not.toContain("page-dentist")
    // The call's own record: what a tool is later run with.
    expect(f.dependencies.mark).toHaveBeenCalledWith(expect.objectContaining({ id: "call-row" }), marked())
  })

  it("is one the station accepts, with every tool waiting for its answer", async () => {
    const f = fixture()
    const answer = await (await f.route(request(session)))!.json()
    const station = stationOpens(answer)
    expect(station).toMatchObject({ ok: true, tools: ["find_free_times", "book_appointment", "cancel_appointment"], behaviours: ["BLOCKING"] })
    expect(station.prompt).toBe(answer.prompt)
  })

  it("stays one the station accepts with every service slot taken by the longest name", () => {
    const services: PhoneService[] = Array.from({ length: PHONE_SERVICES_MAX }, (_, index) =>
      ({ code: `s${index + 1}`, pageId: `page-${index}`, title: "Ə".repeat(80), minutes: 240, price: "1234567.89", currency: "AZN" }))
    const tail = bookingPromptBlock({ services, timezone: "Asia/Baku", now: new Date(NOW), closing: PHONE_AGENT_CLOSING })
    const { prompt } = composePhoneAgentPrompt({ settings: SETTINGS, tail })
    const station = stationOpens({ enabled: true, variant: "agent_tools", prompt, opening: "Salam", closing: PHONE_AGENT_CLOSING,
      maxSeconds: 600, tools: bookingToolDeclarations(services) })
    expect(station.ok).toBe(true)
    expect(station.tools).toHaveLength(3)
  })

  it("gives a call with nothing to book its rules and voice, and no tool", async () => {
    const f = fixture()
    f.dependencies.loadBooking.mockResolvedValue(null as never)
    const answer = await (await f.route(request(session)))!.json()
    expect(answer).toMatchObject({ enabled: true, variant: "agent_tools", tools: [], vocabulary: [] })
    expect(answer.prompt).not.toContain("# Appointments")
    expect(answer.prompt).toContain(PHONE_AGENT_CLOSING)
    expect(stationOpens(answer)).toMatchObject({ ok: true, tools: [] })
  })

  it("offers no tool when the call's record could not be written: a tool would have nothing to run by", async () => {
    const f = fixture()
    f.dependencies.mark.mockResolvedValue(false)
    const answer = await (await f.route(request(session)))!.json()
    expect(answer.tools).toEqual([])
    expect(answer.prompt).not.toContain("book_appointment")
  })

  it("leaves a session it cannot decide to the handler that answered before", async () => {
    const f = fixture()
    f.dependencies.loadCall.mockRejectedValue(new Error("database is away"))
    expect(await f.route(request(session))).toBeNull()
  })
})

describe("a tool call", () => {
  const book = { action: "tool", callId: CALL_ID, name: "book_appointment", id: "fc-1",
    args: { service: "s1", date: "2026-11-23", time: "11:00", name: "Elvin Məmmədov" } }

  it("runs for the organization and the number of the call, with the services its record holds", async () => {
    const f = fixture(liveCall({ marker: marked() }))
    const answer = await f.route(request(book))
    expect(await answer!.json()).toEqual({ result: { status: "booked", date: "2026-11-23", weekday: "Monday", time: "11:00" } })
    expect(f.dependencies.runTool).toHaveBeenCalledWith({ organizationId: "org-clinic", callLogId: "call-row", callerNumber: "+994501112233",
      services: marked().services, now: new Date(NOW) }, "book_appointment", book.args)
  })

  it("takes nothing about the tenant, the page or the caller from the model's arguments", async () => {
    const f = fixture(liveCall({ marker: marked() }))
    await f.route(request({ ...book, args: { ...book.args, organizationId: "org-other", pageId: "page-of-another", phone: "+994550000000" } }))
    const [context] = f.dependencies.runTool.mock.calls[0] as unknown as [{ organizationId: string; callerNumber: string; services: unknown }]
    expect(context.organizationId).toBe("org-clinic")
    expect(context.callerNumber).toBe("+994501112233")
    expect(context.services).toEqual(marked().services)
  })

  it("is refused for a call without the agent's record, a call that is over, or one whose switch went off", async () => {
    const cases: PhoneAgentCall[] = [
      liveCall(), // no record: the session was never given
      liveCall({ marker: { ...marked(), providerCallId: "bbbbbbbb-2222-4222-8222-222222222222" } }), // another call's record
      liveCall({ marker: marked(), status: "completed", endedAt: "2026-11-22T10:05:00.000Z" }),
      liveCall({ marker: marked(), callMode: "human" }),
      liveCall({ marker: marked(), settings: { ...SETTINGS, phoneBookingEnabled: false } }),
    ]
    for (const call of cases) {
      const f = fixture(call)
      expect((await f.route(request(book)))!.status).toBe(403)
      expect(f.dependencies.runTool).not.toHaveBeenCalled()
    }
    const unknown = fixture(null)
    expect((await unknown.route(request(book)))!.status).toBe(403)
    const line = fixture(liveCall({ marker: marked() }))
    line.dependencies.heldByLine.mockResolvedValue(true)
    expect((await line.route(request(book)))!.status).toBe(403)
    expect(line.dependencies.runTool).not.toHaveBeenCalled()
  })

  it("answers a malformed call and a failing tool without inventing a result", async () => {
    const f = fixture(liveCall({ marker: marked() }))
    expect((await f.route(request({ ...book, name: "Book-Appointment" })))!.status).toBe(400)
    f.dependencies.runTool.mockRejectedValue(new Error("database is away"))
    const failed = await f.route(request(book))
    expect(failed!.status).toBe(503)
    expect(await failed!.json()).toEqual({ error: "unavailable" })
  })

  it("stops a call that asks more than a conversation can", async () => {
    const f = fixture(liveCall({ marker: marked() }))
    for (let index = 0; index < 60; index += 1) expect((await f.route(request({ ...book, id: `fc-${index}` })))!.status).toBe(200)
    expect((await f.route(request({ ...book, id: "fc-61" })))!.status).toBe(429)
  })
})

describe("the organization's text and the station's limit", () => {
  it("keeps the booking rules and the closing when the knowledge is too long, cutting the knowledge at a line", () => {
    const knowledge = Array.from({ length: 400 }, (_, index) => `Fakt ${index}: klinika haqqında məlumat sətri.`).join("\n")
    const tail = bookingPromptBlock({ services: SERVICES, timezone: "Asia/Baku", now: new Date(NOW), closing: PHONE_AGENT_CLOSING })
    const { prompt, knowledgeCut } = composePhoneAgentPrompt({ settings: { ...SETTINGS, voiceAgentKnowledge: knowledge }, tail })
    expect(knowledgeCut).toBe(true)
    expect(prompt.length).toBeLessThanOrEqual(PHONE_AGENT_PROMPT_MAX_CHARS)
    expect(prompt.endsWith(tail)).toBe(true)
    expect(prompt).toContain("Fakt 0:")
    expect(prompt).not.toContain("Fakt 399:")
    // No half line: the last fact kept is whole.
    expect(prompt).toMatch(/Fakt \d+: klinika haqqında məlumat sətri\.\n\nBu zəngi müştəri özü edib/u)
  })

  it("tells the settings page the same thing the call would do", () => {
    expect(phoneAgentTextFits(SETTINGS)).toBe(true)
    expect(phoneAgentTextFits({ ...SETTINGS, voiceAgentKnowledge: "x".repeat(8_000) })).toBe(true)
    expect(phoneAgentTextFits({ ...SETTINGS, voiceAgentKnowledge: "x".repeat(12_000) })).toBe(false)
    expect(phoneAgentTextFits({ ...SETTINGS, voiceAgentPrompt: "x".repeat(11_000), voiceAgentKnowledge: "" })).toBe(false)
  })
})

describe("the call's record", () => {
  it("is read only for the call it was written for", async () => {
    const { phoneAgentMarker } = await import("@/lib/voice-agent/phone-agent/marker")
    expect(phoneAgentMarker({ [PHONE_AGENT_MARKER]: marked() }, CALL_ID)).toEqual(marked())
    expect(phoneAgentMarker({ [PHONE_AGENT_MARKER]: marked() }, "bbbbbbbb-2222-4222-8222-222222222222")).toBeNull()
    expect(phoneAgentMarker({ pharmacyInboundPreview: { version: 1 } }, CALL_ID)).toBeNull()
    expect(phoneAgentMarker(null, CALL_ID)).toBeNull()
    expect(phoneAgentMarker({ [PHONE_AGENT_MARKER]: { ...marked(), services: [{ code: "x", pageId: "p" }] } }, CALL_ID)).toBeNull()
  })
})
