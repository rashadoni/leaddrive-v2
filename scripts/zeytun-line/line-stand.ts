/**
 * Line stand (owner 2026-11-06: «сделай тесты… честно скажи сможешь эффективно
 * протестировать»): the station's whole core answers calls placed by a caller
 * that talks like people do — and so finds what the voice stand cannot.
 *
 * Call 452259a8 (2026-11-06): the caller spoke right after the greeting; the
 * core's speech gate counted the model's own unvoiced greeting turn as the
 * assistant speaking and dropped the caller's first second, and the model heard
 * a drug in the fragment. The voice stand (voice-stand.ts) never saw it: it
 * drives Gemini as the core would, without the core, and its caller always
 * waits for the assistant to finish. Here:
 *
 *  - the core is the station's (line-stand-core.py: built by the install's own
 *    builder, Silero gate, barge-in, TTS relay with Sulafat on Vertex, playout,
 *    bridge); only its Gemini socket goes through prod, where the key is;
 *  - every HTTPS request of the core comes to this process's proxy:
 *    app.leaddrivecrm.org is answered here by the CRM's own handler on a
 *    catalog snapshot (stand-crm.ts, order writer stubbed), and nothing of it
 *    reaches prod; Vertex (the line's TTS) passes through, anything else is refused;
 *  - the caller is an AudioSocket client, as Asterisk is: 20 ms frames of
 *    8 kHz PCM16 in real time, phrases in the pharmacy's TTS voice through
 *    G.711 (voice-caller-tts.py), each call in one manner:
 *      polite   1.0 s after the assistant's audio stops
 *      quick    0.25 s after it stops (the owner's 452259a8)
 *      overlap  while the assistant still speaks, 1.2 s into its reply
 *      pauses   polite, but every phrase broken at its commas by 0.8 s of silence
 *      noisy    polite, over room noise (RMS ~150) with louder bursts
 *      room     polite, while another voice in the room talks now and then (the meeting calls of 2026-11-06)
 *  - checks: what the core heard (the CRM's call result, as hear patterns of
 *    the scenario), what it looked up and saved, the final order against the
 *    scenario, the station's own counters (speech dropped by the gate while the
 *    assistant spoke / was silent, barge-ins), the gap from the end of each
 *    phrase to the assistant's first sound on the line (TTS included).
 *
 *   JITI_ALIAS='{"@":"'$PWD'/src"}' node_modules/.bin/jiti scripts/zeytun-line/line-stand.ts <snapshot> --core <base core>
 *     [--builder <build-zeytun-inbound-core.py of another revision>] [--station <fanum-zeytun-inbound.py>]
 *     [--manners polite,quick,overlap,pauses,noisy] [--steps N] [--scenario scripts/zeytun-line/voice-scenario.json]
 *     [--stop-at 0.6] [--out ~/inbox/zeytun-recordings/line-stand/<time>] [--departed-from <older snapshot>]
 *     [--drop-after-step N] (after step N's answer: Google drops the session and refuses its resumption,
 *      so the core restores the call in a fresh session — call ac5ccd37 lost its unsaved lines there)
 *     [--stand-dir ~/.cache/zeytun-core-stand] (onnxruntime in vendor/, silero-vad.onnx: the station's)
 *
 * Costs real money: one Live session per call (~$0.4-0.6 for the presentation
 * scenario), Vertex TTS for the assistant's words. Each call ends at --stop-at
 * USD of Live usage. The catalog snapshot, the audio and transcripts are the
 * client's and the owner's material: the output goes to ~/inbox, never to Git.
 */
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import tls from "node:tls"
import { fileURLToPath } from "node:url"

import type { InboundPilotCatalog } from "../../src/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { createChirpRecognizer, createZeytunSecondEar } from "../../src/lib/voice-agent/pharmacy/zeytun-chirp"
import { crmFor, foldLatin, loadCatalog, usageCost, type Json, type Save, type Usage } from "./stand-crm"

const HERE = dirname(fileURLToPath(import.meta.url))
const FRAME = 320 // 20 ms of 8 kHz PCM16
const FRAME_MS = 20
const TTS_PROJECT = "gen-lang-client-0496964632" // voice-caller-tts.py: the line's own Vertex project
const PASS_THROUGH = new Set(["aiplatform.googleapis.com", "aiplatform.eu.rep.googleapis.com", "generativelanguage.googleapis.com"])

