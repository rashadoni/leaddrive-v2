/**
 * The two voice routes and the assistant's side of them, through the real
 * handlers (owner, 2026-10-20: «Кнопка "спросить голосом"»).
 *
 * The grant lookup, the budget claim and Google are stand-ins; what each
 * route checks first, what it refuses, what it sends to Google and what it
 * answers are the routes' own. The claim itself — atomic, under RLS — is
 * proven on a real Postgres in demo-assistant-voice-postgres.test.ts.
 */
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findGrant: vi.fn(),
  countEvents: vi.fn(),
  lastEvent: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  claude: vi.fn(),
  claim: vi.fn(),
  settle: vi.fn(),
  session: true,
  /** Each file the transcribe route handed to Google's client, as the very buffer it passed. */
  forwarded: [] as Buffer[],
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    demoGrant: { findUnique: mocks.findGrant },
    demoAccessEvent: { count: mocks.countEvents, findFirst: mocks.lastEvent, create: mocks.createEvent, update: mocks.updateEvent },
  },
}))
vi.mock("@/lib/rls-context", () => ({ runWithRlsBypass: (fn: () => unknown) => Promise.resolve().then(fn) }))
vi.mock("@/lib/demo-center/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/demo-center/access")>()),
  expireDemoGrantIfNeeded: async () => false,
}))
vi.mock("@/lib/demo-center/security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/demo-center/security")>()),
  secureHashMatches: () => mocks.session,
}))
vi.mock("@/lib/demo-center/assistant-voice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/demo-center/assistant-voice")>()),
  claimDemoVoiceSeconds: mocks.claim,
  settleDemoVoiceSeconds: mocks.settle,
}))
vi.mock("@/lib/ai/anthropic-client", () => ({ getAnthropicClient: () => ({ messages: { create: mocks.claude } }) }))
vi.mock("@/lib/ai/gemini-speech", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ai/gemini-speech")>()
  return {
    ...real,
    transcribeGeminiAudio: (input: Parameters<typeof real.transcribeGeminiAudio>[0]) => {
      mocks.forwarded.push(input.wav)
      return real.transcribeGeminiAudio(input)
    },
  }
})

import { POST as ASK } from "@/app/api/v1/public/demo-access/[token]/assistant/route"
import { POST as SPEAK } from "@/app/api/v1/public/demo-access/[token]/assistant/voice/route"
import { POST as HEAR } from "@/app/api/v1/public/demo-access/[token]/assistant/transcribe/route"
import { pcm16Wav, readWav } from "@/lib/ai/gemini-speech"
import { demoAnswerHash } from "@/lib/demo-center/assistant-voice"
import { DEMO_VOICE_REFUSAL_TEXT, speechSecondsUpperBound } from "@/lib/demo-center/assistant/voice-policy"
import { DEMO_GUIDE_VOICE, DEMO_GUIDE_VOICE_DIRECTION } from "@/lib/demo-center/guide-voice"

const TOKEN = "b".repeat(64)
const KEY = "AIza-test-key-0001"
const ANSWER = "Bu, lidin balıdır: mənbə və maraq əsasında hesablanır."
const GRANT = "grant-voice-1"

interface GoogleCall { url: string; init?: RequestInit }
let google: GoogleCall[]
let googleReply: () => Response

function wavClip(seconds: number, { rate = 16_000, channels = 1 }: { rate?: number; channels?: number } = {}): Uint8Array<ArrayBuffer> {
  const samples = Math.round(seconds * rate) * channels
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write("RIFF", 0, "latin1")
  buffer.writeUInt32LE(36 + samples * 2, 4)
  buffer.write("WAVE", 8, "latin1")
  buffer.write("fmt ", 12, "latin1")
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(rate, 24)
  buffer.writeUInt32LE(rate * 2 * channels, 28)
  buffer.writeUInt16LE(2 * channels, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write("data", 36, "latin1")
  buffer.writeUInt32LE(samples * 2, 40)
  for (let index = 0; index < samples; index += 1) buffer.writeInt16LE((index * 37) % 4000, 44 + index * 2)
  return new Uint8Array(buffer)
}

/** One RIFF chunk: id, little-endian size, body, and the pad byte an odd body takes. */
function chunk(id: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.write(id, 0, "latin1")
  head.writeUInt32LE(body.length, 4)
  return Buffer.concat([head, body, Buffer.alloc(body.length & 1)])
}

/** A mono PCM `fmt ` body at `rate` and `bits`. */
function fmtBody(rate: number, bits: number): Buffer {
  const body = Buffer.alloc(16)
  body.writeUInt16LE(1, 0)
  body.writeUInt16LE(1, 2)
  body.writeUInt32LE(rate, 4)
  body.writeUInt32LE((rate * bits) / 8, 8)
  body.writeUInt16LE(bits / 8, 12)
  body.writeUInt16LE(bits, 14)
  return body
}

function riff(chunks: Buffer[]): Uint8Array<ArrayBuffer> {
  const body = Buffer.concat([Buffer.from("WAVE", "latin1"), ...chunks])
  return new Uint8Array(Buffer.concat([chunk("RIFF", body).subarray(0, 8), body]))
}

function speak(body: Record<string, unknown>) {
  return SPEAK(
    new NextRequest(`https://app.leaddrivecrm.org/api/v1/public/demo-access/${TOKEN}/assistant/voice`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "ld_demo_session_x=y" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token: TOKEN }) },
  )
}

