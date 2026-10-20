/**
 * The guide's voice budget on a real Postgres, under row-level security, with
 * an application role that cannot bypass it (owner, 2026-10-20: «Кнопка
 * "спросить голосом"»).
 *
 * Every spoken answer and every heard question is a paid Google call. Its
 * seconds are claimed in `demo_access_events` before Google is asked, decided
 * one at a time under an advisory lock against two ceilings — ten minutes per
 * demo, 300 a day across demos (src/lib/demo-center/assistant-voice.ts). What
 * a mocked Prisma cannot show, and this does:
 *
 *   - that requests arriving together cannot all see the same room: eight at
 *     once against room for three send exactly three requests to Google;
 *   - that the sum really sees the rows — the table is under FORCE RLS, and a
 *     count outside the bypass is 0, which would read as «nothing spent»;
 *   - that the day's window is the column's own UTC time while the session
 *     runs in Europe/Berlin, as production's does;
 *   - that what is stored is seconds and an outcome, and nothing of the clip,
 *     the question or the answer;
 *   - that a spoken answer longer than its estimate is recorded at its real
 *     length, and the next claim sees it;
 *   - that Google hears exactly the seconds that were charged, whatever
 *     chunks the uploaded file carries;
 *   - that a refusal says what is left, and a refused long answer does not
 *     end voice while a question still fits.
 *
 * The real routes run (`/assistant/voice`, `/assistant/transcribe`) with the
 * real session check; only `fetch` to generativelanguage.googleapis.com is
 * stubbed, and every request to it is checked for the key in its header and
 * nowhere in its address.
 *
 * Set DEMO_ASSISTANT_VOICE_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   DEMO_ASSISTANT_VOICE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («Demo assistant voice budget database gate»), where
 * `DEMO_ASSISTANT_VOICE_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createRequire } from "node:module"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import type { Prisma, PrismaClient } from "@prisma/client"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { demoSessionCookieName, hashCredential } from "@/lib/demo-center/security"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { DEMO_ASSISTANT_VOICE_SECONDS_PER_DAY, DEMO_ASSISTANT_VOICE_SECONDS_PER_DEMO, speechSecondsUpperBound } from "@/lib/demo-center/assistant/voice-policy"

const adminUrl = process.env.DEMO_ASSISTANT_VOICE_TEST_DATABASE_URL
if (!adminUrl && process.env.DEMO_ASSISTANT_VOICE_DB_GATE === "required") {
  throw new Error("DEMO_ASSISTANT_VOICE_TEST_DATABASE_URL is required by the demo assistant voice budget database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.DEMO_ASSISTANT_VOICE_TEST_DATABASE_URL
  if (!admin) return null
  const name = `demo_voice_${process.pid}`
  const role = `demo_voice_app_${process.pid}`
  const password = `pw${process.pid}x${Date.now()}`
  const adminScratch = new URL(admin)
  adminScratch.pathname = `/${name}`
  const app = new URL(adminScratch)
  app.username = role
  app.password = password
  // The pool of a CI runner (Prisma's default on two cores): a claim that
  // waited while holding a connection its holder needed would stall here on
  // every machine — and five at once, more than the room for three below, is
  // what lets a missing lock show as an overspend.
  app.searchParams.set("connection_limit", "5")
  app.searchParams.set("pool_timeout", "10")
  // `@/lib/prisma` builds its client from DATABASE_URL on first import, which
  // happens after the scratch database and the role exist (dynamic imports below).
  process.env.DATABASE_URL = app.toString()
  process.env.DEMO_ASSISTANT_VOICE = "on"
  process.env.GEMINI_API_KEY = "test-gemini-key-not-real"
  return { name, role, password, adminScratch: adminScratch.toString() }
})

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const DEMO_TABLES = ['"demo_requests"', '"demo_grants"', '"demo_access_events"', '"demo_phone_verifications"', '"demo_whatsapp_threads"', '"demo_social_connections"']
const KEY = "test-gemini-key-not-real"

function sql(url: string, statement: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, "db", "execute", "--url", url, "--stdin"], { input: statement, encoding: "utf8", env: process.env })
  if (result.status !== 0) throw new Error(`prisma db execute failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
}

function sqlFile(url: string, file: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, "db", "execute", "--url", url, "--file", file], { encoding: "utf8", env: process.env })
  if (result.status !== 0) throw new Error(`prisma db execute --file ${file} failed\n${result.stdout}\n${result.stderr}`)
}

/** Every migration that touches a demo table, in the order `migrate deploy` applies them: their CHECKs, FORCE RLS, bypass policies. */
function demoMigrations(): string[] {
  const dir = path.join(ROOT, "prisma/migrations")
  return readdirSync(dir)
    .sort()
    .map((name) => path.join(dir, name, "migration.sql"))
    .filter((file) => existsSync(file) && DEMO_TABLES.some((table) => readFileSync(file, "utf8").includes(table)))
}

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60_000)