type Rule = { match: string; label: string }
type Phrase = { say: string; hear?: Rule[] }
type Step = { n: number; phrases: Phrase[] }
type Scenario = { voice: string; steps: Step[]; final: { spoken: string; quantity: number; label: string }[] }
export const MANNERS = ["polite", "quick", "overlap", "pauses", "noisy", "room"] as const
/** "room": the meeting on 2026-11-06 (calls f0aa8998, d5155660) — other people talking near the phone. */
const ROOM_LINES = ["Kassada növbə var, tez gəl.", "Bu qutuları rəfə düz, sonra baxarıq.", "Telefonu kim götürdü?",
  "Sabah səhər tezdən gələcəyəm.", "O dərmanı dünən satdıq, qalmayıb."]
const ROOM_VOICE = "Kore"
const ROOM_GAIN = 0.35
type Manner = (typeof MANNERS)[number]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(predicate: () => boolean, ms: number) {
  const end = Date.now() + ms
  while (!predicate()) {
    if (Date.now() >= end) return false
    await sleep(10)
  }
  return true
}

/* ---------- audio ---------- */

const wavPcm = (file: string) => {
  const raw = readFileSync(file)
  return raw.subarray(raw.indexOf("data") + 8)
}
function rms(pcm: Buffer) {
  let sum = 0
  const n = Math.floor(pcm.length / 2)
  for (let i = 0; i < n; i++) { const v = pcm.readInt16LE(i * 2); sum += v * v }
  return n ? Math.sqrt(sum / n) : 0
}
/** Gaussian-ish noise frame at a given RMS; a burst now and then for a room (a voice nearby, a chair). */
function noiseFrame(level: number, bursts: boolean) {
  const out = Buffer.alloc(FRAME)
  const loud = bursts && Math.random() < 0.004 ? 6 : 1
  for (let i = 0; i < FRAME / 2; i++) {
    const g = (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.73
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(g * level * loud))), i * 2)
  }
  return out
}
/** A phrase split at its commas: the clip cut at the quietest frame near each comma's share of the speech. */
function withPauses(pcm: Buffer, say: string, pauseMs: number) {
  const commas = [...say.matchAll(/,/g)].map((m) => (m.index ?? 0) / say.length)
  if (!commas.length) return pcm
  const frames = Math.floor(pcm.length / FRAME)
  const cuts = commas.map((share) => {
    const center = Math.round(frames * share)
    let best = center, quiet = Infinity
    for (let f = Math.max(1, center - 15); f < Math.min(frames - 1, center + 15); f++) {
      const level = rms(pcm.subarray(f * FRAME, (f + 1) * FRAME))
      if (level < quiet) { quiet = level; best = f }
    }
    return best
  })
  const pause = Buffer.alloc(Math.round(pauseMs / FRAME_MS) * FRAME)
  const parts: Buffer[] = []
  let from = 0
  for (const cut of cuts) { parts.push(pcm.subarray(from * FRAME, cut * FRAME), pause); from = cut }
  parts.push(pcm.subarray(from * FRAME))
  return Buffer.concat(parts)
}
function stereoWav(left: Buffer, right: Buffer) {
  const frames = Math.max(left.length, right.length) / 2
  const data = Buffer.alloc(frames * 4)
  for (let i = 0; i < frames; i++) {
    data.writeInt16LE(i * 2 < left.length ? left.readInt16LE(i * 2) : 0, i * 4)
    data.writeInt16LE(i * 2 < right.length ? right.readInt16LE(i * 2) : 0, i * 4 + 2)
  }
  const head = Buffer.alloc(44)
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8); head.write("fmt ", 12)
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22); head.writeUInt32LE(8000, 24)
  head.writeUInt32LE(32000, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34); head.write("data", 36); head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}
function speak(text: string, voice: string, vertexKey: string, cache: string) {
  const out = execFileSync("python3", ["-I", "-W", "ignore", join(HERE, "voice-caller-tts.py"), vertexKey, cache, voice, text]).toString()
  return JSON.parse(out) as { file: string; speech_s: number }
}

/* ---------- the CRM and the proxy the core's HTTPS goes through ---------- */

type CrmEvent = { t: number; action: string; body: Json; answer: unknown }
type CallResult = { t: number; body: Json }

