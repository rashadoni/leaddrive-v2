/**
 * Chain stand of the phone line (plan task 11, «Дешёвая цепочка»; owner
 * 2026-11-04: «давай» on the experiment, the decision only by the stand's
 * numbers). The line today is gemini-3.8-live: every answer bills the whole
 * context again, the call's audio included (≈ $0.63 for the 2.8-minute
 * presentation call of voice-stand.ts). Here the same conversations go through
 * a chain of per-request models instead, with no call and no station:
 *
 *   caller's phrase (the voice stand's own audio: Vertex TTS, trunk-made 8 kHz µ-law)
 *     → ear:  --ear chirp  Chirp 3 (eu, az-AZ, the products the line has written as hints) → text
 *             --ear audio  the phrase itself as inline audio to the model, Chirp as the CRM's
 *                          second ear (alsoHeard), exactly as on the line since #1320
 *     → a text Gemini (--model gemini-3.8-flash | gemini-3.5-flash-lite) on Vertex, streamed,
 *       with the line's own prompt (the CRM's session answer), the station's tool
 *       declarations and the station's bridge in front of the CRM's handler on a
 *       catalog snapshot (stand-crm.ts, as in the dialog and voice stands); the
 *       prompt and tools are a fixed prefix, so Vertex's implicit cache bills them
 *       at a tenth on every request after the first;
 *     → the reply's first clip, as the station's relay would cut it, to the line's
 *       TTS (gemini-3.8-flash-tts, Sulafat, the line's style): only --tts-probe N
 *       replies are voiced (chain-tts-probe.py), to measure the first sound.
 *
 * Measured per phrase: the delay from the phrase's last sound to the first tool
 * call / first word / first clip of the reply (the station's 0.65 s of end
 * silence included, as in the voice stand), what the ear heard, and the price of
 * every request by its usageMetadata. Checked (--set):
 *  - voice:    the voice stand's presentation call (voice-scenario.json: steps, hearing, final order);
 *  - dialogs:  the dialog stand's scenarios (dialog-scenarios.json, the same checks as dialog-stand.ts);
 *  - segments: the owner's real phrases of task 6 (--labels ~/inbox/zeytun-recordings/segments/labels.jsonl),
 *              each alone after a named pharmacy: is each named product among the candidates of the
 *              model's lookups (the five and alsoHeard), first, saved. --segment-lead S cuts each phrase
 *              again from its call's recording (calls.tsv, call-<id>.wav next to segments/) with S s before it.
 *
 * What is not real: the stubs of stand-crm.ts (order writer, cancel, transfer);
 * the caller's voice is a TTS voice, cleaner than a pharmacy; the pharmacy
 * speaks its script and the dialog scenarios their scripted turns; the chain's
 * end of a phrase is the station's 0.65 s of silence, as today.
 *
 *   JITI_ALIAS='{"@":"'$PWD'/src"}' node_modules/.bin/jiti scripts/zeytun-line/chain-stand.ts <snapshot> \
 *     --departed-from <older snapshot> [--ear chirp|audio] [--model gemini-3.8-flash] [--thinking low]
 *     [--set voice,dialogs,segments] [--only id,id] [--segment-lead 0.6] [--hints ordered|none] [--ordered ~/inbox/zeytun-recordings/ordered-products.txt]
 *     [--tts-probe 0] [--max-usd 1] [--out ~/inbox/zeytun-recordings/chain-stand/<time>]
 *     [--vertex-key ~/.config/zeytun/vertex-key] [--speech-key ~/.config/zeytun/speech-key] [--voice Charon]
 *
 * Money: the model, Chirp and the TTS bill the line's own Google project. A
 * dialog run of one scenario set is a few US cents (the stand prints its
 * estimate as it goes) and stops at --max-usd. The snapshot, the audio and the
 * transcripts are the client's and the owner's: the output goes to ~/inbox,
 * never into Git. Keys are read from their files and never printed.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { ZEYTUN_INBOUND_SPEECH, type InboundPilotCatalog } from "../../src/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { createChirpRecognizer, createZeytunSecondEar, wavFromPcm16, type ChirpRecognizer } from "../../src/lib/voice-agent/pharmacy/zeytun-chirp"
import { learnNames, spokenProductName, type LearnedNames } from "../../src/lib/voice-agent/pharmacy/zeytun-learned-names"
import { crmFor, foldLatin, historyFor, loadCatalog, StationBridge, type Json, type Save } from "./stand-crm"
import { check, nextSay, quote, toolLine, type CheckResult, type DialogEvent, type Scenario } from "./stand-checks"

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = "gen-lang-client-0496964632"
/** The station's end-of-phrase silence before activityEnd (voice-live-remote.py END_SILENCE_S): on the line the chain starts here. */
const END_SILENCE_S = 0.65

/**
 * USD per 1M tokens, Standard, aistudio.google.com/docs/pricing (read 2026-11-04). The 3.8 prices are
 * introductory "through Dec 31 2026" and double on 2027-01-01 (gemini-3.8-flash $1.50 / $7.50 / $0.15).
 * The page gives 3.8 Flash one input price for every modality; Flash-Lite lists audio with text.
 */
const MODEL_PRICE: Record<string, { input: number; cached: number; output: number }> = {
  "gemini-3.8-flash": { input: 0.75, cached: 0.075, output: 3.75 },
  "gemini-3.5-flash-lite": { input: 0.30, cached: 0.03, output: 2.50 },
}
/** Chirp 3, Speech-to-Text V2 standard: $0.016 a minute (cloud.google.com/speech-to-text/pricing via search, 2026-11-04), billed here by the started second. */
const CHIRP_PER_MIN = 0.016
/** gemini-3.8-flash-tts: $0.50 text in, $9.00 audio out per 1M tokens (third-party trackers, 2026-11-04); 25 audio tokens a second. */
const TTS_PRICE = { input: 0.5, audioOut: 9, audioTokensPerS: 25 }
/** Seconds of TTS audio a character of speakable text, when no reply was voiced in this run: 12 first clips, Sulafat on Vertex,
 * 2026-11-04 (56.8 s for 472 characters, the clip's own lead and tail silence included). */