function hear(clip: Uint8Array<ArrayBuffer>, type = "audio/wav") {
  return HEAR(
    new NextRequest(`https://app.leaddrivecrm.org/api/v1/public/demo-access/${TOKEN}/assistant/transcribe?stepId=lead-list-stats`, {
      method: "POST",
      headers: { "content-type": type, "content-length": String(clip.byteLength), cookie: "ld_demo_session_x=y" },
      body: clip,
    }),
    { params: Promise.resolve({ token: TOKEN }) },
  )
}

function ask(question: string) {
  return ASK(
    new NextRequest(`https://app.leaddrivecrm.org/api/v1/public/demo-access/${TOKEN}/assistant`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "ld_demo_session_x=y" },
      body: JSON.stringify({ question, state: "LEAD_CREATED", sectionId: "lead-created", stepId: "lead-list-stats" }),
    }),
    { params: Promise.resolve({ token: TOKEN }) },
  )
}

const valid = () => ({ answerId: "evt_answer_1", answer: ANSWER, answerHash: demoAnswerHash(GRANT, "evt_answer_1", ANSWER), stepId: "lead-list-stats" })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session = true
  mocks.forwarded = []
  process.env.DEMO_ASSISTANT_VOICE = "on"
  process.env.GEMINI_API_KEY = KEY
  process.env.TYPESAFE_API_KEY = "test-key"
  mocks.findGrant.mockResolvedValue({
    id: GRANT, status: "ACTIVE", sessionHash: "h", scenarioId: "prospect-to-closed-won", liveCallEnabled: false,
    linkExpiresAt: new Date(Date.now() + 86_400_000),
    request: { name: "Nigar Əliyeva", company: "Xəzər Logistika MMC", jobTitle: null, email: "nigar@example.az", phone: null, source: "website" },
  })
  mocks.countEvents.mockResolvedValue(0)
  mocks.lastEvent.mockResolvedValue(null)
  mocks.createEvent.mockResolvedValue({ id: "evt_answer_1" })
  mocks.claim.mockImplementation(async ({ seconds }: { seconds: number }) => ({ ok: true, eventId: "evt_claim", seconds: Math.ceil(seconds) }))
  mocks.settle.mockResolvedValue(undefined)
  mocks.claude.mockResolvedValue({ content: [{ type: "text", text: ANSWER }], usage: { input_tokens: 900, output_tokens: 60 } })
  google = []
  googleReply = () => Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.alloc(24_000 * 2 * 3).toString("base64") } }] } }] })
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes("generativelanguage.googleapis.com")) {
      google.push({ url, init })
      return googleReply()
    }
    // Jev, the decision model: unsure, so Da Vinci answers.
    return new Response(JSON.stringify({ answers: { intent: { choice: "other", confidence: 0.4 } }, usage: { input_tokens: 10 } }), { status: 200 })
  }))
})

afterEach(() => {
  delete process.env.DEMO_ASSISTANT_VOICE
  delete process.env.GEMINI_API_KEY
  vi.unstubAllGlobals()
})

