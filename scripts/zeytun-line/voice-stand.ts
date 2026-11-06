/**
 * Voice stand of the phone line (plan task 10, owner 2026-11-04: «разговор
 * протестируй»): a whole call with no phone — the pharmacy speaks, the line's
 * Live model hears it, the CRM answers its tools.
 *
 * What is real here:
 *  - the pharmacy's voice: every phrase through Vertex TTS (gemini-3.8-flash-tts,
 *    not the line's Sulafat), made into the trunk's audio — 8 kHz, G.711 µ-law
 *    (voice-caller-tts.py);
 *  - the session: the station core's own setup, greeting and language note for
 *    this bridge (dialog-stand-bridge.py, op "live", from the station's base
 *    core patched by build-zeytun-inbound-core.py), and the caller's audio as
 *    the core sends it: resampled to 16 kHz, manual activity markers, the
 *    language note and the 480 ms lookback at activityStart, 0.65 s of end
 *    silence before activityEnd, a dropped session resumed by its handle
 *    (voice-live-remote.py, on prod: the Gemini key lives only there);
 *  - the tools: the station's bridge, and behind it the CRM's own handler on a
 *    catalog snapshot (stand-crm.ts), as in the dialog stand;
 *  - the second ear: the line's Chirp 3 (zeytun-chirp.ts) with a service
 *    account key on this machine, fed each phrase as the core feeds the
 *    bridge (from the frame that opened the activity, without the lookback,
 *    to activityEnd); --no-second-ear runs the line as it was before #1320.
 *
 * What is not: the order writer, cancel and transfer are stubs; learned
 * names (the CRM's confirmed orders) are off; the pharmacy hears the
 * model's own audio on the recording, while on a call the station speaks the
 * model's words with TTS (Sulafat): a reply's first sound on the line comes
 * that TTS's first audio later than the model's. The pharmacy speaks its
 * script whatever the assistant asked (a presentation call): a step the
 * assistant took elsewhere shows as not understood, the call goes on.
 *
 *   JITI_ALIAS='{"@":"'$PWD'/src"}' node_modules/.bin/jiti scripts/zeytun-line/voice-stand.ts <snapshot> --core <base core>
 *     [--runs 1] [--stop-at 0.45] [--scenario scripts/zeytun-line/voice-scenario.json] [--voice Charon]
 *     [--out ~/inbox/zeytun-recordings/voice-stand/<time>] [--live-model gemini-3.8-live]
 *     [--vertex-key ~/.config/zeytun/vertex-key] [--second-ear-key ~/.config/zeytun/speech-key | --no-second-ear]
 *     [--station <fanum-zeytun-inbound.py of a branch>] [--departed-from <older snapshot>] (what sold out since it)
 *
 * The base core is the station's fanum-voice-core.py the build script expects
 * (EXPECTED_SOURCE in scripts/pbx/build-zeytun-inbound-core.py); it is not in
 * Git. The snapshot is the client's catalog, the audio and transcripts are the
 * owner's test material: both stay out of Git (the output goes to ~/inbox).
 * One run opens one Live session on the line's key and costs real money: every
 * turn bills the whole context again (~$0.43 a call of the presentation scenario,
 * estimated 2026-11-04). The stand sums each usageMetadata at Google's price and
 * ends the call at --stop-at (USD, default 0.45); a 402/429/quota refusal ends it
 * at once and no further run starts. Run it only with the owner's word.
 */
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import type { InboundPilotCatalog } from "../../src/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { createChirpRecognizer, createZeytunSecondEar, type ChirpRecognizer } from "../../src/lib/voice-agent/pharmacy/zeytun-chirp"
import { crmFor, foldLatin as fold, loadCatalog, StationBridge, usageCost, type Json, type Save, type Usage } from "./stand-crm"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUTPUT_RATE = 24000
/** The core hands the bridge a phrase from the frame that opened the activity: the lookback's last 20 ms frame, 8 kHz PCM16. */
const UTTERANCE_FIRST_BYTE = (24 - 1) * 320
const END_SILENCE_BYTES = Math.round(0.65 * 8000) * 2

type Rule = { match: string; label: string }
type Expect = { tools?: { name: string; args?: string; label: string }[]; reply?: Rule[]; noReply?: Rule[] }
/** expect of a phrase: its own answer; expect of the step: all its answers. */
type Phrase = { say: string; hear?: Rule[]; expect?: Expect }
type Step = { n: number; phrases: Phrase[]; expect: Expect }
type VoiceScenario = { voice: string; steps: Step[]; final: { spoken: string; quantity: number; label: string }[] }

/* ---------- the session on prod ---------- */

type Remote =
  | { ev: "open"; t: number } | { ev: "server"; t: number; msg: Json }
  | { ev: "spoke"; t_voice: number; t_start: number; t_speech_end: number; t_activity_end: number }
  | { ev: "drop"; t: number; kind: string; code: number | null } | { ev: "resumed"; t: number; attempts: number }
  | { ev: "dead"; t: number; attempts: number; errors?: string[] } | { ev: "error"; detail: string }
  | { ev: "money"; t?: number; detail: string } | { ev: "replaced"; t: number; ms: number }