const DEFAULT_S_PER_CHAR = 0.12

type Usage = { promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number
  promptTokensDetails?: { modality?: string; tokenCount?: number }[] }

function requestCost(model: string, usage: Usage) {
  const price = MODEL_PRICE[model] ?? MODEL_PRICE["gemini-3.8-flash"]
  const prompt = usage.promptTokenCount ?? 0, cached = Math.min(prompt, usage.cachedContentTokenCount ?? 0)
  const output = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)
  const audio = (usage.promptTokensDetails ?? []).filter((d) => d.modality === "AUDIO").reduce((sum, d) => sum + (d.tokenCount ?? 0), 0)
  return { prompt, cached, output, audio, usd: ((prompt - cached) * price.input + cached * price.cached + output * price.output) / 1e6 }
}

/* ---------- the model on Vertex, streamed ---------- */

type Generation = { ms: number; parts: Json[]; usage: Usage; error?: string; retries: number
  /** ms from the request: first chunk with words, first function call; each chunk's words as they came. */
  firstText?: number; firstCall?: number; chunks: { ms: number; text: string }[] }

class Vertex {
  private key: string
  requests = 0
  constructor(keyFile: string) { this.key = readFileSync(keyFile, "utf8").trim() }
  url(model: string) {
    return `https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/global/publishers/google/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.key)}`
  }
  async stream(model: string, body: Json): Promise<Generation> {
    for (let attempt = 0; ; attempt++) {
      const result = await this.once(model, body)
      // One retry on capacity or a server error; anything else is the answer.
      if (!result.error || attempt > 0 || !/^http (429|5\d\d)/.test(result.error)) return { ...result, retries: attempt }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }
  private async once(model: string, body: Json): Promise<Omit<Generation, "retries">> {
    this.requests++
    const started = performance.now(), at = () => Math.round(performance.now() - started)
    const parts: Json[] = [], chunks: { ms: number; text: string }[] = []
    let usage: Usage = {}, firstText: number | undefined, firstCall: number | undefined
    try {
      const response = await fetch(this.url(model), { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) })
      if (!response.ok || !response.body) {
        const detail = (await response.text().catch(() => "")).replaceAll(this.key, "KEY").slice(0, 300)
        return { ms: at(), parts, usage, chunks, error: `http ${response.status}: ${detail}` }
      }
      const decoder = new TextDecoder()
      let buffer = ""
      for await (const piece of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(piece, { stream: true })
        let newline: number
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (!line.startsWith("data:")) continue
          const chunk = JSON.parse(line.slice(5)) as { candidates?: { content?: { parts?: Json[] } }[]; usageMetadata?: Usage; error?: { message?: string } }
          if (chunk.error) return { ms: at(), parts, usage, chunks, error: `stream: ${String(chunk.error.message ?? "").slice(0, 200)}` }
          if (chunk.usageMetadata) usage = chunk.usageMetadata
          let words = ""
          for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
            if (part.functionCall && firstCall === undefined) firstCall = at()
            const plain = typeof part.text === "string" && !part.thought && !part.functionCall
            if (plain && (part.text as string).trim()) { words += part.text as string; firstText ??= at() }
            const last = parts.at(-1)
            // Streamed words come in pieces: one part again, the signature (if any) on it, as the model would have sent it whole.
            if (plain && last && typeof last.text === "string" && !last.thought && !last.functionCall) {
              last.text = `${last.text as string}${part.text as string}`
              if (part.thoughtSignature) last.thoughtSignature = part.thoughtSignature
            } else parts.push({ ...part })
          }
          if (words) chunks.push({ ms: at(), text: words })
        }
      }
      return { ms: at(), parts, usage, chunks, firstText, firstCall }
    } catch (error) {
      return { ms: at(), parts, usage, chunks, error: (error as Error)?.name === "TimeoutError" ? "timeout" : `network: ${(error as Error).message}` }
    }
  }
}

/** When the station's relay would send the first clip of these words to the TTS: a sentence end from 12 characters, or a clause break from 24 (ZeytunSpeechRelay). */
function firstClipAt(chunks: { at: number; text: string }[]) {
  let text = ""
  for (const chunk of chunks) {
    text += chunk.text
    const sentence = /[.!?…](\s|$)/u.exec(text.slice(12))
    const clause = /[,;:—–](\s|$)/u.exec(text.slice(24))
    if (sentence || clause) return { at: chunk.at, text: text.slice(0, (sentence ? 12 + sentence.index + 1 : 24 + clause!.index + 1)).trim() }
  }
  return chunks.length ? { at: chunks.at(-1)!.at, text: text.trim() } : undefined
}

/* ---------- the caller's audio ---------- */

function speak(text: string, voice: string, vertexKey: string, cache: string) {
  const out = execFileSync("python3", ["-I", "-W", "ignore", join(HERE, "voice-caller-tts.py"), vertexKey, cache, voice, text]).toString()
  return JSON.parse(out) as { file: string; speech_s: number; cached: boolean }
}
const wavPcm = (file: string) => {
  const raw = readFileSync(file)
  return raw.subarray(raw.indexOf("data") + 8)
}

/* ---------- one conversation ---------- */

type Declarations = { functionDeclarations: Json[] }[]
type Options = { ear: "chirp" | "audio"; model: string; thinking: string; declarations: Declarations; voice: string; vertexKey: string
  cache: string; speechKey: string; hints: string[]; learned?: LearnedNames; maxUsd: number }

type Request = { ms: number; firstText?: number; firstCall?: number; prompt: number; cached: number; output: number; audio: number; usd: number; error?: string; retries: number }
type ChainTurn = { say: string; heard?: string; chirpMs?: number; chirpS: number; speechS: number; newClip: boolean
  requests: Request[]; toolMs: number; said: string; firstClip?: string
  /** s from the phrase's last sound (END_SILENCE_S included): first tool call or word; first word; first clip ready for the TTS. */
  action?: number; word?: number; clip?: number; notes: string[] }