// --- Google, as far as the routes can see it ------------------------------

interface GoogleCall { url: string; key: string | null; kind: "speak" | "hear"; body: string }
const googleCalls: GoogleCall[] = []
let googleDelayMs = 0
/** What one test answer claims: fifty characters at the policy's upper bound. */
let speechSeconds = 0
let speakStatus = 200

function pcmBase64(seconds: number): string {
  return Buffer.alloc(Math.round(seconds * 24_000) * 2, 1).toString("base64")
}

const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input))
  if (url.host !== "generativelanguage.googleapis.com") throw new Error(`unexpected request to ${url.host}`)
  const kind = url.pathname.includes("tts") ? "speak" as const : "hear" as const
  googleCalls.push({ url: url.toString(), key: new Headers(init?.headers).get("x-goog-api-key"), kind, body: String(init?.body ?? "") })
  if (googleDelayMs) await new Promise((resolve) => setTimeout(resolve, googleDelayMs))
  if (kind === "speak") {
    if (speakStatus !== 200) return new Response("{}", { status: speakStatus })
    return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: pcmBase64(speechSeconds) } }] } }] })
  }
  return Response.json({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "Sövdələşmələri göstərin" }] }] })
})

/** A mono 16 kHz 16-bit WAV of `seconds`, as the page records it. */
function wavClip(seconds: number): Uint8Array<ArrayBuffer> {
  const samples = Math.round(seconds * 16_000)
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write("RIFF", 0, "latin1")
  buffer.writeUInt32LE(36 + samples * 2, 4)
  buffer.write("WAVE", 8, "latin1")
  buffer.write("fmt ", 12, "latin1")
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(16_000, 24)
  buffer.writeUInt32LE(32_000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write("data", 36, "latin1")
  buffer.writeUInt32LE(samples * 2, 40)
  for (let index = 0; index < samples; index += 1) buffer.writeInt16LE(Math.round(Math.sin(index / 7) * 8000), 44 + index * 2)
  return new Uint8Array(buffer)
}

/** One RIFF chunk: id, little-endian size, body, pad byte. */
function riffChunk(id: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.write(id, 0, "latin1")
  head.writeUInt32LE(body.length, 4)
  return Buffer.concat([head, body, Buffer.alloc(body.length & 1)])
}

function monoFmt(rate: number, bits: number): Buffer {
  const body = Buffer.alloc(16)
  body.writeUInt16LE(1, 0)
  body.writeUInt16LE(1, 2)
  body.writeUInt32LE(rate, 4)
  body.writeUInt32LE((rate * bits) / 8, 8)
  body.writeUInt16LE(bits / 8, 12)
  body.writeUInt16LE(bits, 14)
  return body
}

/**
 * Half a second by this server's reading — the last `fmt ` before the first
 * `data` — and about sixty by ffmpeg's: its first `fmt ` (8 kHz, 8-bit), read
 * on into the second `data`.
 */
function craftedClip(measured: Buffer): Uint8Array<ArrayBuffer> {
  const body = Buffer.concat([
    Buffer.from("WAVE", "latin1"),
    riffChunk("fmt ", monoFmt(8_000, 8)),
    riffChunk("fmt ", monoFmt(16_000, 16)),
    riffChunk("data", measured),
    riffChunk("data", Buffer.alloc(480_000, 0x41)),
  ])
  return new Uint8Array(Buffer.concat([riffChunk("RIFF", body).subarray(0, 8), body]))
}

/** An answer of fifty characters: every one claims the same seconds (CLAIM). */
function answerText(index: number): string {
  return `Nümunə cavab ${index}: bu ekran lidi göstərir`.padEnd(50, ".")
}
const CLAIM = speechSecondsUpperBound(answerText(1))

describe.skipIf(!scratch)("the guide's voice budget on a real Postgres under row-level security", () => {
  let admin!: PrismaClient
  let app!: typeof import("@/lib/prisma").prisma
  let voiceRoute!: typeof import("@/app/api/v1/public/demo-access/[token]/assistant/voice/route")
  let transcribeRoute!: typeof import("@/app/api/v1/public/demo-access/[token]/assistant/transcribe/route")
  let voice!: typeof import("@/lib/demo-center/assistant-voice")
  let seq = 0

  beforeAll(async () => {
    const control = adminUrl!
    sql(control, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    sql(control, `CREATE DATABASE "${scratch!.name}"`)
    const migrations = demoMigrations()
    expect(migrations.some((file) => file.includes("demo_assistant_voice_events"))).toBe(true)
    for (const file of migrations) sqlFile(scratch!.adminScratch, file)
    sql(control, `DROP ROLE IF EXISTS "${scratch!.role}"`)
    sql(control, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD '${scratch!.password}' NOSUPERUSER NOBYPASSRLS`)
    // Production's sessions run in Europe/Berlin while the columns hold UTC.
    sql(control, `ALTER ROLE "${scratch!.role}" SET TimeZone = 'Europe/Berlin'`)
    sql(scratch!.adminScratch, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"`)
    sql(scratch!.adminScratch, `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)

    const { PrismaClient: Client } = await import("@prisma/client")
    admin = new Client<Prisma.PrismaClientOptions>({ datasourceUrl: scratch!.adminScratch })
    app = (await import("@/lib/prisma")).prisma
    voice = await import("@/lib/demo-center/assistant-voice")
    voiceRoute = await import("@/app/api/v1/public/demo-access/[token]/assistant/voice/route")
    transcribeRoute = await import("@/app/api/v1/public/demo-access/[token]/assistant/transcribe/route")
    vi.stubGlobal("fetch", fakeFetch)
  }, 300_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await app?.$disconnect()
    await admin?.$disconnect()
    if (scratch) {
      sql(adminUrl!, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE)`)
      sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch.role}"`)
    }
  }, 60_000)

  beforeEach(async () => {
    await admin.demoAccessEvent.deleteMany()
    googleCalls.length = 0
    googleDelayMs = 0
    // Audio exactly as long as the claim, so settling changes nothing in the burst cases.
    speechSeconds = CLAIM
    speakStatus = 200
  })

  /** A prospect in a live, granted session: its own request (one open grant per request), token and browser cookie. */
  async function session() {
    seq += 1
    const token = randomBytes(32).toString("hex")
    const cookie = randomBytes(32).toString("hex")
    const request = await admin.demoRequest.create({
      data: {
        name: "Nigar Əliyeva", company: "Xəzər Logistika MMC", email: `nigar${seq}@example.az`, emailNormalized: `nigar${seq}@example.az`,
        emailDomain: "example.az", locale: "az", consentAt: hoursAgo(2),
      },
    })
    const grant = await admin.demoGrant.create({
      data: {
        requestId: request.id, tokenHash: hashOneTimeToken(token), tokenHint: token.slice(-6), moduleIds: [],
        scenarioId: "prospect-to-closed-won", scenarioVersion: 1, locale: "az", watermark: "ci",
        linkExpiresAt: new Date(Date.now() + 7 * 86_400_000), createdBy: "user-admin",
        status: "ACTIVE", sessionHash: hashCredential(cookie), sessionStartedAt: hoursAgo(1), sessionLastSeenAt: new Date(Date.now() - 60_000),
        sessionExpiresAt: new Date(Date.now() + 60 * 60_000), inactivityMinutes: 30, verifiedAt: hoursAgo(1.1),
      },
    })
    return { token, cookie: `${demoSessionCookieName(token)}=${cookie}`, grantId: grant.id }
  }

  type Session = Awaited<ReturnType<typeof session>>

  function speak(who: Session, answerId: string, answer: string, hash = voice.demoAnswerHash(who.grantId, answerId, answer)) {
    return voiceRoute.POST(
      new NextRequest(`https://app.leaddrivecrm.org/api/v1/public/demo-access/${who.token}/assistant/voice`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: who.cookie },
        body: JSON.stringify({ answerId, answer, answerHash: hash, stepId: "lead-list-stats" }),
      }),
      { params: Promise.resolve({ token: who.token }) },
    )
  }

  function hear(who: Session, clip: Uint8Array<ArrayBuffer>) {
    return transcribeRoute.POST(
      new NextRequest(`https://app.leaddrivecrm.org/api/v1/public/demo-access/${who.token}/assistant/transcribe?stepId=lead-list-stats`, {
        method: "POST",
        headers: { "content-type": "audio/wav", "content-length": String(clip.byteLength), cookie: who.cookie },
        body: clip,
      }),
      { params: Promise.resolve({ token: who.token }) },
    )
  }

  /** Every request of a burst finished before the case looks — a failed one fails the case, not the next. */
  async function settled(requests: Array<Promise<Response>>): Promise<Response[]> {
    const outcomes = await Promise.allSettled(requests)
    const failed = outcomes.filter((outcome) => outcome.status === "rejected")
    expect(failed.map((outcome) => String((outcome as PromiseRejectedResult).reason))).toEqual([])
    return outcomes.map((outcome) => (outcome as PromiseFulfilledResult<Response>).value)
  }

  const voiceRows = (grantId?: string) =>
    admin.demoAccessEvent.findMany({ where: { eventType: { in: ["ASSISTANT_VOICED", "ASSISTANT_HEARD"] }, ...(grantId ? { grantId } : {}) }, orderBy: { occurredAt: "asc" } })

  function expectKeyOnlyInHeader() {
    for (const call of googleCalls) {
      expect(call.key).toBe(KEY)
      expect(call.url).not.toContain(KEY)
      expect(call.url).not.toMatch(/[?&]key=/)
    }
  }

  it("the application's role reads no voice rows without the bypass — a sum taken there would be «nothing spent»", async () => {
    const who = await session()
    await admin.demoAccessEvent.create({ data: { grantId: who.grantId, eventType: "ASSISTANT_VOICED", metadata: { seconds: 590, outcome: "voiced" } } })
    const raw = await app.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM demo_access_events`
    expect(Number(raw[0].count)).toBe(0)
    // The claim takes its sum inside the bypass, sees the 590 seconds, and refuses 15 more.
    expect(await voice.claimDemoVoiceSeconds({ grantId: who.grantId, kind: "hear", seconds: 15 })).toEqual({ ok: false, refusal: "demo_budget", secondsLeft: 10 })
    expect(await voice.claimDemoVoiceSeconds({ grantId: who.grantId, kind: "hear", seconds: 10 })).toMatchObject({ ok: true, seconds: 10 })
  })

  it("eight answers at once against one demo's room for three: exactly three go to Google", async () => {
    const who = await session()
    expect(answerText(7)).toHaveLength(50)
    await admin.demoAccessEvent.create({
      data: { id: "voiced_seed", grantId: who.grantId, eventType: "ASSISTANT_VOICED", metadata: { seconds: DEMO_ASSISTANT_VOICE_SECONDS_PER_DEMO - 3 * CLAIM, outcome: "voiced" } },
    })
    googleDelayMs = 150

    const answers = Array.from({ length: 8 }, (_, index) => ({ id: `answer${index}`, text: answerText(index) }))
    const responses = await settled(answers.map((answer) => speak(who, answer.id, answer.text)))

    expect(googleCalls.filter((call) => call.kind === "speak")).toHaveLength(3)
    const statuses = responses.map((response) => response.status).sort()
    expect(statuses).toEqual([200, 200, 200, 429, 429, 429, 429, 429])
    for (const response of responses.filter((candidate) => candidate.status === 200)) {
      expect(response.headers.get("content-type")).toBe("audio/wav")
      const audio = Buffer.from(await response.arrayBuffer())
      expect(audio.toString("latin1", 0, 4)).toBe("RIFF")
    }
    for (const response of responses.filter((candidate) => candidate.status === 429)) {
      expect(await response.json()).toMatchObject({ success: false, code: "demo_budget" })
    }
    const rows = await voiceRows(who.grantId)
    expect(rows).toHaveLength(4)
    expect(rows.reduce((sum, row) => sum + Number((row.metadata as { seconds: number }).seconds), 0)).toBe(DEMO_ASSISTANT_VOICE_SECONDS_PER_DEMO)
    expectKeyOnlyInHeader()
  })

  it("eight questions at once from eight demos against the day's room for three: exactly three go to Google, and the window is UTC under a Berlin session", async () => {
    const sessions = await Promise.all(Array.from({ length: 8 }, () => session()))
    const busy = await session()
    const old = await session()
    // 23.5 hours ago counts toward today; 24.5 hours ago does not. A window
    // shifted by Berlin's two hours would flip one of them.
    await admin.demoAccessEvent.create({
      data: { grantId: busy.grantId, eventType: "ASSISTANT_HEARD", metadata: { seconds: DEMO_ASSISTANT_VOICE_SECONDS_PER_DAY - 15, outcome: "heard" }, occurredAt: hoursAgo(23.5) },
    })
    await admin.demoAccessEvent.create({
      data: { grantId: old.grantId, eventType: "ASSISTANT_VOICED", metadata: { seconds: 5_000, outcome: "voiced" }, occurredAt: hoursAgo(24.5) },
    })
    googleDelayMs = 150

    const responses = await settled(sessions.map((who) => hear(who, wavClip(5))))

    expect(googleCalls.filter((call) => call.kind === "hear")).toHaveLength(3)
    const bodies = await Promise.all(responses.map(async (response) => ({ status: response.status, body: await response.json() })))
    const heard = bodies.filter((entry) => entry.status === 200)
    expect(heard).toHaveLength(3)
    for (const entry of heard) expect(entry.body).toEqual({ success: true, text: "Sövdələşmələri göstərin" })
    expect(bodies.filter((entry) => entry.status === 429).map((entry) => entry.body.code)).toEqual(Array(5).fill("day_budget"))
    expectKeyOnlyInHeader()
  })

  it("one answer is spoken once: the same answer eight times at once reaches Google once", async () => {
    const who = await session()
    googleDelayMs = 100
    const responses = await settled(Array.from({ length: 8 }, () => speak(who, "answer-once", answerText(1))))
    expect(googleCalls).toHaveLength(1)
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409, 409, 409, 409, 409, 409, 409])
    expect(await voiceRows(who.grantId)).toHaveLength(1)
  })

  it("speaks nothing the assistant did not vouch for: a changed text or a borrowed hash is refused before any spend", async () => {
    const who = await session()
    const other = await session()
    const hash = voice.demoAnswerHash(who.grantId, "answer-a", answerText(1))
    expect((await speak(who, "answer-a", `${answerText(1)} Və bunu da deyin.`, hash)).status).toBe(403)
    expect((await speak(who, "answer-b", answerText(1), hash)).status).toBe(403)
    // Another demo's answer, with its own valid hash, in this demo's session.
    expect((await speak(who, "answer-c", answerText(1), voice.demoAnswerHash(other.grantId, "answer-c", answerText(1)))).status).toBe(403)
    expect(googleCalls).toEqual([])
    expect(await voiceRows()).toEqual([])
  })

  it("lowers a spoken answer's claim to the audio's length, and keeps the whole claim when Google fails", async () => {
    const who = await session()
    speechSeconds = 3.2
    expect((await speak(who, "short", answerText(1))).status).toBe(200)
    speakStatus = 500
    expect((await speak(who, "failed", answerText(2))).status).toBe(502)
    const rows = await voiceRows(who.grantId)
    expect(CLAIM).toBeGreaterThan(4)
    expect(rows.map((row) => [row.id, row.metadata])).toEqual([
      ["voiced_short", { seconds: 4, outcome: "voiced" }],
      ["voiced_failed", { seconds: CLAIM, outcome: "failed" }],
    ])
  })

  it("records a spoken answer's real length when it runs past the estimate, and the next claim sees it", async () => {
    const who = await session()
    // Room for this answer's estimate and ten seconds more.
    await admin.demoAccessEvent.create({
      data: { id: "voiced_seed", grantId: who.grantId, eventType: "ASSISTANT_VOICED", metadata: { seconds: DEMO_ASSISTANT_VOICE_SECONDS_PER_DEMO - CLAIM - 10, outcome: "voiced" } },
    })
    // Figures read aloud: the audio runs past the 0.14 s a character.
    speechSeconds = CLAIM + 7.4
    expect((await speak(who, "figures", answerText(1))).status).toBe(200)
    expect((await admin.demoAccessEvent.findUnique({ where: { id: "voiced_figures" } }))?.metadata).toEqual({ seconds: CLAIM + 8, outcome: "voiced" })
    // Two seconds are left, not ten: a five-second question no longer fits, and Google is not asked.
    const refused = await hear(who, wavClip(5))
    expect(refused.status).toBe(429)
    expect(await refused.json()).toMatchObject({ code: "demo_budget", secondsLeft: 2, exhausted: true })
    expect(googleCalls.map((call) => call.kind)).toEqual(["speak"])
  })

  it("sends Google the half second it measured and charged, never the uploaded file's own chunks", async () => {
    const who = await session()
    const measured = Buffer.alloc(16_000)
    for (let index = 0; index < measured.length; index += 2) measured.writeInt16LE(Math.round(Math.sin(index / 9) * 6000), index)
    const clip = craftedClip(measured)
    expect(clip.byteLength).toBeLessThan(44 + 16_000 * 2 * 16)
    const response = await hear(who, clip)
    expect(response.status).toBe(200)
    const [row] = await voiceRows(who.grantId)
    expect(row.metadata).toEqual({ seconds: 1, outcome: "heard" })
    expect(googleCalls).toHaveLength(1)
    const forwarded = Buffer.from(JSON.parse(googleCalls[0].body).input[0].data, "base64")
    // The page's own 44-byte header around exactly the measured samples.
    expect(forwarded.length).toBe(44 + measured.length)
    expect(forwarded.subarray(0, 44).equals(Buffer.from(wavClip(0.5)).subarray(0, 44))).toBe(true)
    expect(forwarded.subarray(44).equals(measured)).toBe(true)
  })

  it("a long answer refused over the budget says a question still fits — and the question then goes through", async () => {
    const who = await session()
    await admin.demoAccessEvent.create({
      data: { id: "voiced_seed", grantId: who.grantId, eventType: "ASSISTANT_VOICED", metadata: { seconds: DEMO_ASSISTANT_VOICE_SECONDS_PER_DEMO - 20, outcome: "voiced" } },
    })
    const long = "Bu ekran lidin mənbəyini, marağını və balını göstərir. ".repeat(6)
    expect(speechSecondsUpperBound(long)).toBeGreaterThan(20)
    const refused = await speak(who, "long-1", long)
    expect(refused.status).toBe(429)
    expect(await refused.json()).toMatchObject({ code: "demo_budget", secondsLeft: 20, exhausted: false })
    expect((await hear(who, wavClip(15))).status).toBe(200)
    // Five seconds left: not one full question any more, so now voice is over.
    const over = await speak(who, "long-2", long)
    expect(await over.json()).toMatchObject({ code: "demo_budget", secondsLeft: 5, exhausted: true })
    expect(googleCalls.map((call) => call.kind)).toEqual(["hear"])
  })

  it("keeps nothing of a heard question: the answer is the text, the one row written is seconds and an outcome", async () => {
    const who = await session()
    const before = await admin.demoAccessEvent.count()
    const response = await hear(who, wavClip(4.2))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(Object.keys(body).sort()).toEqual(["success", "text"])
    expect(await admin.demoAccessEvent.count()).toBe(before + 1)
    const [row] = await voiceRows(who.grantId)
    expect(row).toMatchObject({ eventType: "ASSISTANT_HEARD", stepId: "lead-list-stats" })
    expect(row.metadata).toEqual({ seconds: 5, outcome: "heard" })
    // Nothing anywhere holds the words that were heard.
    const stored = await admin.$queryRaw<{ dump: string }[]>`SELECT coalesce(string_agg(t::text, ' '), '') AS dump FROM demo_access_events t`
    expect(stored[0].dump).not.toContain("Sövdələşmələri")
    // The clip went to Google once, inside the request, as the WAV it was.
    expect(googleCalls).toHaveLength(1)
    expect(googleCalls[0].body).toContain('"mime_type":"audio/wav"')
    // …and asked Google not to keep the interaction (its default is 55 days).
    expect(JSON.parse(googleCalls[0].body).store).toBe(false)
  })

  it("refuses a clip it cannot read, or one longer than fifteen seconds, before any spend", async () => {
    const who = await session()
    expect((await hear(who, wavClip(16.2))).status).toBe(413)
    const stereo = Buffer.from(wavClip(2))
    stereo.writeUInt16LE(2, 22)
    expect((await hear(who, new Uint8Array(stereo))).status).toBe(400)
    expect((await hear(who, new Uint8Array(Buffer.from("not a wav file at all")))).status).toBe(400)
    expect(googleCalls).toEqual([])
    expect(await voiceRows()).toEqual([])
  })

  it("answers nobody without this browser's session", async () => {
    const who = await session()
    const stranger = { ...who, cookie: `${demoSessionCookieName(who.token)}=${"0".repeat(64)}` }
    expect((await speak(stranger, "answer-x", answerText(1))).status).toBe(401)
    expect((await hear(stranger, wavClip(2))).status).toBe(401)
    expect(googleCalls).toEqual([])
  })
})
