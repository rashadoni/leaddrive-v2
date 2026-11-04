/**
 * Dialog stand of the phone line (plan task 10): written pharmacy scenarios
 * played against the line's own rules, with no call and no owner's phone.
 *
 * What is real here:
 *  - the system prompt is the one the CRM gives the station: the session
 *    answer of createInboundPilotHandler (composeLinePrompt, empty notes);
 *  - the tools are the station's declarations (station-tool-declarations.json,
 *    kept equal to ZeytunInboundBridge._declarations() by a test);
 *  - every tool call runs through the station's own bridge
 *    (dialog-stand-bridge.py loads scripts/pbx/fanum-zeytun-inbound.py), and
 *    every request of the bridge is answered by the CRM's own handler on a
 *    catalog snapshot: the same search, projection, stock and promotions;
 *  - only the order writer, cancel and transfer are stubs: a save is written
 *    to the report and answered as the CRM answers (number, total, notFound).
 *
 * What is not: the model is the text gemini-3.8-flash, not the Live model of
 * the call, and the caller types instead of speaking, so recognition errors
 * are not in it (the audio stand of task 3 measures those).
 *
 *   JITI_ALIAS='{"@":"'$PWD'/src"}' node_modules/.bin/jiti scripts/zeytun-line/dialog-stand.ts <snapshot> \
 *     [--scenarios scripts/zeytun-line/dialog-scenarios.json] [--only id,id] [--repeat N] [--out report.md]
 *     [--model gemini-3.8-flash] [--thinking low] [--max-requests 300]
 *   (npx tsx works the same where it is installed)
 *
 * The snapshot is the line's catalog file from prod
 * (scripts/zeytun-line/fetch-catalog-snapshot.sh): the client's catalog, keep
 * copies out of Git. The model runs on prod over ssh (dialog-gemini-remote.mjs),
 * because the Gemini key lives only there; it is read in that process, never
 * printed, and nothing stays on prod. The key is shared with the live line:
 * --max-requests caps one run (gemini-3.8-flash, not the line's TTS model).
 */
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { ZeytunAvailableBalances } from "../../src/lib/voice-agent/pharmacy/zeytun-available-balances"
import { createInboundPilotHandler, type InboundPilotCatalog } from "../../src/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { resolvePhoneOrderLines, type PhoneOrderLineInput } from "../../src/lib/voice-agent/pharmacy/phone-orders"

const HERE = dirname(fileURLToPath(import.meta.url))

type Json = Record<string, unknown>
type Turn = string | { say: string; when?: { match: string; say: string }[] }
type ToolCheck = { name: string; args?: string; label?: string }
type ReplyCheck = { match: string; label: string }
export type Scenario = {
  id: string; title: string
  /** Why this scenario is expected to fail on today's line (a tool it still lacks): reported, not counted. */
  expectedFail?: string
  turns: Turn[]
  checks: { tools?: ToolCheck[]; noTools?: ToolCheck[]; reply?: ReplyCheck[]; noReply?: ReplyCheck[]; finalSave?: boolean; savedLines?: number
    /** The last save has a line whose spoken words match and whose quantity is this. */
    savedQuantity?: { spoken: string; quantity: number; label: string } }
}

/* ---------- prod Gemini over ssh ---------- */

class RemoteGemini {
  private child: ChildProcessWithoutNullStreams
  private pending = new Map<string, (value: { ms: number; json?: Json; error?: string }) => void>()
  requests = 0
  constructor(private maxRequests: number) {
    const script = readFileSync(join(HERE, "dialog-gemini-remote.mjs")).toString("base64")
    const key = process.env.LEADDRIVE_PROD_SSH_KEY ?? join(homedir(), ".ssh/leaddrive_prod_2026_09_09")
    const host = process.env.LEADDRIVE_PROD_HOST ?? "root@13.140.132.245"
    this.child = spawn("ssh", ["-o", "BatchMode=yes", "-i", key, host,
      `node --input-type=module -e "$(printf %s '${script}' | base64 -d)"`], { stdio: ["pipe", "pipe", "pipe"] })
    this.child.stderr.on("data", (chunk) => process.stderr.write(`[prod] ${chunk}`))
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      const value = JSON.parse(line) as { id: string; ms: number; json?: Json; error?: string }
      this.pending.get(value.id)?.(value)
      this.pending.delete(value.id)
    })
  }
  call(model: string, body: Json) {
    if (++this.requests > this.maxRequests) throw new Error(`more than --max-requests ${this.maxRequests} model requests`)
    const id = randomUUID()
    return new Promise<{ ms: number; json?: Json; error?: string }>((resolve) => {
      this.pending.set(id, resolve)
      this.child.stdin.write(`${JSON.stringify({ id, model, body })}\n`)
    })
  }
  close() { this.child.stdin.end() }
}