/** Spend of the whole run (all conversations), for --max-usd. */
const spend = { model: 0, chirp: 0, chirpS: 0, newClips: 0 }

class OverBudget extends Error {}

/** `files`: the caller's audio of each turn, by index, instead of the TTS voice (the segments of real calls).
 * `prelude`: a text exchange after the opening, before the turns (a segment's call has named its pharmacy already). */
async function playConversation(turns: Scenario["turns"], catalog: InboundPilotCatalog, vertex: Vertex, chirp: ChirpRecognizer,
  options: Options, history?: Scenario["history"], files?: string[], prelude?: { caller: string; assistant: string }) {
  const saves: Save[] = []
  const events: DialogEvent[] = []
  const chain: ChainTurn[] = []
  let current: ChainTurn | undefined, heardNow: Promise<string | undefined> | undefined
  // The CRM's second ear (--ear audio) hears through this wrapper: the turn learns what Chirp heard.
  const recognizer: ChirpRecognizer = { enabled: () => chirp.enabled(), warm: () => chirp.warm(),
    recognize: async (pcm, phrases) => {
      const turn = current
      const heard = await chirp.recognize(pcm, phrases)
      if (turn) { turn.heard = "text" in heard ? heard.text : `(ошибка ${heard.error})`; turn.chirpMs = heard.ms }
      return heard
    } }
  const secondEar = options.ear === "audio" ? createZeytunSecondEar({ recognizer }) : undefined
  const bridge = new StationBridge(crmFor(catalog, saves, history && historyFor(catalog, history), secondEar, options.learned))
  try {
    const session = await bridge.op<{ prompt: string; opening: string; closing: string | null; standUtterances?: boolean }>({ op: "open" })
    if (options.ear === "audio" && session.standUtterances !== true) throw new Error("the CRM did not turn the second ear on (speech key?)")
    const closing = session.closing ?? "Sağ olun, xoş günlər!"
    // The station speaks the CRM's opening itself: the model's first turn, as in the dialog stand.
    const contents: Json[] = [{ role: "user", parts: [{ text: "(zəng qoşuldu)" }] }, { role: "model", parts: [{ text: session.opening }] }]
    events.push({ kind: "assistant", text: session.opening })
    let lastReply = session.opening
    if (prelude) {
      contents.push({ role: "user", parts: [{ text: prelude.caller }] }, { role: "model", parts: [{ text: prelude.assistant }] })
      events.push({ kind: "note", text: `до фразы (текстом): «${prelude.caller}» → «${prelude.assistant}»` })
      lastReply = prelude.assistant
    }
    for (const turn of turns) {
      if (lastReply.includes(closing)) break
      if (spend.model + spend.chirp > options.maxUsd) throw new OverBudget(`--max-usd ${options.maxUsd} reached`)
      const say = nextSay(turn, lastReply)
      const own = files?.[chain.length]
      const clip = own ? { file: own, speech_s: (readFileSync(own).length - 44) / 16000, cached: true } : speak(say, options.voice, options.vertexKey, options.cache)
      if (!clip.cached) spend.newClips++
      const pcm = wavPcm(clip.file)
      const chirpS = Math.ceil(pcm.length / 2 / 8000 + END_SILENCE_S)
      current = { say, chirpS, speechS: clip.speech_s, newClip: !clip.cached, requests: [], toolMs: 0, said: "", notes: [] }
      const me = current
      chain.push(me)
      const t0 = performance.now(), since = () => (performance.now() - t0) / 1000 + END_SILENCE_S
      let userParts: Json[]
      spend.chirp += chirpS * CHIRP_PER_MIN / 60
      spend.chirpS += chirpS
      if (options.ear === "chirp") {
        // The whole phrase, from the clip's first frame: the chain owns the audio, nothing is cut before the voice.
        const heard = await recognizer.recognize(Buffer.concat([pcm, Buffer.alloc(Math.round(END_SILENCE_S * 8000) * 2)]), options.hints)
        const text = "text" in heard ? heard.text.trim() : ""
        if (!text) me.notes.push(`Chirp ничего не дал (${"error" in heard ? heard.error : "пусто"})`)
        userParts = [{ text: text || "(aptek nəsə dedi, eşidilmədi)" }]
        heardNow = Promise.resolve(text)
      } else {
        // The phrase as the station's core hands it to the bridge, whole: the 20 ms frame, then the rest and the end silence.
        void bridge.op({ op: "utterance", first: pcm.subarray(0, 320).toString("base64"),
          rest: Buffer.concat([pcm.subarray(320), Buffer.alloc(Math.round(END_SILENCE_S * 8000) * 2)]).toString("base64") }).catch(() => undefined)
        userParts = [{ inlineData: { mimeType: "audio/wav", data: wavFromPcm16(pcm).toString("base64") } }]
        heardNow = (async () => { const end = Date.now() + 3000
          while (me.heard === undefined && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 25))
          return me.heard })()
      }
      events.push({ kind: "caller", text: say, heard: options.ear === "chirp" ? String(userParts[0].text) : undefined })
      contents.push({ role: "user", parts: userParts })
      // The station's transcript of the caller (its cancel check reads it): what the chain heard.
      const noted = heardNow.then((text) => bridge.op({ op: "note", content: { inputTranscription: { text: text ?? "" } } }))
      const words: { at: number; text: string }[] = []
      for (let step = 0; step < 8; step++) {
        const startedAt = since()
        const answer = await vertex.stream(options.model, {
          systemInstruction: { parts: [{ text: session.prompt }] },
          contents, tools: options.declarations,
          generationConfig: { thinkingConfig: { thinkingLevel: options.thinking } },
        })
        const cost = requestCost(options.model, answer.usage)
        spend.model += cost.usd
        me.requests.push({ ms: answer.ms, firstText: answer.firstText, firstCall: answer.firstCall, prompt: cost.prompt, cached: cost.cached,
          output: cost.output, audio: cost.audio, usd: cost.usd, error: answer.error, retries: answer.retries })
        if (answer.error) { me.notes.push(`модель: ${answer.error}`); events.push({ kind: "note", text: `модель: ${answer.error}` }); break }
        if (answer.firstCall !== undefined) me.action ??= startedAt + answer.firstCall / 1000
        if (answer.firstText !== undefined) {
          me.action = Math.min(me.action ?? Infinity, startedAt + answer.firstText / 1000)
          me.word ??= startedAt + answer.firstText / 1000
        }
        for (const chunk of answer.chunks) words.push({ at: startedAt + chunk.ms / 1000, text: chunk.text })
        const parts = answer.parts
        contents.push({ role: "model", parts })
        const text = parts.filter((part) => typeof part.text === "string" && !part.thought).map((part) => part.text as string).join("").trim()
        if (text) {
          me.said = `${me.said} ${text}`.trim()
          events.push({ kind: "assistant", text })
          await bridge.op({ op: "note", content: { modelTurn: { parts: [{ text }] } } })
        }
        const calls = parts.filter((part) => part.functionCall).map((part, index) => {
          const call = part.functionCall as { id?: string; name: string; args?: Json }
          return { id: call.id ?? `call-${contents.length}-${index}`, name: call.name, args: call.args ?? {}, own: call.id }
        })
        if (!calls.length) break
        await noted
        const toolStart = performance.now()
        const results = await bridge.op<{ id: string; name: string; response: Json }[]>({ op: "tools", calls: calls.map(({ id, name, args }) => ({ id, name, args })) })
        me.toolMs += performance.now() - toolStart
        const responses = calls.map((call) => {
          const result = results.find((item) => item.id === call.id)?.response ?? { status: "no_response" }
          events.push({ kind: "tool", name: call.name, args: call.args, result })
          return { functionResponse: { name: call.name, ...(call.own ? { id: call.own } : {}), response: result } }
        })
        contents.push({ role: "user", parts: responses })
      }
      await noted
      await bridge.op({ op: "note", content: { turnComplete: true } })
      const clipReady = firstClipAt(words)
      if (clipReady) { me.clip = clipReady.at; me.firstClip = clipReady.text }
      lastReply = me.said
    }
    // The caller checks the conversation against its scenario; the bridge answers the language checks until the run ends.
    return { events, saves, chain, run: (scenario: Scenario) => check(scenario, events, saves, bridge) }
  } finally {
    current = undefined
    pendingClose.push(bridge)
  }
}
const pendingClose: StationBridge[] = []