describe("the kill switch", () => {
  it("off by default: both routes are not there, and nothing is looked up or sent", async () => {
    delete process.env.DEMO_ASSISTANT_VOICE
    expect((await speak(valid())).status).toBe(404)
    expect((await hear(wavClip(2))).status).toBe(404)
    for (const value of ["off", "false", "0", "yes", ""]) {
      process.env.DEMO_ASSISTANT_VOICE = value
      expect((await speak(valid())).status, value).toBe(404)
    }
    expect(mocks.findGrant).not.toHaveBeenCalled()
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(google).toEqual([])
  })

  it("off: a Da Vinci answer carries nothing to voice it with", async () => {
    delete process.env.DEMO_ASSISTANT_VOICE
    const body = await (await ask("Bu bal necə hesablanır?")).json()
    expect(body).toMatchObject({ success: true, answer: ANSWER })
    expect(body.answerId).toBeUndefined()
    expect(body.answerHash).toBeUndefined()
  })
})

describe("who may use the voice", () => {
  it("no session in this browser: 401 from both, before any claim or call", async () => {
    mocks.session = false
    expect((await speak(valid())).status).toBe(401)
    expect((await hear(wavClip(2))).status).toBe(401)
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(google).toEqual([])
  })

  it("a link that is not in a live session, or unknown: refused the same way", async () => {
    mocks.findGrant.mockResolvedValueOnce({ id: GRANT, status: "SENT", sessionHash: null, scenarioId: "prospect-to-closed-won", liveCallEnabled: false, request: {} })
    expect((await speak(valid())).status).toBe(401)
    mocks.findGrant.mockResolvedValueOnce(null)
    expect((await hear(wavClip(2))).status).toBe(404)
    expect(google).toEqual([])
  })
})