class RemoteLive {
  private child: ChildProcessWithoutNullStreams
  private handlers: ((event: Remote) => void)[] = []
  /** local ms minus remote s*1000, the smallest seen: what a remote moment is on this clock. */
  offset = Infinity
  exited: Promise<void>
  constructor() {
    const script = readFileSync(join(HERE, "voice-live-remote.py")).toString("base64")
    const key = process.env.LEADDRIVE_PROD_SSH_KEY ?? join(homedir(), ".ssh/leaddrive_prod_2026_09_09")
    const host = process.env.LEADDRIVE_PROD_HOST ?? "root@13.140.132.245"
    this.child = spawn("ssh", ["-o", "BatchMode=yes", "-i", key, host,
      `python3 -I -W ignore -c "$(printf %s '${script}' | base64 -d)"`], { stdio: ["pipe", "pipe", "pipe"] })
    this.child.stderr.on("data", (chunk) => process.stderr.write(`[prod] ${chunk}`))
    this.exited = new Promise((resolve) => this.child.on("exit", () => resolve()))
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on("line", (line) => {
      const event = JSON.parse(line) as Remote
      const t = "t" in event ? event.t : "t_activity_end" in event ? event.t_activity_end : undefined
      if (t !== undefined) this.offset = Math.min(this.offset, Date.now() - t * 1000)
      for (const handler of this.handlers) handler(event)
    })
  }
  on(handler: (event: Remote) => void) { this.handlers.push(handler) }
  send(value: Json) { this.child.stdin.write(`${JSON.stringify(value)}\n`) }
  /** A remote moment (s) as local epoch ms. */
  local(t: number) { return t * 1000 + this.offset }
  close() { this.send({ op: "close" }); this.child.stdin.end() }
}

/* ---------- one call ---------- */