/* ---------- the voice stand's presentation call ---------- */

type Rule = { match: string; label: string }
type Expect = { tools?: { name: string; args?: string; label: string }[]; reply?: Rule[]; noReply?: Rule[] }
type VoiceScenario = { voice: string; steps: { n: number; phrases: { say: string; hear?: Rule[]; expect?: Expect }[]; expect: Expect }[]
  final: { spoken: string; quantity: number; label: string }[] }

/** What of `expect` the turns' answers missed (voice-stand.ts unmet, over the chain's events of those turns). */
function unmet(expect: Expect | undefined, said: string, tools: { name: string; args: Json }[]) {
  const misses: string[] = []
  for (const want of expect?.tools ?? []) if (!tools.some((tool) => tool.name === want.name && (!want.args || new RegExp(want.args, "iu").test(JSON.stringify(tool.args))))) misses.push(want.label)
  for (const want of expect?.reply ?? []) if (!new RegExp(want.match, "iu").test(said)) misses.push(want.label)
  for (const want of expect?.noReply ?? []) if (new RegExp(want.match, "iu").test(said)) misses.push(want.label)
  return misses
}

function voiceVerdicts(scenario: VoiceScenario, events: DialogEvent[], chain: ChainTurn[], saves: Save[]) {
  // The events of each caller turn: from it to the next caller turn.
  const perTurn: { said: string; tools: { name: string; args: Json }[] }[] = []
  for (const event of events.slice(1)) {
    if (event.kind === "caller") perTurn.push({ said: "", tools: [] })
    else if (event.kind === "assistant" && perTurn.length) perTurn.at(-1)!.said += ` ${event.text}`
    else if (event.kind === "tool" && perTurn.length) perTurn.at(-1)!.tools.push(event)
  }
  let index = 0
  const steps = scenario.steps.map((step) => {
    const mine = step.phrases.map((phrase) => ({ phrase, turn: perTurn[index], chain: chain[index++] }))
    const all = { said: mine.map((m) => m.turn?.said ?? "").join(" "), tools: mine.flatMap((m) => m.turn?.tools ?? []) }
    const misses = [...unmet(step.expect, all.said, all.tools), ...mine.flatMap((m) => unmet(m.phrase.expect, m.turn?.said ?? "", m.turn?.tools ?? []))]
    // A phrase the call never reached (the assistant said goodbye first) is not misheard; a step none of whose phrases came is not understood.
    const hearing = mine.filter((m) => m.chain).flatMap((m) => (m.phrase.hear ?? []).filter((rule) => !new RegExp(rule.match, "iu").test(foldLatin(m.chain?.heard ?? "")))
      .map((rule) => ({ word: rule.label, heard: m.chain?.heard ?? "" })))
    const unreached = mine.filter((m) => !m.turn).map((m) => `не прозвучала (разговор закрыт): «${m.phrase.say}»`)
    return { n: step.n, says: step.phrases.map((p) => p.say), ok: misses.length === 0 && mine.some((m) => m.turn), misses: [...misses, ...unreached], hearing }
  })
  const last = [...saves].reverse().find((save) => save.final) ?? saves.at(-1)
  const rows = (last?.lines ?? []).map((line, i) => ({ spoken: line.spoken, quantity: line.quantity, product: last?.products?.[i] ?? "не найден" }))
  const final = scenario.final.map((want) => ({ label: want.label,
    ok: rows.some((row) => new RegExp(want.spoken, "u").test(`${row.spoken} ${row.product}`) && row.quantity === want.quantity) }))
  final.push({ label: "итоговое сохранение (final)", ok: saves.some((save) => save.final) })
  return { steps, final, rows }
}