function certificates(dir: string) {
  const run = (args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: ["ignore", "ignore", "pipe"] })
  run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "2", "-subj", "/CN=line-stand CA",
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"])
  run(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "leaf.key", "-out", "leaf.csr", "-subj", "/CN=app.leaddrivecrm.org"])
  writeFileSync(join(dir, "leaf.ext"), "subjectAltName=DNS:app.leaddrivecrm.org\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\nkeyUsage=digitalSignature,keyEncipherment\n")
  run(["x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "leaf.pem", "-days", "2", "-extfile", "leaf.ext"])
  const system = ["/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt"].find((file) => existsSync(file))
  writeFileSync(join(dir, "bundle.pem"), Buffer.concat([system ? readFileSync(system) : Buffer.alloc(0), readFileSync(join(dir, "ca.pem"))]))
  return { key: readFileSync(join(dir, "leaf.key")), cert: readFileSync(join(dir, "leaf.pem")), bundle: join(dir, "bundle.pem") }
}

class StandCrm {
  events: CrmEvent[] = []
  results: CallResult[] = []
  unknown: string[] = []
  policy = ""
  private crm: (body: Json) => Promise<unknown>
  private server: http.Server
  proxy: http.Server
  constructor(catalog: InboundPilotCatalog, readonly saves: Save[], secondEarKey: string | undefined, private certs: { key: Buffer; cert: Buffer }) {
    const chirp = secondEarKey && existsSync(secondEarKey) ? createChirpRecognizer({ keyFile: secondEarKey }) : undefined
    this.crm = crmFor(catalog, saves, undefined, chirp && createZeytunSecondEar({ recognizer: chirp }))
    this.server = http.createServer((req, res) => void this.answer(req, res))
    this.proxy = http.createServer((_req, res) => { res.writeHead(403).end() })
    this.proxy.on("connect", (req, client: net.Socket, head: Buffer) => {
      const [host, port] = (req.url ?? "").split(":")
      client.on("error", () => undefined)
      if (host === "app.leaddrivecrm.org") {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
        const socket = new tls.TLSSocket(client, { isServer: true, key: this.certs.key, cert: this.certs.cert })
        socket.on("error", () => undefined)
        this.server.emit("connection", socket)
        return
      }
      if (!PASS_THROUGH.has(host)) { client.end("HTTP/1.1 403 Forbidden\r\n\r\n"); this.unknown.push(`CONNECT ${host}`); return }
      const upstream = net.connect(Number(port) || 443, host, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
        if (head.length) upstream.write(head)
        upstream.pipe(client)
        client.pipe(upstream)
      })
      upstream.on("error", () => client.destroy())
      client.on("close", () => upstream.destroy())
    })
  }
  listen() {
    return new Promise<number>((resolve) => this.proxy.listen(0, "127.0.0.1", () => resolve((this.proxy.address() as net.AddressInfo).port)))
  }
  private async answer(req: http.IncomingMessage, res: http.ServerResponse) {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString()
    const path = (req.url ?? "").split("?")[0]
    const reply = (status: number, value: unknown) => { res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value)) }
    try {
      if (path === "/api/internal/voice-agent/pharmacy-inbound") {
        const body = JSON.parse(raw) as Json
        const answer = await this.crm(body)
        this.events.push({ t: Date.now(), action: String(body.action ?? "?"), body: body.action === "utterance" ? { action: "utterance" } : body, answer })
        return reply(200, answer)
      }
      if (path === "/api/internal/voice-agent/runtime-config") return reply(200, { enabled: true, prompt: "Line stand.", technicalVoicePolicyVersion: this.policy })
      if (path === "/api/internal/asterisk/call-lifecycle") return reply(200, { ok: true })
      if (path === "/api/internal/voice-agent/call-result") {
        this.results.push({ t: Date.now(), body: JSON.parse(raw) as Json })
        return reply(200, { ok: true })
      }
      this.unknown.push(`${req.method} ${path}`)
      return reply(404, { error: "not_in_stand" })
    } catch (error) {
      this.unknown.push(`${req.method} ${path}: ${String(error)}`)
      return reply(500, { error: "stand" })
    }
  }
  close() { this.proxy.close() }
}

/* ---------- the core ---------- */

type Latency = { t: number; event: string; call_id?: string | null; [key: string]: unknown }