describe("speaking an answer", () => {
  it("speaks exactly the answer the assistant vouched for, in the guide's voice, with the key in a header", async () => {
    const response = await speak(valid())
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("audio/wav")
    expect(response.headers.get("cache-control")).toContain("no-store")
    const audio = Buffer.from(await response.arrayBuffer())
    expect(audio.toString("latin1", 0, 4)).toBe("RIFF")
    expect(audio.readUInt32LE(24)).toBe(24_000)

    expect(google).toHaveLength(1)
    const [call] = google
    expect(call.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEMO_GUIDE_VOICE.model}:generateContent`)
    expect(call.url).not.toContain(KEY)
    expect(new Headers(call.init?.headers).get("x-goog-api-key")).toBe(KEY)
    const sent = JSON.parse(String(call.init?.body))
    expect(sent.contents[0].parts[0].text).toBe(`${DEMO_GUIDE_VOICE_DIRECTION}\n${ANSWER}`)
    expect(sent.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Kore")

    // Claimed before, settled after: the upper bound, then the audio's own three seconds.
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ grantId: GRANT, kind: "speak", answerId: "evt_answer_1", seconds: speechSecondsUpperBound(ANSWER), stepId: "lead-list-stats" }))
    expect(mocks.settle).toHaveBeenCalledWith({ ok: true, eventId: "evt_claim", seconds: speechSecondsUpperBound(ANSWER) }, "voiced", 3)
  })

  it("refuses a text the hash does not cover — changed, or another answer's — before any claim or call", async () => {
    expect((await speak({ ...valid(), answer: `${ANSWER} Pulsuzdur.` })).status).toBe(403)
    expect((await speak({ ...valid(), answerId: "evt_answer_2" })).status).toBe(403)
    expect((await speak({ ...valid(), answerHash: "0".repeat(64) })).status).toBe(403)
    expect((await speak({ ...valid(), answerHash: undefined })).status).toBe(403)
    expect((await speak({ answerId: "evt_answer_1" })).status).toBe(400)
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(google).toEqual([])
  })

  it("over the budget, or already spoken: refused in words, and Google is not asked", async () => {
    mocks.claim.mockResolvedValueOnce({ ok: false, refusal: "demo_budget", secondsLeft: 0 })
    const spent = await speak(valid())
    expect(spent.status).toBe(429)
    expect(await spent.json()).toEqual({ success: false, code: "demo_budget", error: DEMO_VOICE_REFUSAL_TEXT.demo_budget, exhausted: true })
    mocks.claim.mockResolvedValueOnce({ ok: false, refusal: "day_budget", secondsLeft: 0 })
    expect((await speak(valid())).status).toBe(429)
    mocks.claim.mockResolvedValueOnce({ ok: false, refusal: "already_voiced" })
    const again = await speak(valid())
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ success: false, code: "already_voiced", error: DEMO_VOICE_REFUSAL_TEXT.already_voiced })
    expect(google).toEqual([])
  })

  it("a refused answer says whether voice is over — only when not even a fifteen-second question fits — and never the seconds left", async () => {
    // A long answer's estimate (here 140 s left) is refused while a question still fits.
    for (const [secondsLeft, exhausted] of [[140, false], [15, false], [14, true], [0, true]] as const) {
      mocks.claim.mockResolvedValueOnce({ ok: false, refusal: "demo_budget", secondsLeft })
      const refused = await speak(valid())
      expect(refused.status).toBe(429)
      expect(await refused.json(), `${secondsLeft} s left`).toEqual({ success: false, code: "demo_budget", error: DEMO_VOICE_REFUSAL_TEXT.demo_budget, exhausted })
    }
    // The seconds left are the smaller of this demo's and the day's, and the
    // day's pool is every other prospect's voice: the page is not told them.
    mocks.claim.mockResolvedValueOnce({ ok: false, refusal: "day_budget", secondsLeft: 40 })
    const day = await (await speak(valid())).json()
    expect(day).toEqual({ success: false, code: "day_budget", error: DEMO_VOICE_REFUSAL_TEXT.day_budget, exhausted: false })
    expect(day).not.toHaveProperty("secondsLeft")
    expect(google).toEqual([])
  })

  it("a failed synthesis keeps its claim and says so", async () => {
    googleReply = () => new Response("{}", { status: 429 })
    const response = await speak(valid())
    expect(response.status).toBe(502)
    expect((await response.json()).error).toBe(DEMO_VOICE_REFUSAL_TEXT.unavailable)
    expect(mocks.settle).toHaveBeenCalledWith(expect.objectContaining({ eventId: "evt_claim" }), "failed")
  })

  it("the assistant hands out an id and a hash for exactly its Da Vinci answer, and none for a prepared one", async () => {
    const body = await (await ask("Bu bal necə hesablanır?")).json()
    expect(body).toMatchObject({ success: true, answer: ANSWER, source: "davinci", answerId: "evt_answer_1" })
    expect(body.answerHash).toBe(demoAnswerHash(GRANT, "evt_answer_1", ANSWER))
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ answers: { intent: { choice: "price", confidence: 0.97 } }, usage: { input_tokens: 10 } }), { status: 200 })))
    const prepared = await (await ask("Qiyməti nədir?")).json()
    expect(prepared.source).toBe("prepared")
    expect(prepared.audio).toMatch(/^\/sounds\/demo-guide\//)
    expect(prepared.answerId).toBeUndefined()
  })
})

describe("hearing a question", () => {
  it("returns the text and only the text; the claim holds the clip's seconds and nothing of it", async () => {
    googleReply = () => Response.json({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "  Sövdələşmələri   göstərin " }] }] })
    const clip = wavClip(4.2)
    const response = await hear(clip)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ success: true, text: "Sövdələşmələri göstərin" })

    expect(google).toHaveLength(1)
    const [call] = google
    expect(call.url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions")
    expect(new Headers(call.init?.headers).get("x-goog-api-key")).toBe(KEY)
    expect(call.url).not.toContain(KEY)
    const sent = JSON.parse(String(call.init?.body))
    expect(sent.model).toBe("gemini-3.5-transcribe")
    expect(sent.input).toEqual([{ type: "audio", data: Buffer.from(clip).toString("base64"), mime_type: "audio/wav" }])
    expect(sent.generation_config.transcription_config.language_codes).toEqual(["az-AZ", "ru-RU", "en-US"])
    // Google keeps an interaction for 55 days unless told not to.
    expect(sent.store).toBe(false)

    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ grantId: GRANT, kind: "hear", seconds: 5, stepId: "lead-list-stats" }))
    expect(mocks.settle).toHaveBeenCalledWith(expect.objectContaining({ eventId: "evt_claim" }), "heard")
    // Not persisted: no write anywhere carries the words or the audio.
    const written = JSON.stringify([mocks.claim.mock.calls, mocks.settle.mock.calls, mocks.createEvent.mock.calls, mocks.updateEvent.mock.calls])
    expect(written).not.toContain("Sövdələşmələri")
    expect(written).not.toContain(Buffer.from(clip).toString("base64").slice(0, 40))
    expect(mocks.createEvent).not.toHaveBeenCalled()
    expect(mocks.updateEvent).not.toHaveBeenCalled()
  })

  it("sends Google exactly the audio it measured and claimed, never the caller's own file", async () => {
    // A second `fmt ` and a second `data`: this reader takes the last `fmt `
    // before the first `data` (16 kHz, 16-bit) and measures half a second;
    // ffmpeg takes the FIRST `fmt ` (8 kHz, 8-bit) and reads on into the
    // second `data` — about sixty seconds of the same bytes.
    const measured = Buffer.alloc(16_000)
    for (let index = 0; index < measured.length; index += 2) measured.writeInt16LE(((index * 13) % 6000) - 3000, index)
    const crafted = riff([
      chunk("fmt ", fmtBody(8_000, 8)),
      chunk("fmt ", fmtBody(16_000, 16)),
      chunk("data", measured),
      chunk("data", Buffer.alloc(480_000, 0x41)),
    ])
    expect(crafted.byteLength).toBeLessThan(44 + 16_000 * 2 * 16)
    expect(readWav(Buffer.from(crafted))?.seconds).toBe(0.5)
    googleReply = () => Response.json({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "Salam" }] }] })

    const response = await hear(crafted)
    expect(response.status).toBe(200)
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ kind: "hear", seconds: 1 }))
    expect(google).toHaveLength(1)
    const sent = JSON.parse(String(google[0].init?.body))
    const forwarded = Buffer.from(sent.input[0].data, "base64")
    // One canonical header around the measured half second, and nothing else of the upload.
    expect(forwarded.length).toBe(44 + measured.length)
    expect(forwarded.equals(pcm16Wav(measured, 16_000))).toBe(true)
    expect(readWav(forwarded)).toMatchObject({ format: 1, channels: 1, sampleRate: 16_000, bitsPerSample: 16, seconds: 0.5 })
    // The copy handed to Google's client is zeroed once the call is over, like the upload.
    expect(mocks.forwarded).toHaveLength(1)
    expect(mocks.forwarded[0].length).toBe(44 + measured.length)
    expect(mocks.forwarded[0].every((byte) => byte === 0)).toBe(true)
  })

  it("a refused question says whether voice is over, never the seconds left, and Google is not asked", async () => {
    mocks.claim.mockResolvedValueOnce({ ok: false, refusal: "demo_budget", secondsLeft: 3 })
    const refused = await hear(wavClip(5))
    expect(refused.status).toBe(429)
    expect(await refused.json()).toEqual({ success: false, code: "demo_budget", error: DEMO_VOICE_REFUSAL_TEXT.demo_budget, exhausted: true })
    mocks.claim.mockResolvedValueOnce({ ok: false, refusal: "day_budget", secondsLeft: 900 })
    expect(await (await hear(wavClip(5))).json()).toEqual({ success: false, code: "day_budget", error: DEMO_VOICE_REFUSAL_TEXT.day_budget, exhausted: false })
    expect(google).toEqual([])
    expect(mocks.forwarded).toEqual([])
  })

  it("nothing intelligible: says so, and the clip's seconds stay spent", async () => {
    googleReply = () => Response.json({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "   " }] }] })
    const response = await hear(wavClip(2))
    expect(response.status).toBe(422)
    expect((await response.json()).error).toBe(DEMO_VOICE_REFUSAL_TEXT.silent)
    expect(mocks.settle).toHaveBeenCalledWith(expect.anything(), "silent")
  })

  it("only a mono 16 kHz WAV of up to fifteen seconds is heard; anything else is refused before any claim", async () => {
    expect((await hear(wavClip(2), "audio/webm")).status).toBe(415)
    expect((await hear(wavClip(2, { rate: 48_000 }))).status).toBe(400)
    expect((await hear(wavClip(2, { channels: 2 }))).status).toBe(400)
    expect((await hear(wavClip(16))).status).toBe(413)
    expect((await hear(wavClip(0.2))).status).toBe(400)
    expect((await hear(new Uint8Array(Buffer.from("RIFF....WAVEjunk")))).status).toBe(400)
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(google).toEqual([])
  })

  it("a heard question is masked before Claude exactly as a typed one: it is the same route", async () => {
    const heard = "Mənim nömrəm +994 50 123 45 67, zəng edin"
    await ask(heard)
    const content = String(mocks.claude.mock.calls[0][0].messages[0].content)
    expect(content).not.toContain("123 45 67")
    expect(content).not.toContain("+994 50")
  })
})