/* ---------- the station's bridge ---------- */

class StationBridge {
  private child = spawn("python3", ["-I", join(HERE, "dialog-stand-bridge.py")], { stdio: ["pipe", "pipe", "inherit"] })
  private waiting: ((value: { done?: unknown; error?: string }) => void)[] = []
  constructor(private crm: (body: Json) => Promise<unknown>) {
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      const message = JSON.parse(line) as { crm?: number; body?: Json; done?: unknown; error?: string }
      if (message.crm !== undefined) {
        void this.crm(message.body ?? {}).then((value) => this.send({ reply: message.crm, value }), () => this.send({ reply: message.crm, value: null }))
      } else this.waiting.shift()?.(message)
    })
  }
  private send(value: unknown) { this.child.stdin.write(`${JSON.stringify(value)}\n`) }
  async op<T>(value: Json): Promise<T> {
    const answer = await new Promise<{ done?: unknown; error?: string }>((resolve) => { this.waiting.push(resolve); this.send(value) })
    if (answer.error) throw new Error(`station bridge: ${answer.error}`)
    return answer.done as T
  }
  close() { this.child.stdin.end() }
}

/* ---------- the CRM on a snapshot ---------- */

type Event =
  | { kind: "caller"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; args: Json; result: Json }
  | { kind: "note"; text: string }

async function loadCatalog(path: string): Promise<{ catalog: InboundPilotCatalog; snapshotAt: string }> {
  const raw = readFileSync(path), newline = raw.indexOf(10)
  const header = JSON.parse(raw.subarray(0, newline).toString()) as { organizationId: string; scopeKey: string; version: string; observedAt: string }
  // The handler serves a catalog at most a day old; the stand reads it as observed now.
  const observedAt = new Date().toISOString()
  const feed = await ZeytunAvailableBalances.build(raw.subarray(newline + 1), { organizationId: header.organizationId, observedAt, source: "live" })
  return {
    snapshotAt: header.observedAt,
    catalog: { organizationId: header.organizationId, scopeKey: header.scopeKey, version: header.version, observedAt, source: "live",
      search: (query) => feed.search(header.organizationId, query) } as InboundPilotCatalog,
  }
}

function crmFor(catalog: InboundPilotCatalog, saves: { lines: PhoneOrderLineInput[]; final: boolean }[]) {
  const token = randomUUID().replaceAll("-", "")
  const now = Date.now()
  const config = {
    version: 1, enabled: true, purpose: "zeytun_line", id: randomUUID(), organizationId: "stand-line", channelConfigId: "stand-channel",
    issuedAt: new Date(now - 60_000).toISOString(), approvalReference: "dialog-stand",
    approvedSource: { organizationId: catalog.organizationId, scopeKey: catalog.scopeKey }, orderOrganizationId: "stand-orders",
  }
  const started = new Date(now - 1000).toISOString()
  let revision = 0
  const handler = createInboundPilotHandler(token, {
    loadConfig: async () => config,
    loadCall: async (_config, callId) => ({ id: `call-${callId}`, organizationId: config.organizationId, channelConfigId: config.channelConfigId,
      providerCallId: callId, provider: "asterisk", direction: "inbound", callMode: "ai", status: "in-progress", wasAnswered: true,
      endedAt: null, startedAt: started, fromNumber: "+994500000000", targetPhoneE164: "+994120000000", handoffState: null }),
    loadCatalog: async () => catalog,
    claim: async () => true,
    isClaimed: async () => true,
    findPharmacies: async () => [],
    requestTransfer: async () => "unavailable",
    cancelOrder: async () => "cancelled",
    // The order writer's answer, without a database: the CRM's own line resolution.
    saveOrder: async (_config, _call, orderCatalog, lines, _pharmacy, delivery) => {
      saves.push({ lines, final: delivery?.final === true })
      const resolved = resolvePhoneOrderLines(orderCatalog, lines)
      const total = resolved.reduce((sum, line) => sum + (line.lineTotal ? Number(line.lineTotal.toString()) : 0), 0)
      return { status: "saved", orderId: "stand", number: 9001, revision: ++revision, created: revision === 1, changed: true,
        total: total.toFixed(2), currency: "AZN", priced: resolved.filter((line) => line.lineTotal).length,
        unpriced: resolved.filter((line) => line.status === "resolved" && !line.lineTotal).map((line) => line.spokenText),
        notFound: resolved.filter((line) => line.status === "not_found").map((line) => line.spokenText) }
    },
  })
  return async (body: Json) => {
    const response = await handler(new Request("https://stand.invalid/api/internal/voice-agent/pharmacy-inbound", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }))
    return response.json()
  }
}