/* ---------- numbers ---------- */

const median = (values: number[]) => quantile(values, 0.5)
function quantile(values: number[], q: number) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!sorted.length) return NaN
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]
}
const s = (value: number | undefined) => value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(2)
const usd = (value: number) => `$${value.toFixed(4)}`

/** A conversation's length on the line: the caller's speech, the end silence, the reply's delay and its speech. */
function conversationSeconds(chain: ChainTurn[], sPerChar: number, opening: string) {
  return opening.length * sPerChar + chain.reduce((sum, turn) => sum + turn.speechS + END_SILENCE_S + (turn.clip ?? turn.word ?? 0) - END_SILENCE_S
    + turn.said.length * sPerChar + 0.5, 0)
}

function ttsCost(chars: number, sPerChar: number) {
  return chars / 4 * TTS_PRICE.input / 1e6 + chars * sPerChar * TTS_PRICE.audioTokensPerS * TTS_PRICE.audioOut / 1e6
}

/* ---------- main ---------- */

type Conversation = { kind: "voice" | "dialog" | "segment"; id: string; title: string; events: DialogEvent[]; chain: ChainTurn[]; saves: Save[]
  checks?: CheckResult[]; voice?: ReturnType<typeof voiceVerdicts>; segment?: SegmentVerdict; expectedFail?: string; error?: string }

/* ---------- phrases of real calls (task 6's set) ---------- */

/** One phrase of labels.jsonl (cut-caller-phrases.py, recognizer-benchmark.ts): the products the caller named, by externalId. */
type Label = { file: string; call: string; said: string; expected: string[]; expectedNames?: string[]; heardByModel?: string | string[]; use?: boolean }
/** Per expected product: in a search's candidates (the five and alsoHeard), first of a search, in the save; on a phrase without one, whether the model looked a product up. */
type SegmentVerdict = { expected: number; inFive: number; first: number; saved: number; falseLookup: boolean }

function segmentVerdict(label: Label, events: DialogEvent[]): SegmentVerdict {
  const tools = events.filter((event): event is Extract<DialogEvent, { kind: "tool" }> => event.kind === "tool")
  const searches = tools.filter((tool) => tool.name === "search_pharmacy_catalog" && !/^\s*(history|promotions)\s*:/iu.test(String(tool.args.text ?? "")))
  const lists = searches.map((tool) => ((tool.result.candidates ?? []) as { externalId?: string }[]).map((item) => item.externalId))
  const saved = tools.filter((tool) => tool.name === "save_order_list").flatMap((tool) => ((tool.args.lines ?? []) as { externalId?: string }[]).map((line) => line.externalId))
  return { expected: label.expected.length,
    inFive: label.expected.filter((id) => lists.some((list) => list.includes(id))).length,
    first: label.expected.filter((id) => lists.some((list) => list[0] === id)).length,
    saved: label.expected.filter((id) => saved.includes(id)).length,
    falseLookup: label.expected.length === 0 && searches.some((tool) => !/^\s*substitute\s*:/iu.test(String(tool.args.text ?? ""))) }
}

function flags(argv: string[]) {
  const [snapshot, ...rest] = argv
  const out: Record<string, string> = {}
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith("--")) out[rest[i].slice(2)] = rest[i + 1]?.startsWith("--") ? "1" : rest[++i] ?? "1"
  if (!snapshot) throw new Error("usage: chain-stand.ts <snapshot> --departed-from <older> [--ear chirp|audio] [--model …] [--set voice,dialogs]")
  return { snapshot, flags: out }
}

function hintList(catalog: InboundPilotCatalog, ordered: string[]) {
  // As the CRM's chirpHints: the products the line wrote, most often first, as a caller says them.
  const names = new Set<string>()
  for (const id of ordered) {
    const item = catalog.search({ externalId: id }).candidates[0]
    const name = item && spokenProductName(item)
    if (name) names.add(name)
  }
  return [...names].slice(0, 1000)
}