type ToolEvent = { t: number; name: string; args: Json; result?: Json; answeredAt?: number }
type Turn = {
  step: number; phrase: number; say: string; clip?: string; speechS?: number
  spoke?: { t_voice: number; t_start: number; t_speech_end: number; t_activity_end: number }
  heard: string; said: string; tools: ToolEvent[]; chirp?: string
  firstText?: number; firstAudio?: number; firstTool?: number; turnComplete?: number
  /** Local ms: the last server message, the last turnComplete, the last tool result sent back. */
  lastEventAt?: number; turnCompleteAt?: number; lastResponseAt?: number
  audio: { t: number; pcm: Buffer }[]; notes: string[]
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(predicate: () => boolean, ms: number) {
  const end = Date.now() + ms
  while (!predicate()) {
    if (Date.now() >= end) return false
    await sleep(25)
  }
  return true
}

function speak(text: string, voice: string, vertexKey: string, cache: string) {
  const out = execFileSync("python3", ["-I", "-W", "ignore", join(HERE, "voice-caller-tts.py"), vertexKey, cache, voice, text]).toString()
  return JSON.parse(out) as { file: string; speech_s: number; cached: boolean }
}

const wavPcm = (file: string) => {
  const raw = readFileSync(file)
  const data = raw.indexOf("data")
  return raw.subarray(data + 8)
}

type Options = { core: string; liveModel: string; voice: string; vertexKey: string; cache: string; station?: string; secondEarKey?: string
  /** USD: the call is ended once its Live usage reaches this (one more answer may still be billed). */
  stopAt: number
  /** Plan task 13: after a turn that saved the list, once the context reached this many prompt tokens, a fresh session takes the call. */
  swapAt?: number }

async function playCall(scenario: VoiceScenario, catalog: InboundPilotCatalog, options: Options) {
  const saves: Save[] = []
  let current: Turn | undefined, dead = false, opened = false, toolsPending = 0, stopped: string | undefined
  const spend = { usd: 0, generations: 0, sessions: 0, swaps: 0, tokens: { textIn: 0, audioIn: 0, textOut: 0, audioOut: 0 }, tts: 0, ttsCached: 0, chirp: 0 }
  // What Chirp heard of each phrase goes to the phrase's turn (the CRM never says it).
  const chirp = options.secondEarKey ? createChirpRecognizer({ keyFile: options.secondEarKey }) : undefined
  const recognizer: ChirpRecognizer | undefined = chirp && { enabled: () => chirp.enabled(), warm: () => chirp.warm(),
    recognize: async (pcm, phrases) => {
      spend.chirp++
      const turn = current, heard = await chirp.recognize(pcm, phrases)
      if (turn) turn.chirp = "text" in heard ? heard.text : `ошибка ${heard.error}`
      return heard
    } }
  const secondEar = recognizer && createZeytunSecondEar({ recognizer })
  const bridge = new StationBridge(crmFor(catalog, saves, undefined, secondEar), options.station)
  const pilot = await bridge.op<Json>({ op: "open" })
  if (!pilot) throw new Error("the CRM's session answer refused the stand's call")
  const live = await bridge.op<{ setup: Json; greeting: Json; language: Json }>({ op: "live", core: options.core, pilot, model: options.liveModel })
  const remote = new RemoteLive()
  const turns: Turn[] = []
  const log: { t: number; kind: string; detail?: unknown }[] = []
  /** Which kinds of server message came when (no audio, no words): to see how a turn ended. */
  const trace: { t: number; step: number; phrase: number; kinds: string[] }[] = []
  /** Every usageMetadata as the provider sent it: the cost is checked against these. */
  const usageLog: { t: number; usage: unknown }[] = []
  let playEnd = 0 // remote s: where the assistant's audio, played in real time, ends
  let lastPrompt = 0 // prompt tokens of the latest usageMetadata: what the next generation bills again
  let replaced: number | undefined

  remote.on((event) => {
    if (event.ev === "open") { opened = true; spend.sessions++ }
    else if (event.ev === "money") {
      // 402/429/quota: stop now, nothing more is opened or resumed.
      stopped = `отказ по деньгам или квоте: ${event.detail}`
      current?.notes.push(stopped)
      dead = true
    }
    else if (event.ev === "spoke" && current) {
      current.spoke = event
      // At activityEnd the core has handed the bridge the phrase; the bridge sends it to the CRM's second ear.
      const pcm = current.clip ? wavPcm(current.clip) : undefined
      if (pcm && pilot.standUtterances === true) {
        void bridge.op({ op: "utterance", first: pcm.subarray(UTTERANCE_FIRST_BYTE, UTTERANCE_FIRST_BYTE + 320).toString("base64"),
          rest: Buffer.concat([pcm.subarray(UTTERANCE_FIRST_BYTE + 320), Buffer.alloc(END_SILENCE_BYTES)]).toString("base64") }).catch(() => undefined)
      }
    }
    else if (event.ev === "resumed") spend.sessions++
    else if (event.ev === "replaced") { spend.sessions++; spend.swaps++; replaced = event.ms }
    if (event.ev === "drop" || event.ev === "resumed" || event.ev === "dead" || event.ev === "error") {
      log.push({ t: "t" in event ? event.t : 0, kind: event.ev, detail: event })
      current?.notes.push(event.ev === "drop" ? `сессия оборвалась (${event.kind} ${event.code ?? ""})`
        : event.ev === "resumed" ? `сессия продлена (${event.attempts} попыт.)`
        : event.ev === "dead" ? `сессию продлить не удалось (${event.attempts} попыт.: ${(event.errors ?? []).join(", ") || "нет handle"}); станция открыла бы новую с пересказом, стенд кончает звонок`
        : `ошибка: ${event.detail}`)
      if (event.ev === "dead" || event.ev === "error") dead = true
    } else if (event.ev === "server") {
      const msg = event.msg, turn = current
      if (msg.usageMetadata) {
        const { tokens, usd } = usageCost(msg.usageMetadata as Usage)
        lastPrompt = (msg.usageMetadata as Usage).promptTokenCount ?? lastPrompt
        spend.usd += usd
        spend.generations++
        for (const key of Object.keys(tokens) as (keyof typeof tokens)[]) spend.tokens[key] += tokens[key]
        usageLog.push({ t: event.t, usage: msg.usageMetadata })
        if (spend.usd >= options.stopAt && !dead) {
          stopped = `бюджет: Live набрал $${spend.usd.toFixed(3)} (порог $${options.stopAt})`
          current?.notes.push(`звонок остановлен — ${stopped}`)
          dead = true
        }
      }
      if (turn) {
        turn.lastEventAt = Date.now()
        trace.push({ t: event.t, step: turn.step, phrase: turn.phrase, kinds: [...Object.keys(msg),
          ...Object.keys((msg.serverContent as Json | undefined) ?? {}).map((key) => `serverContent.${key}`)] })
      }
      if (msg.goAway) log.push({ t: event.t, kind: "goAway", detail: msg.goAway })
      const call = msg.toolCall as { functionCalls?: { id: string; name: string; args?: Json }[] } | undefined
      if (call?.functionCalls?.length && turn) {
        const calls = call.functionCalls
        const records = new Map(calls.map((c) => [c.id, { t: event.t, name: c.name, args: c.args ?? {} } as ToolEvent]))
        turn.tools.push(...records.values())
        turn.firstTool ??= event.t
        toolsPending++
        void bridge.op<{ id: string; name: string; response: Json }[]>({ op: "tools", calls }).then((responses) => {
          // The bridge answers calls as they finish, not in the order asked: by id.
          for (const response of responses) {
            const record = records.get(response.id)
            if (record) { record.result = response.response; record.answeredAt = Date.now() }
          }
          remote.send({ op: "send", msg: { toolResponse: { functionResponses: responses } } })
          turn.lastResponseAt = Date.now()
        }).catch((error) => turn.notes.push(`мост: ${String(error)}`)).finally(() => { toolsPending-- })
      }
      const content = msg.serverContent as Json | undefined
      if (content && turn) {
        void bridge.op({ op: "note", content }).catch(() => undefined)
        const heard = (content.inputTranscription as { text?: string } | undefined)?.text
        if (heard) turn.heard += heard
        const said = (content.outputTranscription as { text?: string } | undefined)?.text
        if (said) { turn.said += said; turn.firstText ??= event.t }
        for (const part of ((content.modelTurn as { parts?: Json[] } | undefined)?.parts ?? [])) {
          const data = (part.inlineData as { data?: string } | undefined)?.data
          if (!data) continue
          const pcm = Buffer.from(data, "base64")
          turn.firstAudio ??= event.t
          turn.audio.push({ t: event.t, pcm })
          playEnd = Math.max(playEnd, event.t) + pcm.length / 2 / OUTPUT_RATE
        }
        // generationComplete: the model has produced its answer. turnComplete follows about the
        // answer's audio length later (the provider paces it), and sometimes not at all: the first
        // of them after the latest tool result ends the turn, a later one moves nothing.
        if ((content.generationComplete || content.turnComplete || content.interrupted)
          && (turn.turnCompleteAt === undefined || (turn.lastResponseAt ?? 0) > turn.turnCompleteAt)) {
          turn.turnComplete = event.t
          turn.turnCompleteAt = Date.now()
        }
      }
    }
  })

  /**
   * The assistant's answer to the current turn is over, then its audio played and 0.5 s.
   * Over: a generationComplete (or turnComplete) that came after the turn's last tool result
   * was sent back (Live ends the turn a few ms BEFORE a tool call; the answer to the result
   * ends with another), no tool in flight.
   * A model that sends nothing after a tool's result for 3 s (an ordinary save is "recorded":
   * it may say nothing), or nothing at all for 10 s, is done too.
   */
  async function answered(turn: Turn, since: number) {
    const began = Date.now()
    const over = () => turn.turnComplete !== undefined && turn.turnComplete >= since && toolsPending === 0
      && (turn.lastResponseAt === undefined || (turn.turnCompleteAt ?? 0) > turn.lastResponseAt)
      // A tool call can come a few ms after the end of the turn it belongs to.
      && Date.now() - (turn.lastEventAt ?? 0) > 150
    const silent = () => turn.firstText === undefined && turn.firstAudio === undefined && turn.firstTool === undefined && Date.now() - began > 10_000
    const quietAfterTool = () => turn.lastResponseAt !== undefined && toolsPending === 0
      && Date.now() - Math.max(turn.lastEventAt ?? began, turn.lastResponseAt) > 3_000
    await until(() => dead || over() || silent() || quietAfterTool(), 60_000)
    if (!dead && !over()) {
      // After a tool's result the model may say nothing more (a "recorded" save): not worth a note.
      if (!quietAfterTool()) turn.notes.push(silent() ? "ассистент промолчал 10 с" : "ход не закончился за 60 с")
    }
    // A turn that goes on after its turnComplete (another answer) moves the end.
    for (;;) {
      const end = remote.local(Math.max(playEnd, turn.turnComplete ?? 0)) + 500
      await until(() => dead || Date.now() >= end, 60_000)
      if (dead || remote.local(Math.max(playEnd, turn.turnComplete ?? 0)) + 500 <= Date.now()) break
    }
  }

  try {
    remote.send({ op: "open", setup: live.setup })
    if (!(await until(() => opened || dead, 20_000)) || dead) throw new Error("the Live session did not open")
    current = { step: 0, phrase: 0, say: "(приветствие станции)", heard: "", said: "", tools: [], audio: [], notes: [] }
    turns.push(current)
    remote.send({ op: "send", msg: live.greeting })
    await answered(current, 0)
    for (const step of scenario.steps) {
      for (const [index, phrase] of step.phrases.entries()) {
        if (dead) break
        const clip = speak(phrase.say, scenario.voice, options.vertexKey, options.cache)
        if (clip.cached) spend.ttsCached++
        else spend.tts++
        const turn: Turn = { step: step.n, phrase: index, say: phrase.say, clip: clip.file, speechS: clip.speech_s,
          heard: "", said: "", tools: [], audio: [], notes: [] }
        turns.push(turn)
        current = turn
        remote.send({ op: "speak", pcm8k: wavPcm(clip.file).toString("base64"), language: live.language })
        await until(() => dead || turn.spoke !== undefined, 60_000)
        if (!turn.spoke) break
        await answered(turn, turn.spoke.t_activity_end)
        if (options.swapAt !== undefined && !dead && toolsPending === 0 && lastPrompt >= options.swapAt) {
          const seed = swapSeed(turns, turn)
          if (seed) {
            const before = lastPrompt
            replaced = undefined
            remote.send({ op: "replace", seed })
            if (await until(() => dead || replaced !== undefined, 15_000) && replaced !== undefined) {
              turn.notes.push(`сессия пересажена за ${replaced} мс (контекст был ${before} токенов)`)
              lastPrompt = 0
            } else if (!dead) { turn.notes.push("пересадка не удалась за 15 с"); dead = true }
          }
        }
        const lang = await bridge.op<{ english: boolean }>({ op: "lang", text: turn.said })
        if (lang.english) turn.notes.push("ответ по-английски: станция его не озвучила бы")
      }
    }
  } finally {
    remote.close()
    bridge.close()
    await Promise.race([remote.exited, sleep(5000)])
  }
  return { turns, saves, log, trace, dead, stopped, spend, usageLog, secondEar: pilot.standUtterances === true }
}

/**
 * Plan task 13: what a fresh session gets instead of the whole call. Only after a turn whose
 * save of the list was taken (the model saves after every settled line, so nothing is open):
 * the list exactly as last saved, with its externalIds (the CRM keeps it the same way), the
 * pharmacy as named, and the call's last words as text turns. turnComplete false: the model
 * says nothing until the caller speaks. Without such a save in the turn: no swap (null).
 */
const SWAP_TURNS = 6
function swapSeed(turns: Turn[], turn: Turn): Json | null {
  const saved = [...turn.tools].reverse().find((tool) => tool.name === "save_order_list" && tool.args.final !== true
    && /^(recorded|saved|queued)$/.test(String(tool.result?.status ?? "")))
  if (!saved) return null
  const lines = (saved.args.lines as Json[] | undefined) ?? []
  const pharmacy = String(saved.args.pharmacy ?? "").trim()
  const words: { role: "user" | "model"; text: string }[] = []
  for (const t of turns) {
    const heard = t.heard.replace(/\s+/g, " ").trim(), said = t.said.replace(/\s+/g, " ").trim()
    if (t.step && heard) words.push({ role: "user", text: heard })
    if (said) words.push({ role: "model", text: said })
  }
  const recent = words.slice(-SWAP_TURNS)
  // The provider wants a conversation that starts with the user.
  if (recent[0]?.role === "model") recent.unshift({ role: "user", text: "(the caller answered the phone)" })
  const control = "TECHNICAL CONTEXT. This same phone call goes on in a fresh session to keep it short; the turns above are its last words, "
    + "and every turn of yours above was already spoken aloud. Never greet, introduce yourself or name the company again, never repeat "
    + "or re-read anything, never mention this. "
    + (pharmacy ? `The pharmacy is ${JSON.stringify(pharmacy)}, already confirmed: never ask it again. ` : "")
    + `The order list saved so far, exactly as save_order_list last saved it: ${JSON.stringify(lines)}. These lines are settled: never ask about them again `
    + "unless the caller changes one, and every later save_order_list keeps every one of them with its externalId. "
    + "Wait silently for the caller's next words and go on with the call by your instructions."
  return { clientContent: { turns: [...recent.map((w) => ({ role: w.role, parts: [{ text: w.text }] })), { role: "user", parts: [{ text: control }] }], turnComplete: false } }
}

/* ---------- report ---------- */

const quote = (text: string) => text.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|")
const seconds = (value: number | undefined) => value === undefined ? "—" : `${value.toFixed(2)} с`

function latency(turn: Turn) {
  const end = turn.spoke?.t_speech_end
  if (end === undefined) return {}
  const first = [turn.firstTool, turn.firstText, turn.firstAudio].filter((t): t is number => t !== undefined)
  return { tool: turn.firstTool && turn.firstTool - end, text: turn.firstText && turn.firstText - end,
    audio: turn.firstAudio && turn.firstAudio - end, any: first.length ? Math.min(...first) - end : undefined }
}

function toolResult(tool: ToolEvent) {
  const result = tool.result ?? {}
  const candidates = (result.candidates as { name?: string; nameAz?: string; promotion?: unknown; alsoHeard?: string }[] | undefined) ?? []
  const label = (c: (typeof candidates)[number]) => (c.nameAz ?? c.name ?? "?") + (c.promotion ? " (акция)" : "") + (c.alsoHeard ? ` (Chirp: «${c.alsoHeard}»)` : "")
  const names = [...candidates.slice(0, 3), ...candidates.slice(3).filter((c) => c.alsoHeard)].map(label).join("; ")
  const status = String(result.status ?? (tool.result ? "?" : "нет ответа"))
  return `${status}${candidates.length ? ` — ${candidates.length}: ${names}${candidates.length > 3 ? "; …" : ""}` : ""}${result.total ? ` — итог ${String(result.total)}` : ""}`
}

type Run = Awaited<ReturnType<typeof playCall>> & { attempt: number; wav: string }

function unmet(expect: Expect | undefined, turns: Turn[]) {
  const said = turns.map((turn) => turn.said).join(" ")
  const tools = turns.flatMap((turn) => turn.tools)
  const misses: string[] = []
  for (const want of expect?.tools ?? []) {
    if (!tools.some((tool) => tool.name === want.name && (!want.args || new RegExp(want.args, "iu").test(JSON.stringify(tool.args))))) misses.push(want.label)
  }
  for (const want of expect?.reply ?? []) if (!new RegExp(want.match, "iu").test(said)) misses.push(want.label)
  for (const want of expect?.noReply ?? []) if (new RegExp(want.match, "iu").test(said)) misses.push(want.label)
  return misses
}

function stepVerdict(step: Step, turns: Turn[]) {
  const mine = turns.filter((turn) => turn.step === step.n)
  const misses = [...unmet(step.expect, mine),
    ...step.phrases.flatMap((phrase, index) => unmet(phrase.expect, mine.filter((turn) => turn.phrase === index)))]
  const hearing = step.phrases.flatMap((phrase, index) => {
    const turn = mine.find((t) => t.phrase === index)
    return (phrase.hear ?? []).filter((rule) => !new RegExp(rule.match, "iu").test(fold(turn?.heard ?? "")))
      .map((rule) => ({ word: rule.label, heard: turn?.heard ?? "", searched: (turn?.tools ?? []).filter((t) => t.name === "search_pharmacy_catalog").map((t) => String(t.args.text ?? JSON.stringify(t.args))) }))
  })
  return { ok: misses.length === 0 && mine.length === step.phrases.length, misses, hearing,
    latency: mine.map((turn) => latency(turn).any) }
}

function finalOrder(scenario: VoiceScenario, saves: Save[]) {
  const last = [...saves].reverse().find((save) => save.final) ?? saves.at(-1)
  if (!last) return { last, rows: [], checks: scenario.final.map((want) => ({ label: want.label, ok: false })) }
  const rows = last.lines.map((line, i) => ({ spoken: line.spoken, quantity: line.quantity, unit: line.unit, product: last.products?.[i] ?? "не найден" }))
  const checks = scenario.final.map((want) => ({ label: want.label,
    ok: rows.some((row) => new RegExp(want.spoken, "u").test(`${row.spoken} ${row.product}`) && row.quantity === want.quantity) }))
  return { last, rows, checks }
}

function report(runs: Run[], scenario: VoiceScenario, meta: Json) {
  const out: string[] = []
  out.push("# Голосовой стенд линии: презентационный звонок", "")
  out.push(`Main \`${String(meta.sha)}\`, модель \`${String(meta.liveModel)}\`, снимок каталога ${String(meta.snapshotAt)}, голос аптеки ${scenario.voice} (Vertex), прогонов ${runs.length}.`)
  if (meta.station) out.push(`Станция: \`${String(meta.station)}\`.`)
  out.push(`Пересадка сессии (задача 13): ${meta.swapAt == null ? "выключена" : `после сохранения списка, когда контекст ≥ ${String(meta.swapAt)} токенов`}.`)
  out.push(`Второе ухо (Chirp): ${runs.every((run) => run.secondEar) ? "включено, как на линии" : "выключено"}.`)
  out.push("", "Задержка — от конца речи аптеки (последний звук фразы, до 0,65 с тишины станции) до первого из: вызов инструмента, текст, звук модели. На звонке аптека слышит ответ ещё через первый звук TTS станции (Sulafat) после текста.", "")

  out.push("## Итог", "")
  out.push(`| Шаг | Фраза | ${runs.map((run) => `Прогон ${run.attempt}`).join(" | ")} |`, `|---|---|${runs.map(() => "---|").join("")}`)
  for (const step of scenario.steps) {
    const cells = runs.map((run) => {
      const v = stepVerdict(step, run.turns)
      const lat = v.latency.map((value) => value === undefined ? "—" : value.toFixed(1)).join(" / ")
      return `${v.ok ? "✓" : "✗"} ${lat} с`
    })
    out.push(`| ${step.n} | ${quote(step.phrases.map((p) => p.say).join(" → "))} | ${cells.join(" | ")} |`)
  }
  const all = runs.flatMap((run) => scenario.steps.flatMap((step) => stepVerdict(step, run.turns).latency)).filter((v): v is number => v !== undefined).sort((a, b) => a - b)
  if (all.length) out.push("", `Задержка по всем фразам: медиана ${all[Math.floor(all.length / 2)].toFixed(2)} с, 90-й перцентиль ${all[Math.floor(all.length * 0.9)].toFixed(2)} с, максимум ${all.at(-1)!.toFixed(2)} с (${all.length} фраз).`)

  out.push("", "### Заказ в последнем сохранении", "")
  out.push(`| Позиция | ${runs.map((run) => `Прогон ${run.attempt}`).join(" | ")} |`, `|---|${runs.map(() => "---|").join("")}`)
  const orders = runs.map((run) => finalOrder(scenario, run.saves))
  scenario.final.forEach((want, i) => out.push(`| ${want.label} | ${orders.map((o) => o.checks[i].ok ? "✓" : "✗").join(" | ")} |`))
  // Where the final save came: on the confirmation (step 11), or earlier — the call ended before the script did.
  const finalAt = (run: Run) => run.turns.find((turn) => turn.tools.some((tool) => tool.name === "save_order_list" && tool.args.final === true))
  out.push(`| итоговое сохранение (final) | ${runs.map((run) => { const turn = finalAt(run)
    return turn ? `✓ шаг ${turn.step}${turn.phrase ? `.${turn.phrase + 1}` : ""}` : "✗" }).join(" | ")} |`)

  out.push("", "### Стоимость", "")
  out.push("| | " + runs.map((run) => `Прогон ${run.attempt}`).join(" | ") + " |", `|---|${runs.map(() => "---|").join("")}`)
  const row = (label: string, value: (run: Run) => string) => out.push(`| ${label} | ${runs.map(value).join(" | ")} |`)
  row("сессий Live (с продлениями и пересадками)", (run) => String(run.spend.sessions))
  row("пересадок сессии", (run) => String(run.spend.swaps))
  row("ответов модели с usageMetadata", (run) => String(run.spend.generations))
  row("токенов на входе: текст / звук", (run) => `${run.spend.tokens.textIn} / ${run.spend.tokens.audioIn}`)
  row("токенов на выходе: текст / звук", (run) => `${run.spend.tokens.textOut} / ${run.spend.tokens.audioOut}`)
  row("Live, $ (по usageMetadata и цене Google)", (run) => run.spend.usd.toFixed(3))
  row("запросов TTS (Vertex) / из кэша", (run) => `${run.spend.tts} / ${run.spend.ttsCached}`)
  row("распознаваний Chirp", (run) => String(run.spend.chirp))
  for (const run of runs) if (run.stopped) out.push("", `Прогон ${run.attempt} остановлен: ${run.stopped}.`)
  out.push("", "### Ошибки слуха (расшифровка модели)", "")
  let hearingErrors = 0
  for (const run of runs) for (const step of scenario.steps) for (const miss of stepVerdict(step, run.turns).hearing) {
    hearingErrors++
    out.push(`- прогон ${run.attempt}, шаг ${step.n}: **${miss.word}** — услышано «${quote(miss.heard) || "ничего"}»${miss.searched.length ? `; искал: ${miss.searched.map((s) => `«${quote(s)}»`).join(", ")}` : ""}`)
  }
  if (!hearingErrors) out.push("- нет")
  out.push("", "### Что не понято", "")
  let misses = 0
  for (const run of runs) for (const step of scenario.steps) {
    const v = stepVerdict(step, run.turns)
    if (v.misses.length) { misses++; out.push(`- прогон ${run.attempt}, шаг ${step.n}: ${v.misses.join("; ")}`) }
  }
  if (!misses) out.push("- всё понято")

  for (const [r, run] of runs.entries()) {
    out.push("", `## Прогон ${run.attempt}`, "", `Запись: \`${run.wav}\`${run.dead ? " — **звонок оборвался**" : ""}`)
    for (const entry of run.log) out.push(`- ${entry.t.toFixed(1)} с: ${entry.kind}`)
    for (const turn of run.turns) {
      const lat = latency(turn)
      out.push("", turn.step === 0 ? "### Приветствие" : `### Шаг ${turn.step}${turn.phrase ? `.${turn.phrase + 1}` : ""}: «${quote(turn.say)}»`, "")
      if (turn.step) out.push(`- услышала модель: «${quote(turn.heard) || "—"}»`)
      if (turn.chirp !== undefined) out.push(`- услышал Chirp: «${quote(turn.chirp) || "—"}»`)
      for (const tool of turn.tools) out.push(`- \`${tool.name}\` ${quote(JSON.stringify(tool.args))} → ${quote(toolResult(tool))}`)
      out.push(`- ответила: «${quote(turn.said) || "—"}»`)
      if (turn.step) out.push(`- задержка: инструмент ${seconds(lat.tool)}, текст ${seconds(lat.text)}, звук ${seconds(lat.audio)} (речь ${turn.speechS?.toFixed(1) ?? "?"} с)`)
      for (const note of turn.notes) out.push(`- ⚠ ${note}`)
    }
    const order = orders[r]
    out.push("", "Последнее сохранение:", "", "| Сказано | Кол-во | Товар |", "|---|---|---|")
    for (const row of order.rows) out.push(`| ${quote(row.spoken)} | ${row.quantity} ${quote(row.unit)} | ${quote(row.product)} |`)
  }
  return out.join("\n") + "\n"
}

/* ---------- the recording ---------- */

/** One mono 8 kHz WAV of the call: the pharmacy's clips where they started, the model's audio played as it came. */
function recording(turns: Turn[], remote0: number) {
  const rate = 8000, pieces: { at: number; pcm: Int16Array }[] = []
  let play = 0
  for (const turn of turns) {
    if (turn.clip && turn.spoke) {
      const pcm = wavPcm(turn.clip)
      pieces.push({ at: turn.spoke.t_voice, pcm: new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1) })
    }
    for (const chunk of turn.audio) {
      play = Math.max(play, chunk.t)
      const source = new Int16Array(chunk.pcm.buffer, chunk.pcm.byteOffset, chunk.pcm.length >> 1)
      const down = new Int16Array(Math.floor(source.length / 3))
      for (let i = 0; i < down.length; i++) down[i] = Math.round((source[3 * i] + source[3 * i + 1] + source[3 * i + 2]) / 3)
      pieces.push({ at: play, pcm: down })
      play += source.length / OUTPUT_RATE
    }
  }
  const start = Math.min(remote0, ...pieces.map((p) => p.at))
  const length = Math.ceil((Math.max(...pieces.map((p) => p.at + p.pcm.length / rate)) - start + 0.5) * rate)
  const mix = new Int32Array(length)
  for (const piece of pieces) {
    const offset = Math.round((piece.at - start) * rate)
    for (let i = 0; i < piece.pcm.length && offset + i < length; i++) mix[offset + i] += piece.pcm[i]
  }
  const data = Buffer.alloc(length * 2)
  for (let i = 0; i < length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, mix[i])), i * 2)
  const head = Buffer.alloc(44)
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8); head.write("fmt ", 12)
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write("data", 36); head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