/* ---------- one scenario ---------- */

type Declarations = { functionDeclarations: Json[] }[]
type Options = { model: string; thinking: string; declarations: Declarations }

const nextSay = (turn: Turn, lastReply: string) => {
  if (typeof turn === "string") return turn
  return turn.when?.find((rule) => new RegExp(rule.match, "iu").test(lastReply))?.say ?? turn.say
}

async function playScenario(scenario: Scenario, catalog: InboundPilotCatalog, gemini: RemoteGemini, options: Options) {
  const saves: { lines: PhoneOrderLineInput[]; final: boolean }[] = []
  const bridge = new StationBridge(crmFor(catalog, saves))
  const events: Event[] = []
  try {
    const session = await bridge.op<{ prompt: string; opening: string; closing: string | null }>({ op: "open" })
    const closing = session.closing ?? "Sağ olun, xoş günlər!"
    // Live speaks the CRM's opening itself (the station prefills it): here it is the model's first turn.
    const contents: Json[] = [{ role: "user", parts: [{ text: "(zəng qoşuldu)" }] }, { role: "model", parts: [{ text: session.opening }] }]
    events.push({ kind: "assistant", text: session.opening })
    let lastReply = session.opening, closed = false
    let error: string | undefined
    try {
      for (const turn of scenario.turns) {
        if (closed) break
        const say = nextSay(turn, lastReply)
        events.push({ kind: "caller", text: say })
        contents.push({ role: "user", parts: [{ text: say }] })
        await bridge.op({ op: "note", content: { inputTranscription: { text: say } } })
        const said: string[] = []
        for (let step = 0; step < 8; step++) {
          const answer = await gemini.call(options.model, {
            systemInstruction: { parts: [{ text: session.prompt }] },
            contents, tools: options.declarations,
            generationConfig: { thinkingConfig: { thinkingLevel: options.thinking } },
          })
          if (answer.error) { events.push({ kind: "note", text: `модель: ${answer.error}` }); break }
          const content = ((answer.json?.candidates as Json[] | undefined)?.[0]?.content ?? { role: "model", parts: [] }) as { role: string; parts?: Json[] }
          const parts = content.parts ?? []
          contents.push({ role: "model", parts })
          const text = parts.filter((part) => typeof part.text === "string" && !part.thought).map((part) => part.text as string).join("").trim()
          if (text) {
            said.push(text)
            events.push({ kind: "assistant", text })
            await bridge.op({ op: "note", content: { modelTurn: { parts: [{ text }] } } })
          }
          const calls = parts.filter((part) => part.functionCall).map((part, index) => {
            const call = part.functionCall as { id?: string; name: string; args?: Json }
            return { id: call.id ?? `call-${contents.length}-${index}`, name: call.name, args: call.args ?? {}, own: call.id }
          })
          if (!calls.length) break
          const results = await bridge.op<{ id: string; name: string; response: Json }[]>({ op: "tools",
            calls: calls.map(({ id, name, args }) => ({ id, name, args })) })
          const responses = calls.map((call) => {
            const result = results.find((item) => item.id === call.id)?.response ?? { status: "no_response" }
            events.push({ kind: "tool", name: call.name, args: call.args, result })
            return { functionResponse: { name: call.name, ...(call.own ? { id: call.own } : {}), response: result } }
          })
          contents.push({ role: "user", parts: responses })
        }
        await bridge.op({ op: "note", content: { turnComplete: true } })
        lastReply = said.join(" ")
        if (lastReply.includes(closing)) closed = true
      }
    } catch (failure) {
      // On the station an invalid tool batch ends the call: the run stops here too.
      error = String((failure as Error).message ?? failure)
      events.push({ kind: "note", text: `обрыв: ${error}` })
    }
    const checks = await check(scenario, events, saves, bridge)
    if (error) checks.push({ label: "разговор дошёл до конца", ok: false, detail: error })
    return { events, saves, checks }
  } finally { bridge.close() }
}

/* ---------- checks ---------- */

type CheckResult = { label: string; ok: boolean; detail?: string }