class Core {
  private child: ChildProcessWithoutNullStreams
  latency: Latency[] = []
  usage: { t: number; usd: number }[] = []
  relay: string[] = []
  ready: Promise<{ ready: number; policy: string }>
  log: string[] = []
  constructor(args: string[], env: NodeJS.ProcessEnv) {
    this.child = spawn("python3", ["-I", "-W", "ignore", join(HERE, "line-stand-core.py"), ...args], { stdio: ["pipe", "pipe", "pipe"], env })
    let resolveReady: (value: { ready: number; policy: string }) => void, rejectReady: (error: Error) => void
    this.ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
    this.child.on("exit", (code) => rejectReady(new Error(`the core exited (${code}): ${this.log.slice(-15).join("\n")}`)))
    this.child.stderr.on("data", (chunk) => { for (const line of String(chunk).split("\n")) if (line.trim()) this.log.push(line) })
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      this.log.push(line)
      if (line.startsWith("LD_LATENCY ")) {
        try { this.latency.push({ t: Date.now(), ...(JSON.parse(line.slice(11)) as Json) } as Latency) } catch { /* a partial line */ }
      } else if (line.startsWith("STAND ")) {
        const event = JSON.parse(line.slice(6)) as Json
        if (typeof event.ready === "number") resolveReady({ ready: event.ready, policy: String(event.policy) })
        else if (event.usage) this.usage.push({ t: Date.now(), usd: usageCost(event.usage as Usage).usd })
        else if (event.relay) this.relay.push(JSON.stringify(event))
        else if (event.error) rejectReady(new Error(String(event.error)))
      }
    })
  }
  /** A planned Google drop with every resume refused: the core must restore the call in a fresh session. */
  drop() { this.child.stdin.write(`${JSON.stringify({ drop: true, refuse_resume_s: 10 })}\n`) }
  close() { this.child.stdin.end(); setTimeout(() => this.child.kill(), 3000).unref() }
}

/* ---------- one call ---------- */

type PhraseResult = { step: number; say: string; startedAt: number; endedAt: number; replyAt?: number; replyGapMs?: number; overlapped: boolean }
type Span = [number, number]
type CallRun = {
  manner: Manner; callId: string; phrases: PhraseResult[]; caller: Buffer; agent: Buffer; stopped?: string
  /** ms from the call's start: when the room's other voice was talking ("room"). */
  roomSpans: Span[]
  usd: number; notes: string[]
}