async function main() {
  console.log = (...args: unknown[]) => console.error(...args)
  const { snapshot, flags: f } = flags(process.argv.slice(2))
  const ear = (f.ear ?? "chirp") as Options["ear"]
  if (ear !== "chirp" && ear !== "audio") throw new Error("--ear chirp|audio")
  const model = f.model ?? "gemini-3.8-flash", thinking = f.thinking ?? "low"
  if (!MODEL_PRICE[model]) throw new Error(`no price for ${model}: add it to MODEL_PRICE first`)
  const sets = (f.set ?? "voice,dialogs").split(",")
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")
  const outDir = resolve(f.out ?? join(homedir(), "inbox", "zeytun-recordings", "chain-stand", `${stamp}-${ear}-${model}`))
  const repo = realpathSync(join(HERE, "..", ".."))
  if (`${outDir}/`.startsWith(`${repo}/`)) throw new Error(`refusing to write transcripts inside the repository: ${outDir}`)
  mkdirSync(outDir, { recursive: true })
  const vertexKey = f["vertex-key"] ?? join(homedir(), ".config", "zeytun", "vertex-key")
  const speechKey = f["speech-key"] ?? join(homedir(), ".config", "zeytun", "speech-key")
  const declarations = JSON.parse(readFileSync(join(HERE, "station-tool-declarations.json"), "utf8")) as Declarations
  const { catalog, snapshotAt, soldOut } = await loadCatalog(snapshot, f["departed-from"])
  const orderedFile = f.ordered ?? join(homedir(), "inbox", "zeytun-recordings", "ordered-products.txt")
  const ordered = (f.hints ?? "ordered") === "none" ? [] : readFileSync(orderedFile, "utf8").split("\n").filter(Boolean)
    .flatMap((line) => { const [id, count] = line.split("|"); return Array<string>(Number(count) || 1).fill(id) })
  const learned = ordered.length ? learnNames([], ordered) : undefined
  const hints = hintList(catalog, learned?.ordered(2000) ?? [])
  const chirp = createChirpRecognizer({ keyFile: speechKey })
  if (!(await chirp.enabled())) throw new Error(`no usable Chirp key at ${speechKey}`)
  chirp.warm()
  const vertex = new Vertex(vertexKey)
  const options: Options = { ear, model, thinking, declarations, voice: f.voice ?? "Charon", vertexKey,
    cache: f.cache ?? join(homedir(), "inbox", "zeytun-recordings", "voice-stand", "caller"), speechKey, hints, learned, maxUsd: Number(f["max-usd"] ?? 1) }
  process.stderr.write(`ear ${ear}, model ${model}, thinking ${thinking}, hints ${hints.length}, sold out ${soldOut}\n`)

  const conversations: Conversation[] = []
  const play = async (kind: Conversation["kind"], id: string, title: string, turns: Scenario["turns"], history?: Scenario["history"], files?: string[],
    prelude?: { caller: string; assistant: string }) => {
    process.stderr.write(`${kind} ${id}… `)
    try {
      const played = await playConversation(turns, catalog, vertex, chirp, options, history, files, prelude)
      const conversation: Conversation = { kind, id, title, events: played.events, chain: played.chain, saves: played.saves }
      process.stderr.write(`${played.chain.length} фраз, ${usd(spend.model + spend.chirp)} всего\n`)
      return { conversation, run: played.run }
    } catch (error) {
      process.stderr.write(`error: ${(error as Error).message}\n`)
      conversations.push({ kind, id, title, events: [], chain: [], saves: [], error: String((error as Error).message) })
      if (error instanceof OverBudget) throw error
      return undefined
    }
  }
  try {
    if (sets.includes("voice")) {
      const scenario = JSON.parse(readFileSync(join(HERE, "voice-scenario.json"), "utf8")) as VoiceScenario
      const played = await play("voice", "voice", "Презентационный звонок голосового стенда", scenario.steps.flatMap((step) => step.phrases.map((p) => p.say)))
      if (played) {
        const { conversation } = played
        conversation.voice = voiceVerdicts(scenario, conversation.events, conversation.chain, conversation.saves)
        conversation.checks = await played.run({ id: "voice", title: "", turns: [], checks: {} })
        conversations.push(conversation)
      }
    }
    if (sets.includes("segments")) {
      const labelsFile = f.labels ?? join(homedir(), "inbox", "zeytun-recordings", "segments", "labels.jsonl")
      const labels = readFileSync(labelsFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Label).filter((label) => label.use !== false)
      // --segment-lead S: each phrase cut again from its call's recording with S seconds before it (the cuts start on the voice,
      // often inside the first word, where the station's lookback hears 480 ms before it). The recording has both voices, so
      // those seconds can hold the assistant's last words. Without it: the cut as it is.
      const lead = Number(f["segment-lead"] ?? 0)
      const recordings = dirname(dirname(labelsFile))
      const calls = lead ? new Map(readFileSync(join(recordings, "calls.tsv"), "utf8").split("\n").filter(Boolean)
        .map((line) => { const [crm, station] = line.split("\t"); return [station, crm] as const })) : undefined
      if (lead) mkdirSync(join(outDir, "segments"), { recursive: true })
      for (const label of labels) {
        let file = join(dirname(labelsFile), label.file)
        const crmCall = calls?.get(label.call), seconds = (label as { seconds?: [number, number] }).seconds
        if (lead && crmCall && seconds) {
          file = join(outDir, "segments", label.file)
          execFileSync("ffmpeg", ["-v", "quiet", "-y", "-ss", String(Math.max(0, seconds[0] - lead)), "-to", String(seconds[1]),
            "-i", join(recordings, `call-${crmCall}.wav`), "-ac", "1", "-ar", "8000", "-c:a", "pcm_s16le", file])
        }
        // Each phrase alone, after the pharmacy has been named: as if the call had just begun its order.
        const played = await play("segment", label.file.replace(/\.wav$/, ""), label.said, [label.said], undefined, [file],
          { caller: "Salam, Zəfər aptekindən zəng edirəm.", assistant: "Salam, Zəfər apteki. Buyurun, nə yazım?" })
        if (!played) continue
        played.conversation.segment = segmentVerdict(label, played.conversation.events)
        played.conversation.checks = []
        conversations.push(played.conversation)
      }
    }
    if (sets.includes("dialogs")) {
      const scenarios = (JSON.parse(readFileSync(join(HERE, "dialog-scenarios.json"), "utf8")) as { scenarios: Scenario[] }).scenarios
        .filter((scenario) => !f.only || f.only.split(",").includes(scenario.id))
      for (const scenario of scenarios) {
        const played = await play("dialog", scenario.id, scenario.title, scenario.turns, scenario.history)
        if (!played) continue
        played.conversation.checks = await played.run(scenario)
        played.conversation.expectedFail = scenario.expectedFail
        conversations.push(played.conversation)
      }
    }
  } catch (error) {
    if (!(error instanceof OverBudget)) throw error
  } finally {
    for (const bridge of pendingClose) bridge.close()
  }

  // The first clips of the replies, voiced by the line's TTS: the first sound, and seconds a character for the price.
  const probeCount = Number(f["tts-probe"] ?? 0)
  const clips = conversations.flatMap((c) => c.chain.map((turn) => turn.firstClip)).filter((text): text is string => !!text).slice(0, probeCount)
  const probes = probeCount ? execFileSync("python3", ["-I", "-W", "ignore", join(HERE, "chain-tts-probe.py"), vertexKey, ZEYTUN_INBOUND_SPEECH.style],
    { input: JSON.stringify(clips) }).toString().trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { chars: number; first_ms?: number; audio_s?: number; error?: string }) : []
  const voiced = probes.filter((probe) => probe.audio_s)
  const sPerChar = voiced.length ? voiced.reduce((sum, p) => sum + p.audio_s!, 0) / voiced.reduce((sum, p) => sum + p.chars, 0) : DEFAULT_S_PER_CHAR
  const ttsFirst = median(probes.flatMap((probe) => probe.first_ms ? [probe.first_ms / 1000] : []))
  const ttsProbeUsd = voiced.reduce((sum, p) => sum + ttsCost(p.chars, p.audio_s! / p.chars), 0)

  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: HERE }).toString().trim()
  const text = report(conversations, { ear, model, thinking, snapshotAt, sha, hints: hints.length, sPerChar, ttsFirst, probes, ttsProbeUsd,
    requests: vertex.requests })
  writeFileSync(join(outDir, "report.md"), text)
  writeFileSync(join(outDir, "run.json"), JSON.stringify({ ear, model, thinking, spend, sPerChar, probes, conversations }, null, 1))
  process.stderr.write(`report: ${join(outDir, "report.md")}\n`)
  process.stdout.write(text)
}