async function check(scenario: Scenario, events: Event[], saves: { lines: PhoneOrderLineInput[]; final: boolean }[], bridge: StationBridge) {
  const replies = events.slice(1).filter((event): event is Extract<Event, { kind: "assistant" }> => event.kind === "assistant").map((event) => event.text)
  const tools = events.filter((event): event is Extract<Event, { kind: "tool" }> => event.kind === "tool")
  const results: CheckResult[] = []
  const toolHit = (rule: ToolCheck) => tools.some((tool) => tool.name === rule.name && (!rule.args || new RegExp(rule.args, "iu").test(JSON.stringify(tool.args))))
  for (const rule of scenario.checks.tools ?? []) results.push({ label: rule.label ?? `вызван ${rule.name}${rule.args ? ` (${rule.args})` : ""}`, ok: toolHit(rule) })
  for (const rule of scenario.checks.noTools ?? []) results.push({ label: rule.label ?? `не вызван ${rule.name}${rule.args ? ` (${rule.args})` : ""}`, ok: !toolHit(rule) })
  for (const rule of scenario.checks.reply ?? []) results.push({ label: rule.label, ok: replies.some((text) => new RegExp(rule.match, "iu").test(text)) })
  for (const rule of scenario.checks.noReply ?? []) {
    const bad = replies.find((text) => new RegExp(rule.match, "iu").test(text))
    results.push({ label: rule.label, ok: !bad, ...(bad ? { detail: bad } : {}) })
  }
  if (scenario.checks.finalSave) results.push({ label: "итоговое сохранение (final)", ok: saves.some((save) => save.final) })
  if (scenario.checks.savedLines !== undefined) {
    const last = saves.at(-1)
    const resolved = last?.lines.filter((line) => line.externalId).length ?? 0
    results.push({ label: `в последнем сохранении ${scenario.checks.savedLines} найденных строк`, ok: resolved === scenario.checks.savedLines, detail: `${resolved}` })
  }
  const want = scenario.checks.savedQuantity
  if (want) {
    const line = saves.at(-1)?.lines.find((item) => new RegExp(want.spoken, "iu").test(item.spoken))
    results.push({ label: want.label, ok: line?.quantity === want.quantity, detail: line ? `${line.quantity} ${line.unit}` : "строки нет" })
  }
  // The station's own language tests (zeytun_script, zeytun_is_english).
  const langs = await Promise.all(replies.map((text) => bridge.op<{ script: string; english: boolean }>({ op: "lang", text })))
  const english = replies.filter((_, index) => langs[index].english)
  const cyrillic = replies.filter((_, index) => langs[index].script === "cyrillic")
  results.push({ label: "ответы по-азербайджански (есть az-буквы)", ok: replies.length > 0 && langs.some((lang) => lang.script === "az") })
  results.push({ label: "нет английского", ok: !english.length, ...(english.length ? { detail: english[0] } : {}) })
  results.push({ label: "нет кириллицы", ok: !cyrillic.length, ...(cyrillic.length ? { detail: cyrillic[0] } : {}) })
  return results
}

/* ---------- report ---------- */

const quote = (text: string) => text.replace(/\s+/g, " ").replace(/\|/g, "\\|")

function toolLine(event: Extract<Event, { kind: "tool" }>) {
  const result = event.result as { status?: string; candidates?: { name: string; promotion?: unknown }[]; candidateCount?: number; orderNumber?: string; notFound?: string[] }
  const args = event.name === "save_order_list"
    ? `${(event.args.lines as unknown[] | undefined)?.length ?? 0} строк${event.args.final ? ", final" : ""}`
    : JSON.stringify(event.args)
  let outcome = result.status ?? ""
  if (event.name === "search_pharmacy_catalog" && result.candidates) {
    outcome = `${result.candidateCount} канд.: ${result.candidates.slice(0, 3).map((item) => `${item.name}${item.promotion ? " [акция]" : ""}`).join("; ") || "—"}`
  }
  if (result.notFound?.length) outcome += `, не найдено: ${result.notFound.join("; ")}`
  return `  - \`${event.name}\` ${quote(args)} → ${quote(outcome)}`
}

type Run = { scenario: Scenario; attempt: number; events: Event[]; checks: CheckResult[]; error?: string }