async function playCall(scenario: Scenario, steps: Step[], manner: Manner, port: number, core: Core, opts: Options): Promise<CallRun> {
  const callId = randomUUID()
  const socket = net.connect(port, "127.0.0.1")
  await new Promise<void>((resolve, reject) => { socket.once("connect", () => resolve()); socket.once("error", reject) })
  const usage0 = core.usage.length
  const spent = () => core.usage.slice(usage0).reduce((sum, u) => sum + u.usd, 0)
  const notes: string[] = []
  const callerFrames: Buffer[] = []
  const agentFrames = new Map<number, Buffer>()
  const tape: Buffer[] = []
  let frameIndex = 0, closed = false
  let agentLoudAt = 0, agentStartedAt = 0, agentSpeaking = false
  const noise = manner === "noisy" ? 150 : manner === "room" ? 60 : 0
  const roomClips = manner === "room" ? ROOM_LINES.map((line) => wavPcm(speak(line, ROOM_VOICE, opts.vertexKey, opts.cache).file)) : []
  const roomSpans: Span[] = []
  let roomTape: Buffer | null = null, nextRoomFrame = 150 + Math.floor(Math.random() * 200), roomIndex = 0
  // The station's trunk: a frame every 20 ms whatever happens; the core answers with its own frames.
  let buffer = Buffer.alloc(0)
  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 3) {
      const length = buffer.readUInt16BE(1)
      if (buffer.length < 3 + length) break
      const kind = buffer[0], payload = buffer.subarray(3, 3 + length)
      buffer = buffer.subarray(3 + length)
      if (kind === 0x10) {
        const now = Date.now()
        agentFrames.set(frameIndex, Buffer.concat([agentFrames.get(frameIndex) ?? Buffer.alloc(0), payload]))
        if (rms(payload) > 120) {
          if (!agentSpeaking || now - agentLoudAt > 600) agentStartedAt = now
          agentSpeaking = true
          agentLoudAt = now
        }
      } else if (kind === 0x00 || kind === 0xff) { closed = true }
    }
  })
  socket.on("close", () => { closed = true })
  socket.on("error", () => { closed = true })
  const id = Buffer.from(callId.replaceAll("-", ""), "hex")
  socket.write(Buffer.concat([Buffer.from([0x01, 0x00, 0x10]), id]))
  const t0 = Date.now()
  const pump = (async () => {
    while (!closed) {
      const due = t0 + frameIndex * FRAME_MS
      const wait = due - Date.now()
      if (wait > 0) await sleep(wait)
      let frame = Buffer.alloc(FRAME)
      if (tape.length) {
        const head = tape[0]
        frame = Buffer.from(head.subarray(0, FRAME))
        if (frame.length < FRAME) frame = Buffer.concat([frame, Buffer.alloc(FRAME - frame.length)])
        if (head.length > FRAME) tape[0] = head.subarray(FRAME)
        else tape.shift()
      }
      if (roomClips.length && !roomTape && frameIndex >= nextRoomFrame) {
        roomTape = roomClips[roomIndex++ % roomClips.length]
        roomSpans.push([frameIndex * FRAME_MS, frameIndex * FRAME_MS + (roomTape.length / FRAME) * FRAME_MS])
      }
      if (roomTape) {
        for (let i = 0; i < FRAME / 2 && i * 2 < roomTape.length; i++) {
          frame.writeInt16LE(Math.max(-32768, Math.min(32767, frame.readInt16LE(i * 2) + Math.round(roomTape.readInt16LE(i * 2) * ROOM_GAIN))), i * 2)
        }
        roomTape = roomTape.length > FRAME ? roomTape.subarray(FRAME) : null
        if (!roomTape) nextRoomFrame = frameIndex + 250 + Math.floor(Math.random() * 250)
      }
      if (noise) {
        const room = noiseFrame(noise, manner === "noisy")
        for (let i = 0; i < FRAME / 2; i++) frame.writeInt16LE(Math.max(-32768, Math.min(32767, frame.readInt16LE(i * 2) + room.readInt16LE(i * 2))), i * 2)
      }
      callerFrames.push(frame)
      if (!socket.destroyed) socket.write(Buffer.concat([Buffer.from([0x10, 0x01, 0x40]), frame]))
      frameIndex++
      if (agentSpeaking && Date.now() - agentLoudAt > 300) agentSpeaking = false
    }
  })()
  const quietFor = (ms: number) => !agentSpeaking && Date.now() - agentLoudAt >= ms
  // "Hə." after a barge-in (~0.4 s) is not the answer: a caller waits for a real one, 8 s at most.
  let lastPhraseEnd = 0
  const answeredFor = (ms: number) => quietFor(ms) && (agentLoudAt - agentStartedAt >= 900 || Date.now() - lastPhraseEnd > 8000)
  const phrases: PhraseResult[] = []
  let stopped: string | undefined
  try {
    // The greeting: the core speaks first.
    if (!(await until(() => closed || agentLoudAt > 0, 15_000))) notes.push("приветствия нет 15 с")
    for (const step of steps) {
      for (const phrase of step.phrases) {
        if (closed) break
        if (spent() >= opts.stopAt) { stopped = `бюджет: Live набрал $${spent().toFixed(3)} (порог $${opts.stopAt})`; break }
        const clip = speak(phrase.say, scenario.voice, opts.vertexKey, opts.cache)
        let pcm: Buffer = wavPcm(clip.file)
        if (manner === "pauses") pcm = withPauses(pcm, phrase.say, 800)
        // When to speak: after the assistant's reply in the manner of this call.
        let overlapped = false
        if (manner === "overlap") {
          const replyStart = agentStartedAt
          await until(() => closed || (agentSpeaking && Date.now() - agentStartedAt >= 1200) || quietFor(1500), 30_000)
          overlapped = agentSpeaking && agentStartedAt === replyStart
        } else {
          await until(() => closed || answeredFor(manner === "quick" ? 250 : 1000), 30_000)
        }
        const startedAt = Date.now()
        tape.push(pcm)
        await until(() => closed || tape.length === 0, 60_000)
        const endedAt = Date.now()
        lastPhraseEnd = endedAt
        const result: PhraseResult = { step: step.n, say: phrase.say, startedAt: startedAt - t0, endedAt: endedAt - t0, overlapped }
        phrases.push(result)
        // The reply: the assistant's first sound after the phrase, or 12 s of nothing.
        const heard = await until(() => closed || agentLoudAt > endedAt, 12_000)
        if (heard && agentLoudAt > endedAt) {
          result.replyAt = agentStartedAt - t0
          result.replyGapMs = Math.max(0, agentStartedAt - endedAt)
        } else if (closed) notes.push(`шаг ${step.n}: станция положила трубку после «${phrase.say}»`)
        else notes.push(`шаг ${step.n}: ассистент молчал 12 с после «${phrase.say}»`)
      }
      if (opts.dropAfterStep === step.n && !closed) {
        await until(() => closed || quietFor(1500), 20_000)
        core.drop()
        notes.push(`после шага ${step.n}: обрыв сессии Google по команде стенда, продление отклонено`)
      }
      if (opts.dropAfterStep === step.n && !closed) {
        await until(() => closed || quietFor(1500), 20_000)
        core.drop()
        notes.push(`после шага ${step.n}: обрыв сессии Google по команде стенда, продление отклонено`)
      }
      if (closed || stopped) break
    }
    if (!closed) await until(() => closed || quietFor(2500), 30_000)
  } finally {
    if (!socket.destroyed) socket.end(Buffer.from([0x00, 0x00, 0x00]))
    closed = true
    await pump
    socket.destroy()
  }
  if (stopped) notes.push(`звонок остановлен — ${stopped}`)
  const agentTrack = Buffer.alloc(callerFrames.length * FRAME)
  for (const [index, pcm] of agentFrames) pcm.copy(agentTrack, Math.min(index * FRAME, Math.max(0, agentTrack.length - pcm.length)))
  return { manner, callId, phrases, caller: Buffer.concat(callerFrames), agent: agentTrack, stopped, usd: spent(), notes, roomSpans }
}