/* ---------- report ---------- */

type Meta = { ear: string; model: string; thinking: string; snapshotAt: string; sha: string; hints: number; sPerChar: number; ttsFirst: number
  probes: { chars: number; first_ms?: number; audio_s?: number; error?: string }[]; ttsProbeUsd: number; requests: number }

function costOf(conversation: Conversation, sPerChar: number, opening: string) {
  const requests = conversation.chain.flatMap((turn) => turn.requests)
  const model = requests.reduce((sum, r) => sum + r.usd, 0)
  const chirpS = conversation.chain.reduce((sum, turn) => sum + turn.chirpS, 0)
  const chirp = chirpS * CHIRP_PER_MIN / 60
  const chars = opening.length + conversation.chain.reduce((sum, turn) => sum + turn.said.length, 0)
  const tts = ttsCost(chars, sPerChar)
  const seconds = conversationSeconds(conversation.chain, sPerChar, opening)
  return { requests: requests.length, prompt: requests.reduce((sum, r) => sum + r.prompt, 0), cached: requests.reduce((sum, r) => sum + r.cached, 0),
    output: requests.reduce((sum, r) => sum + r.output, 0), audio: requests.reduce((sum, r) => sum + r.audio, 0), model, chirp, chirpS, tts, seconds }
}

function report(conversations: Conversation[], meta: Meta) {
  const opening = (conversations.find((c) => c.events[0])?.events[0] as { text?: string } | undefined)?.text ?? ""
  const lines = [`# Стенд цепочки линии — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, "",
    `Коммит \`${meta.sha}\`. Слух: **${meta.ear === "chirp" ? "Chirp 3 → текст модели" : "модель слышит фразу сама + Chirp вторым ухом (alsoHeard)"}**, ` +
    `модель \`${meta.model}\` (thinking ${meta.thinking}, Vertex, потоком), подсказок Chirp ${meta.hints}, снимок каталога ${meta.snapshotAt}, запросов к модели ${meta.requests}.`, "",
    `Задержка — от последнего звука фразы аптеки: 0,65 с тишины станции + слух + модель (+ инструменты). «Клип» — когда реле станции отдало бы первый кусок ответа в озвучку; ` +
    `аптека слышит его ещё через первый звук TTS${Number.isFinite(meta.ttsFirst) ? ` (замер: медиана ${s(meta.ttsFirst)} с по ${meta.probes.length} фразам)` : ""}.`, "",
    "## Итог", "",
    "| Разговор | Проверки | Фраз | Запросов | Вход / из кэша / звук, ток. | Выход, ток. | Модель | Chirp | TTS (оценка) | Всего | ≈ мин | ¢/мин | Действие p50 / p90 | Слово p50 / p90 | Клип p50 / p90 |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
  const all = { model: 0, chirp: 0, tts: 0, seconds: 0 }
  const pick = (chain: ChainTurn[], key: "action" | "word" | "clip") => chain.map((turn) => turn[key] ?? NaN)
  const delays = (chain: ChainTurn[]) => (["action", "word", "clip"] as const)
    .map((key) => `${s(median(pick(chain, key)))} / ${s(quantile(pick(chain, key), 0.9))}`).join(" | ")
  const row = (name: string, passed: string, group: Conversation[], perMinute: boolean) => {
    const costs = group.map((c) => costOf(c, meta.sPerChar, opening))
    const sum = (key: keyof (typeof costs)[number]) => costs.reduce((total, cost) => total + cost[key], 0)
    const total = sum("model") + sum("chirp") + sum("tts"), chain = group.flatMap((c) => c.chain)
    lines.push(`| ${name} | ${passed} | ${chain.length} | ${sum("requests")} | ${sum("prompt")} / ${sum("cached")} / ${sum("audio")} | ${sum("output")} | ${usd(sum("model"))} | ${usd(sum("chirp"))} | ${usd(sum("tts"))} | ${usd(total)} | ` +
      `${perMinute ? `${(sum("seconds") / 60).toFixed(1)} | ${(total / (sum("seconds") / 60) * 100).toFixed(2)}` : "— | —"} | ${delays(chain)} |`)
    return { model: sum("model"), chirp: sum("chirp"), tts: sum("tts"), seconds: sum("seconds") }
  }
  const segments = conversations.filter((c) => c.segment)
  for (const c of conversations) {
    if (c.segment) continue
    if (c.error) { lines.push(`| ${c.id}. ${c.title} | ошибка: ${quote(c.error).slice(0, 80)} |||||||||||||| `); continue }
    // A reply with any Cyrillic word: the TTS reads it the Russian way (the station's script check goes by the majority of letters).
    const cyrillic = c.events.slice(1).filter((event) => event.kind === "assistant" && /\p{Script=Cyrillic}/u.test(event.text)).length
    const passed = (cyrillic ? `кириллица в ${cyrillic} отв.; ` : "") + (c.voice ? `${c.voice.steps.filter((x) => x.ok).length}/${c.voice.steps.length} шагов, заказ ${c.voice.final.filter((x) => x.ok).length}/${c.voice.final.length}`
      : `${(c.checks ?? []).filter((x) => x.ok).length}/${(c.checks ?? []).length}${c.expectedFail ? " (ожид.)" : ""}`)
    const cost = row(`${c.id}. ${c.title}`, passed, [c], true)
    all.model += cost.model; all.chirp += cost.chirp; all.tts += cost.tts; all.seconds += cost.seconds
  }
  const verdicts = segments.map((c) => c.segment!)
  const named = verdicts.filter((v) => v.expected), expected = named.reduce((sum, v) => sum + v.expected, 0)
  const inFive = named.reduce((sum, v) => sum + v.inFive, 0)
  if (segments.length) row(`Фразы живых звонков (${segments.length}, по одной)`, `товар в пятёрке ${inFive}/${expected}`, segments, false)
  const turns = conversations.filter((c) => !c.segment).flatMap((c) => c.chain)
  const total = all.model + all.chirp + all.tts
  if (turns.length) lines.push("", `**Всего (без фраз живых звонков):** модель ${usd(all.model)}, Chirp ${usd(all.chirp)}, TTS (оценка по ${(meta.sPerChar).toFixed(3)} с/знак) ${usd(all.tts)}; ` +
    `≈ ${(all.seconds / 60).toFixed(1)} мин разговоров → **${(total / (all.seconds / 60) * 100).toFixed(2)} ¢/мин** с озвучкой, ${((all.model + all.chirp) / (all.seconds / 60) * 100).toFixed(2)} ¢/мин без неё. ` +
    `Задержка по ${turns.length} фразам (p50 / p90): действие | слово | клип = ${delays(turns)} с. ` +
    `Chirp: ${s(median(turns.flatMap((t) => t.chirpMs !== undefined ? [t.chirpMs / 1000] : [])))} с медиана.`)
  if (segments.length) {
    const without = verdicts.filter((v) => !v.expected)
    lines.push("", "### Слух на фразах живых звонков (набор задачи 6)", "",
      `Каждая фраза — отдельный разговор сразу после приветствия. Товар считается понятым, если он есть среди кандидатов любого поиска модели на этой фразе (пятёрка и alsoHeard).`, "",
      "| Товар в пятёрке | Первый в поиске | Записан в заказ | Фраза целиком | Поиск товара на фразе без товара |", "|---|---|---|---|---|",
      `| **${inFive}/${expected} (${Math.round(inFive / expected * 100)} %)** | ${named.reduce((sum, v) => sum + v.first, 0)}/${expected} | ${named.reduce((sum, v) => sum + v.saved, 0)}/${expected} | ` +
      `${named.filter((v) => v.inFive === v.expected).length}/${named.length} | ${without.filter((v) => v.falseLookup).length}/${without.length} |`)
  }
  if (meta.probes.length) {
    lines.push("", `Озвучка (${meta.probes.length} первых клипов, Sulafat, Vertex): первый звук ${meta.probes.map((p) => p.first_ms ? s(p.first_ms / 1000) : `ошибка ${p.error}`).join(", ")} с; стоило ${usd(meta.ttsProbeUsd)}.`)
  }
  for (const c of conversations) {
    if (c.error) continue
    lines.push("", `## ${c.id}. ${c.title}${c.segment ? ` — ${c.segment.expected ? `в пятёрке ${c.segment.inFive}/${c.segment.expected}, записан ${c.segment.saved}` : c.segment.falseLookup ? "искал товар без товара" : "без товара: ок"}` : ""}`, "")
    if (c.voice) {
      lines.push("| Шаг | Фраза | Понят | Что не так |", "|---|---|---|---|")
      for (const step of c.voice.steps) lines.push(`| ${step.n} | ${quote(step.says.join(" → "))} | ${step.ok ? "✓" : "✗"} | ${quote([...step.misses, ...step.hearing.map((h) => `слух: ${h.word} → «${h.heard}»`)].join("; "))} |`)
      lines.push("", "Заказ в последнем сохранении: " + c.voice.final.map((x) => `${x.ok ? "✓" : "✗"} ${x.label}`).join(", "), "",
        ...c.voice.rows.map((row) => `- ${quote(row.spoken)} × ${row.quantity} → ${quote(row.product)}`), "")
    }
    let turn = 0
    for (const event of c.events) {
      if (event.kind === "caller") {
        const chain = c.chain[turn++]
        lines.push(`- **Аптека:** ${quote(event.text)}`)
        if (chain?.heard !== undefined) lines.push(`  - _Chirp:_ «${quote(chain.heard)}»${chain.chirpMs !== undefined ? ` (${s(chain.chirpMs / 1000)} с)` : ""}`)
        if (chain) lines.push(`  - _задержка:_ действие ${s(chain.action)} с, слово ${s(chain.word)} с, клип ${s(chain.clip)} с; запросов ${chain.requests.length}` +
          ` (${chain.requests.map((r) => `${r.ms} мс${r.firstText !== undefined ? `, слово ${r.firstText}` : ""}${r.firstCall !== undefined ? `, вызов ${r.firstCall}` : ""}`).join("; ")}), инструменты ${Math.round(chain.toolMs)} мс` +
          `${chain.notes.length ? `; ${quote(chain.notes.join("; "))}` : ""}`)
      } else if (event.kind === "assistant") lines.push(`- **Ассистент:** ${quote(event.text)}`)
      else if (event.kind === "tool") lines.push(toolLine(event))
      else lines.push(`  - _${quote(event.text)}_`)
    }
    if (c.checks) lines.push("", ...c.checks.map((item) => `- ${item.ok ? "✅" : "❌"} ${item.label}${item.detail && !item.ok ? ` — «${quote(item.detail).slice(0, 160)}»` : ""}`))
  }
  return `${lines.join("\n")}\n`
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