/* ---------- main ---------- */

function options(argv: string[]) {
  const value = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
  const snapshot = argv.find((arg, i) => !arg.startsWith("--") && !argv[i - 1]?.startsWith("--"))
  const core = value("--core")
  if (!snapshot || !core) throw new Error("usage: voice-stand.ts <catalog snapshot> --core <station base core> [--runs 3] [--out dir] [--voice Charon]")
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const recordings = join(homedir(), "inbox", "zeytun-recordings", "voice-stand")
  return { snapshot, core, runs: Number(value("--runs") ?? 1), scenario: value("--scenario") ?? join(HERE, "voice-scenario.json"),
    out: value("--out") ?? join(recordings, stamp), cache: join(recordings, "caller"), voice: value("--voice"),
    liveModel: value("--live-model") ?? "gemini-3.8-live", vertexKey: value("--vertex-key") ?? join(homedir(), ".config", "zeytun", "vertex-key"),
    secondEarKey: argv.includes("--no-second-ear") ? undefined : value("--second-ear-key") ?? join(homedir(), ".config", "zeytun", "speech-key"),
    station: value("--station"), departedFrom: value("--departed-from"), stopAt: Number(value("--stop-at") ?? 0.45),
    swapAt: value("--swap-at") === undefined ? undefined : Number(value("--swap-at")) }
}