/* ---------- the report ---------- */

type Options = { snapshot: string; core: string; builder?: string; station?: string; manners: Manner[]; steps?: number; scenario: string
  /** After this step's answer the stand drops the Google session and refuses its resumption (--drop-after-step). */
  dropAfterStep?: number
  stopAt: number; out: string; departedFrom?: string; standDir: string; vertexKey: string; secondEarKey?: string; cache: string }

function options(argv: string[]): Options {
  const value = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
  const snapshot = argv.find((arg, i) => !arg.startsWith("--") && !argv[i - 1]?.startsWith("--"))
  const core = value("--core")
  if (!snapshot || !core) throw new Error("usage: line-stand.ts <snapshot> --core <base core> [...]")
  const manners = (value("--manners") ?? MANNERS.join(",")).split(",").map((m) => m.trim()) as Manner[]
  for (const manner of manners) if (!MANNERS.includes(manner)) throw new Error(`unknown manner ${manner}`)
  const recordings = join(homedir(), "inbox", "zeytun-recordings")
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  return { snapshot, core, builder: value("--builder"), station: value("--station"), manners, steps: value("--steps") ? Number(value("--steps")) : undefined,
    dropAfterStep: value("--drop-after-step") ? Number(value("--drop-after-step")) : undefined,
    scenario: value("--scenario") ?? join(HERE, "voice-scenario.json"), stopAt: Number(value("--stop-at") ?? 0.6),
    out: value("--out") ?? join(recordings, "line-stand", stamp), departedFrom: value("--departed-from"),
    standDir: value("--stand-dir") ?? join(homedir(), ".cache", "zeytun-core-stand"),
    vertexKey: value("--vertex-key") ?? join(homedir(), ".config", "zeytun", "vertex-key"),
    secondEarKey: argv.includes("--no-second-ear") ? undefined : value("--second-ear-key") ?? join(homedir(), ".config", "zeytun", "speech-key"),
    cache: join(recordings, "caller") }
}

type Verdict = { manner: Manner; run: CallRun; heard: string[]; missed: string[]; searches: string[]; finalChecks: { label: string; ok: boolean }[]
  transcript: string[]; counters: Json; gaps: number[] }

