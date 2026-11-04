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
 *     [--station <fanum-zeytun-inbound.py of a branch>]   (a station fix on its branch, before it is merged)
 *     [--departed-from <older snapshot>]   (what sold out since it, as the catalog refresh records it)
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

import type { InboundPilotCatalog } from "../../src/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import type { PhoneOrderLineInput } from "../../src/lib/voice-agent/pharmacy/phone-orders"
import { crmFor, historyFor, loadCatalog, StationBridge, type Json } from "./stand-crm"
import { check, nextSay, quote, toolLine, type CheckResult, type DialogEvent as Event, type Scenario } from "./stand-checks"

const HERE = dirname(fileURLToPath(import.meta.url))

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

/* ---------- one scenario ---------- */

type Declarations = { functionDeclarations: Json[] }[]
type Options = { model: string; thinking: string; declarations: Declarations; station?: string }

async function playScenario(scenario: Scenario, catalog: InboundPilotCatalog, gemini: RemoteGemini, options: Options) {
  const saves: { lines: PhoneOrderLineInput[]; final: boolean }[] = []
  const bridge = new StationBridge(crmFor(catalog, saves, scenario.history && historyFor(catalog, scenario.history)), options.station)
  const events: Event[] = []
  // Model rounds and their input tokens: on the call each round bills the whole context again (task 10, 2026-11-04).
  const usage = { rounds: 0, promptTokens: 0 }
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
          usage.rounds++
          usage.promptTokens += Number((answer.json?.usageMetadata as { promptTokenCount?: number } | undefined)?.promptTokenCount ?? 0)
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
    return { events, saves, checks, usage }
  } finally { bridge.close() }
}

/* ---------- report ---------- */

type Run = { scenario: Scenario; attempt: number; events: Event[]; checks: CheckResult[]; error?: string; usage?: { rounds: number; promptTokens: number } }

function report(runs: Run[], meta: { model: string; thinking: string; snapshotAt: string; sha: string; requests: number; repeat: number; station?: string }) {
  const lines = [`# Стенд разговоров линии — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, "",
    `main \`${meta.sha}\`, модель \`${meta.model}\` (thinking ${meta.thinking}), снимок каталога ${meta.snapshotAt}, запросов к модели ${meta.requests}.`,
    ...(meta.station ? ["", `Станция: **${meta.station}**, не \`scripts/pbx/fanum-zeytun-inbound.py\` этого коммита.`] : []), "",
    "| Сценарий | Прошёл | Проверки | Кругов модели | Токенов на вход | Примечание |", "|---|---|---|---|---|---|"]
  const ids = [...new Set(runs.map((run) => run.scenario.id))]
  for (const id of ids) {
    const mine = runs.filter((run) => run.scenario.id === id), scenario = mine[0].scenario
    const passed = mine.filter((run) => !run.error && run.checks.every((item) => item.ok)).length
    const checks = mine.reduce((sum, run) => sum + run.checks.filter((item) => item.ok).length, 0)
    const total = mine.reduce((sum, run) => sum + run.checks.length, 0)
    const rounds = mine.reduce((sum, run) => sum + (run.usage?.rounds ?? 0), 0)
    const tokens = mine.reduce((sum, run) => sum + (run.usage?.promptTokens ?? 0), 0)
    lines.push(`| ${id}. ${scenario.title} | ${passed}/${mine.length} | ${checks}/${total} | ${rounds} | ${tokens} | ${scenario.expectedFail ? `ожидаемо: ${scenario.expectedFail}` : ""} |`)
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
  const model = flags.model ?? "gemini-3.8-flash", thinking = flags.thinking ?? "low", repeat = Number(flags.repeat ?? 1), station = flags.station
  const { catalog, snapshotAt, soldOut } = await loadCatalog(snapshot, flags["departed-from"])
  if (flags["departed-from"]) process.stderr.write(`sold out since the older snapshot: ${soldOut}\n`)
  const maxRequests = Number(flags["max-requests"] ?? 300)
  const gemini = new RemoteGemini(maxRequests)
  const runs: Run[] = []
  try {
    for (const scenario of scenarios) {
      for (let attempt = 1; attempt <= repeat; attempt++) {
        process.stderr.write(`${scenario.id} #${attempt}… `)
        try {
          const played = await playScenario(scenario, catalog, gemini, { model, thinking, declarations, station })
          runs.push({ scenario, attempt, events: played.events, checks: played.checks, usage: played.usage })
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
  const text = report(runs, { model, thinking, snapshotAt, sha, requests: gemini.requests, repeat, station })
  if (flags.out) writeFileSync(flags.out, text)
  else process.stdout.write(text)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