async function main() {
  // The CRM's handler logs every lookup; the stand's own output is the report.
  console.log = (...args: unknown[]) => process.stderr.write(`${args.map(String).join(" ")}\n`)
  const opts = options(process.argv.slice(2))
  if (opts.secondEarKey && !existsSync(opts.secondEarKey)) throw new Error(`no second ear key at ${opts.secondEarKey} (or --no-second-ear)`)
  const scenario = JSON.parse(readFileSync(opts.scenario, "utf8")) as VoiceScenario
  if (opts.voice) scenario.voice = opts.voice
  mkdirSync(opts.out, { recursive: true, mode: 0o700 })
  const { catalog, snapshotAt, soldOut } = await loadCatalog(opts.snapshot, opts.departedFrom)
  if (opts.departedFrom) process.stderr.write(`sold out since the older snapshot: ${soldOut}\n`)
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: HERE }).toString().trim()
  const runs: Run[] = []
  for (let attempt = 1; attempt <= opts.runs; attempt++) {
    process.stderr.write(`run ${attempt}/${opts.runs}\n`)
    const run = await playCall(scenario, catalog, { core: opts.core, liveModel: opts.liveModel, voice: scenario.voice,
      vertexKey: opts.vertexKey, cache: opts.cache, station: opts.station, secondEarKey: opts.secondEarKey, stopAt: opts.stopAt, swapAt: opts.swapAt })
    const wav = join(opts.out, `run-${attempt}.wav`)
    writeFileSync(wav, recording(run.turns, 0), { mode: 0o600 })
    writeFileSync(join(opts.out, `run-${attempt}.json`), JSON.stringify({ ...run, turns: run.turns.map((turn) => ({ ...turn, audio: turn.audio.length })) }, null, 1), { mode: 0o600 })
    runs.push({ ...run, attempt, wav })
    if (run.stopped) { process.stderr.write(`stopped: ${run.stopped}\n`); break }
    if (attempt < opts.runs) await sleep(5000)
  }
  const file = join(opts.out, "report.md")
  writeFileSync(file, report(runs, scenario, { sha, liveModel: opts.liveModel, snapshotAt, station: opts.station, swapAt: opts.swapAt ?? null }), { mode: 0o600 })
  process.stderr.write(`report: ${file}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