function verdict(run: CallRun, scenario: Scenario, steps: Step[], crm: StandCrm, crmFrom: number, savesFrom: number, core: Core): Verdict {
  const result = crm.results.find((r) => JSON.stringify(r.body).includes(run.callId))
  const turns = ((result?.body.transcript ?? result?.body.turns ?? []) as { role?: string; speaker?: string; text?: string; content?: string }[])
  const transcript = turns.map((turn) => `${turn.role ?? turn.speaker ?? "?"}: ${turn.text ?? turn.content ?? ""}`)
  const callerText = foldLatin(turns.filter((turn) => !/assistant|agent|ai|model/i.test(String(turn.role ?? turn.speaker ?? ""))).map((turn) => turn.text ?? turn.content ?? "").join(" | "))
  const heard: string[] = [], missed: string[] = []
  for (const step of steps) for (const phrase of step.phrases) for (const rule of phrase.hear ?? []) {
    ;(new RegExp(rule.match, "iu").test(callerText) ? heard : missed).push(`шаг ${step.n}: ${rule.label}`)
  }
  const events = crm.events.slice(crmFrom)
  const searches = events.filter((e) => e.action === "search").map((e) => { const q = (e.body as Json).query as Json | string | undefined; return typeof q === "string" ? q : String((q as Json | undefined)?.text ?? JSON.stringify(q ?? e.body).slice(0, 80)) })
  const saves = crm.saves.slice(savesFrom)
  const last = [...saves].reverse().find((s) => s.final) ?? saves.at(-1)
  const lastSteps = steps.at(-1)?.n === scenario.steps.at(-1)?.n
  const finalChecks = lastSteps ? scenario.final.map((want) => ({ label: want.label, ok: !!last && last.lines.some((line, i) =>
    new RegExp(want.spoken, "u").test(`${line.spoken} ${last.products?.[i] ?? ""}`) && line.quantity === want.quantity) })) : []
  const mine = core.latency.filter((l) => l.call_id === run.callId)
  const probes = mine.filter((l) => l.event === "gemini_input_probe")
  const max = (key: string) => probes.reduce((m, p) => Math.max(m, Number(p[key] ?? 0)), 0)
  // A barge-in while the assistant spoke that came from the room's voice, not the caller.
  const callStart = mine.find((l) => l.event === "call_start")?.t
  const roomBarges = callStart === undefined ? 0 : mine.filter((l) => l.event === "gemini_barge_levels" && l.agent_speaking === true).filter((l) => {
    const at = l.t - callStart
    const caller = run.phrases.some((p) => at >= p.startedAt - 300 && at <= p.endedAt + 300)
    return !caller && run.roomSpans.some(([a, b]) => at >= a - 300 && at <= b + 600)
  }).length
  const counters = {
    "речь отброшена, пока ассистент «говорил» (кадры по 20 мс)": max("vetoed_while_agent_spoke"),
    "речь отброшена в тишине": max("vetoed_idle"),
    "перебивания (barge_in)": mine.filter((l) => l.event === "barge_in").length,
    "из них голосом комнаты": roomBarges,
    "фраз аптеки (zeytun_utterance)": mine.filter((l) => l.event === "zeytun_utterance").length,
    "сессия Google оборвалась/продлена": mine.filter((l) => /resume|realtime_error|fresh_recovery/.test(String(l.event))).length,
  }
  const gaps = run.phrases.map((p) => p.replyGapMs).filter((g): g is number => g !== undefined)
  return { manner: run.manner, run, heard, missed, searches, finalChecks, transcript, counters, gaps }
}