function report(runs: Run[], meta: { model: string; thinking: string; snapshotAt: string; sha: string; requests: number; repeat: number }) {
  const lines = [`# Стенд разговоров линии — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, "",
    `main \`${meta.sha}\`, модель \`${meta.model}\` (thinking ${meta.thinking}), снимок каталога ${meta.snapshotAt}, запросов к модели ${meta.requests}.`, "",
    "| Сценарий | Прошёл | Проверки | Примечание |", "|---|---|---|---|"]
  const ids = [...new Set(runs.map((run) => run.scenario.id))]
  for (const id of ids) {
    const mine = runs.filter((run) => run.scenario.id === id), scenario = mine[0].scenario
    const passed = mine.filter((run) => !run.error && run.checks.every((item) => item.ok)).length
    const checks = mine.reduce((sum, run) => sum + run.checks.filter((item) => item.ok).length, 0)
    const total = mine.reduce((sum, run) => sum + run.checks.length, 0)
    lines.push(`| ${id}. ${scenario.title} | ${passed}/${mine.length} | ${checks}/${total} | ${scenario.expectedFail ? `ожидаемо: ${scenario.expectedFail}` : ""} |`)
  }
  for (const run of runs) {
    const ok = !run.error && run.checks.every((item) => item.ok)
    lines.push("", `## ${run.scenario.id}. ${run.scenario.title}${meta.repeat > 1 ? ` — прогон ${run.attempt}` : ""}: ${ok ? "✅ пройден" : "❌ не пройден"}${run.scenario.expectedFail ? ` (ожидаемо не проходит: ${run.scenario.expectedFail})` : ""}`, "")
    if (run.error) lines.push(`Ошибка стенда: ${run.error}`, "")
    for (const event of run.events) {
      if (event.kind === "caller") lines.push(`- **Аптека:** ${quote(event.text)}`)
      else if (event.kind === "assistant") lines.push(`- **Ассистент:** ${quote(event.text)}`)
      else if (event.kind === "tool") lines.push(toolLine(event))
      else lines.push(`  - _${quote(event.text)}_`)
    }
    lines.push("", ...run.checks.map((item) => `- ${item.ok ? "✅" : "❌"} ${item.label}${item.detail && !item.ok ? ` — «${quote(item.detail).slice(0, 160)}»` : ""}`))
  }
  return `${lines.join("\n")}\n`
}

/* ---------- main ---------- */

function options(argv: string[]) {
  const [snapshot, ...rest] = argv
  const flags: Record<string, string> = {}
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[i + 1]?.startsWith("--") ? "1" : rest[++i] ?? "1"
  if (!snapshot) throw new Error("usage: dialog-stand.ts <snapshot> [--scenarios file] [--only id,id] [--repeat N] [--out report.md]")
  return { snapshot, flags }
}

async function main() {
  // The CRM handler's journal lines go to stderr: stdout is the report.
  console.log = (...args: unknown[]) => console.error(...args)
  const { snapshot, flags } = options(process.argv.slice(2))
  const scenarios = (JSON.parse(readFileSync(flags.scenarios ?? join(HERE, "dialog-scenarios.json"), "utf8")) as { scenarios: Scenario[] }).scenarios
    .filter((scenario) => !flags.only || flags.only.split(",").includes(scenario.id))
  const declarations = JSON.parse(readFileSync(join(HERE, "station-tool-declarations.json"), "utf8")) as Declarations
  const model = flags.model ?? "gemini-3.8-flash", thinking = flags.thinking ?? "low", repeat = Number(flags.repeat ?? 1)
  const { catalog, snapshotAt } = await loadCatalog(snapshot)
  const maxRequests = Number(flags["max-requests"] ?? 300)
  const gemini = new RemoteGemini(maxRequests)
  const runs: Run[] = []
  try {
    for (const scenario of scenarios) {
      for (let attempt = 1; attempt <= repeat; attempt++) {
        process.stderr.write(`${scenario.id} #${attempt}… `)
        try {
          const played = await playScenario(scenario, catalog, gemini, { model, thinking, declarations })
          runs.push({ scenario, attempt, events: played.events, checks: played.checks })
          process.stderr.write(`${played.checks.filter((item) => item.ok).length}/${played.checks.length}\n`)
        } catch (error) {
          runs.push({ scenario, attempt, events: [], checks: [], error: String((error as Error).message ?? error) })
          process.stderr.write(`error: ${(error as Error).message}\n`)
        }
        if (gemini.requests >= maxRequests) break
      }
      if (gemini.requests >= maxRequests) { process.stderr.write(`--max-requests ${maxRequests} reached, stopping\n`); break }
    }
  } finally { gemini.close() }
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: HERE }).toString().trim()
  const text = report(runs, { model, thinking, snapshotAt, sha, requests: gemini.requests, repeat })
  if (flags.out) writeFileSync(flags.out, text)
  else process.stdout.write(text)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