const MANNER_TEXT: Record<Manner, string> = {
  polite: "вежливо: через 1 с после ассистента", quick: "быстро: через 0,25 с после ассистента",
  overlap: "внахлёст: пока ассистент ещё говорит", pauses: "с паузами 0,8 с на запятых", noisy: "в шумной комнате",
  room: "в комнате, где рядом говорят",
}
const pct = (values: number[], p: number) => {
  if (!values.length) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

function report(verdicts: Verdict[], meta: Json) {
  const lines = [`# Стенд линии: настоящее ядро станции, звонящий как человек`, "",
    `Main \`${meta.sha}\`, ядро ${meta.builder}, станция ${meta.station}, снимок каталога ${meta.snapshotAt}, шагов ${meta.steps}.`, "",
    "| Манера | Услышано | Не услышано | Отброшено речи при «говорит» / в тишине | Ответ после фразы, медиана / макс | Итоговый заказ | $ |", "|---|---|---|---|---|---|---|"]
  for (const v of verdicts) {
    const c = v.counters as Record<string, number>
    const finals = v.finalChecks.length ? `${v.finalChecks.filter((f) => f.ok).length}/${v.finalChecks.length}` : "—"
    lines.push(`| ${MANNER_TEXT[v.manner]} | ${v.heard.length} | ${v.missed.length} | ${Object.values(c)[0]} / ${Object.values(c)[1]} | ${(pct(v.gaps, 0.5) / 1000).toFixed(1)} / ${(Math.max(...v.gaps, 0) / 1000).toFixed(1)} с | ${finals} | ${v.run.usd.toFixed(2)} |`)
  }
  for (const v of verdicts) {
    lines.push("", `## ${MANNER_TEXT[v.manner]}`, "", `Запись: \`${v.manner}.wav\` (слева аптека, справа линия).`, "")
    if (v.missed.length) lines.push("**Не услышано:** " + v.missed.join("; "), "")
    if (v.run.notes.length) lines.push(...v.run.notes.map((n) => `- ${n}`), "")
    if (v.finalChecks.some((f) => !f.ok)) lines.push("**Нет в итоговом заказе:** " + v.finalChecks.filter((f) => !f.ok).map((f) => f.label).join("; "), "")
    lines.push("Счётчики станции: " + Object.entries(v.counters).map(([k, n]) => `${k} — ${n}`).join("; "), "")
    lines.push("Поиски: " + (v.searches.join(" · ") || "нет"), "")
    lines.push("| Шаг | Фраза | Начало, с | Ответ через, с |", "|---|---|---|---|")
    for (const p of v.run.phrases) lines.push(`| ${p.step} | ${p.say}${p.overlapped ? " (внахлёст)" : ""} | ${(p.startedAt / 1000).toFixed(1)} | ${p.replyGapMs === undefined ? "—" : (p.replyGapMs / 1000).toFixed(1)} |`)
    lines.push("", "Расшифровка станции:", "", ...v.transcript.map((t) => `> ${t}`))
  }
  return lines.join("\n") + "\n"
}

async function main() {
  console.log = (...args: unknown[]) => process.stderr.write(`${args.map(String).join(" ")}\n`)
  const opts = options(process.argv.slice(2))
  const scenario = JSON.parse(readFileSync(opts.scenario, "utf8")) as Scenario
  const steps = opts.steps ? scenario.steps.slice(0, opts.steps) : scenario.steps
  for (const need of [join(opts.standDir, "silero-vad.onnx"), join(opts.standDir, "vendor"), opts.vertexKey]) {
    if (!existsSync(need)) throw new Error(`missing ${need} (see the header of line-stand-core.py)`)
  }
  mkdirSync(opts.out, { recursive: true, mode: 0o700 })
  const work = join(opts.out, ".work")
  mkdirSync(join(work, "spool"), { recursive: true, mode: 0o700 })
  const { catalog, snapshotAt } = await loadCatalog(opts.snapshot, opts.departedFrom)
  const saves: Save[] = []
  const crm = new StandCrm(catalog, saves, opts.secondEarKey, certificates(work))
  const proxyPort = await crm.listen()
  const corePort = 20000 + Math.floor(Math.random() * 20000)
  const core = new Core(["--source", opts.core, "--port", String(corePort), "--vendor", join(opts.standDir, "vendor"),
    "--silero", join(opts.standDir, "silero-vad.onnx"), "--spool", join(work, "spool"), "--tts-key", opts.vertexKey,
    "--tts-project", TTS_PROJECT, "--proxy", `http://127.0.0.1:${proxyPort}`, "--ca-bundle", join(work, "bundle.pem"),
    ...(opts.builder ? ["--builder", opts.builder] : []), ...(opts.station ? ["--station", opts.station] : [])], { ...process.env, PYTHONUNBUFFERED: "1" })
  const verdicts: Verdict[] = []
  try {
    const ready = await core.ready
    crm.policy = ready.policy
    for (const manner of opts.manners) {
      process.stderr.write(`call: ${manner}\n`)
      const crmFrom = crm.events.length, savesFrom = saves.length
      const run = await playCall(scenario, steps, manner, ready.ready, core, opts)
      await until(() => crm.results.some((r) => JSON.stringify(r.body).includes(run.callId)), 20_000)
      writeFileSync(join(opts.out, `${manner}.wav`), stereoWav(run.caller, run.agent), { mode: 0o600 })
      const v = verdict(run, scenario, steps, crm, crmFrom, savesFrom, core)
      verdicts.push(v)
      writeFileSync(join(opts.out, `${manner}.json`), JSON.stringify({ ...v, run: { ...run, caller: undefined, agent: undefined },
        crm: crm.events.slice(crmFrom).filter((e) => e.action !== "utterance"),
        latency: core.latency.filter((l) => l.call_id === run.callId) }, null, 1), { mode: 0o600 })
      if (run.stopped && /квот|money|402|429/i.test(run.stopped)) break
      await sleep(3000)
    }
  } finally {
    core.close()
    crm.close()
    writeFileSync(join(opts.out, "core.log"), core.log.join("\n") + "\n", { mode: 0o600 })
  }
  if (crm.unknown.length) process.stderr.write(`requests the stand did not answer: ${[...new Set(crm.unknown)].join(", ")}\n`)
  if (core.relay.length) process.stderr.write(`relay: ${core.relay.join(" ")}\n`)
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: HERE }).toString().trim()
  const file = join(opts.out, "report.md")
  writeFileSync(file, report(verdicts, { sha, snapshotAt, steps: steps.length, builder: opts.builder ?? "этой ветки", station: opts.station ?? "этой ветки" }), { mode: 0o600 })
  process.stderr.write(`report: ${file}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
