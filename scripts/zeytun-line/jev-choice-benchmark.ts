/**
 * Can Jev (TypeSafe AI, a model that only chooses) pick the product a pharmacy named among the
 * line's catalog candidates, so the line's agent reads one candidate instead of five? Owner,
 * 2026-11-28: «может ли тут помочь jev? не ухудшая качество» — then «Да, делай».
 *
 * Measured on real lines of confirmed phone orders: the pharmacy's words as the agent wrote them
 * (spokenText) and the product the order was confirmed with (externalId). Each line is looked up
 * the way the line looks it up, on a catalog snapshot (stand-crm.ts, nothing reaches prod), and Jev
 * is asked which candidate the words name exactly, or "unsure". Jev's key lives only on prod: its
 * requests go through jev-relay.py there, as the line stand's Gemini socket goes through
 * line-stand-relay.py. Jev costs $0.042 per million input tokens: a thousand lines, about $0.06.
 *
 *   JITI_ALIAS='{"@":"'$PWD'/src"}' node_modules/.bin/jiti scripts/zeytun-line/jev-choice-benchmark.ts \
 *     <catalog.snapshot> <lines.jsonl> [--out <dir>] [--limit N]
 *
 * lines.jsonl: one {"spoken": "...", "externalId": "..."} a line. The lines and the snapshot are the
 * client's material: keep them and the output in ~/inbox, never in Git.
 */
import { spawn } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { crmFor, loadCatalog, type Json } from "./stand-crm"

const HERE = dirname(fileURLToPath(import.meta.url))
const CALL = "cd6dde94-3c11-405c-842d-a083efbfd0ad"
const THRESHOLDS = [0.8, 0.9, 0.95] as const

type Line = { spoken: string; externalId: string }
type Candidate = { externalId: string; name: string; nameAz?: string | null }
type Row = { spoken: string; truth: string; truthAt: number; candidates: Candidate[]; choice?: string; confidence?: number; error?: string }

function request(spoken: string, candidates: Candidate[]): Json {
  const criteria: Record<string, string> = {}
  candidates.forEach((c, i) => { criteria[`c${i + 1}`] = c.nameAz && c.nameAz !== c.name ? `${c.name} / ${c.nameAz}` : c.name })
  criteria.unsure = "The words fit more than one candidate (no form, strength or pack said and several exist), or none of them."
  return {
    model: "jev-latest",
    state: { caller_said: spoken, candidates: candidates.map((c, i) => ({ option: `c${i + 1}`, name: c.name, name_az: c.nameAz ?? null })) },
    questions: {
      product: {
        type: "choice",
        instructions: "A pharmacy orders medicines by phone in Azerbaijani; caller_said is what it said for one order line. "
          + "Choose the candidate that is exactly the product named: the same product, and the same form (ampoule, tablet, "
          + "capsule, gel, cream, syrup, suspension, drops, spray), strength and pack size whenever the words say them. "
          + "A number before qutu, ədəd or flakon is how many packs, not a strength or pack size. "
          + "When the words fit several candidates equally, or none, answer unsure: a wrong product is worse than a question.",
        criteria,
      },
    },
  }
}

function relay(keyFile: string, host: string) {
  const script = Buffer.from(readFileSync(join(HERE, "jev-relay.py"))).toString("base64")
  const child = spawn("ssh", ["-o", "BatchMode=yes", "-i", keyFile, host, `python3 -I -W ignore -c "$(printf %s '${script}' | base64 -d)"`],
    { stdio: ["pipe", "pipe", "inherit"] })
  const answers = new Map<number, Json>()
  const done = new Promise<void>((resolve) => child.on("exit", () => resolve()))
  createInterface({ input: child.stdout }).on("line", (line) => {
    const value = JSON.parse(line) as Json
    answers.set(Number(value.id), value)
  })
  return { send: (id: number, body: Json) => child.stdin.write(`${JSON.stringify({ id, body })}\n`), end: () => child.stdin.end(), done, answers }
}

async function main() {
  const argv = process.argv.slice(2)
  const value = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
  const [snapshot, linesFile] = argv.filter((arg, i) => !arg.startsWith("--") && !argv[i - 1]?.startsWith("--"))
  if (!snapshot || !linesFile) throw new Error("usage: jev-choice-benchmark.ts <catalog.snapshot> <lines.jsonl> [--out dir] [--limit N]")
  const out = value("--out") ?? join(homedir(), "inbox", "zeytun-recordings", "jev-bench")
  mkdirSync(out, { recursive: true, mode: 0o700 })
  const limit = Number(value("--limit") ?? 2000)
  const lines = readFileSync(linesFile, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Line).slice(0, limit)

  const { catalog } = await loadCatalog(snapshot)
  const crm = crmFor(catalog, [])
  const silent = console.log
  console.log = () => undefined // the handler's own [zeytun-line] lines
  await crm({ action: "session", callId: CALL })
  const rows: Row[] = []
  for (const line of lines) {
    const answer = await crm({ action: "search", callId: CALL, query: { text: line.spoken.slice(0, 240) } }) as Json
    const candidates = ((answer.candidates ?? []) as Candidate[]).map((c) => ({ externalId: c.externalId, name: c.name, nameAz: c.nameAz ?? null }))
    rows.push({ spoken: line.spoken, truth: line.externalId, truthAt: candidates.findIndex((c) => c.externalId === line.externalId), candidates })
  }
  console.log = silent

  // --dry: the lookups and the requests only, nothing sent (checking the benchmark itself).
  if (argv.includes("--dry")) {
    const sample = rows.find((r) => r.candidates.length > 1)
    process.stdout.write(`${rows.length} lines, truth among candidates ${rows.filter((r) => r.truthAt >= 0).length}\n`
      + `${sample ? JSON.stringify(request(sample.spoken, sample.candidates)).slice(0, 900) : "no line with several candidates"}\n`)
    return
  }
  const jev = relay(process.env.LEADDRIVE_PROD_SSH_KEY ?? join(homedir(), ".ssh/leaddrive_prod_2026_09_09"), process.env.LEADDRIVE_PROD_HOST ?? "root@13.140.132.245")
  rows.forEach((row, id) => { if (row.candidates.length > 1) jev.send(id, request(row.spoken, row.candidates)) })
  jev.end()
  await jev.done
  rows.forEach((row, id) => {
    const reply = jev.answers.get(id)
    if (!reply) return
    const answer = ((reply.answer as Json | undefined)?.answers as Json | undefined)?.product as Json | undefined
    if (reply.status !== 200 || !answer) { row.error = String(reply.detail ?? reply.status); return }
    row.choice = String(answer.choice)
    row.confidence = typeof answer.confidence === "number" ? answer.confidence : undefined
  })

  const asked = rows.filter((r) => r.candidates.length > 1)
  const answered = asked.filter((r) => r.choice)
  const report = [`# Jev выбирает товар из кандидатов линии`, "",
    `Строк подтверждённых заказов: ${rows.length}; верный товар среди кандидатов поиска: ${rows.filter((r) => r.truthAt >= 0).length}; `
      + `кандидат один (Jev не нужен): ${rows.filter((r) => r.candidates.length === 1).length}; спрошено у Jev: ${asked.length}, ответил: ${answered.length}.`, "",
    "| Порог уверенности | Jev уверен (доля спрошенных) | Из них верно | Ошибся (выбрал не тот товар) |", "|---|---|---|---|"]
  const pick = (r: Row) => (r.choice && /^c\d+$/.test(r.choice) ? r.candidates[Number(r.choice.slice(1)) - 1] : undefined)
  for (const t of THRESHOLDS) {
    const sure = answered.filter((r) => r.choice !== "unsure" && (r.confidence ?? 0) >= t)
    const right = sure.filter((r) => pick(r)?.externalId === r.truth)
    report.push(`| ${t} | ${sure.length} (${Math.round(100 * sure.length / Math.max(1, asked.length))} %) | ${right.length} | ${sure.length - right.length} |`)
  }
  const wrong = answered.filter((r) => r.choice !== "unsure" && (r.confidence ?? 0) >= 0.9 && pick(r)?.externalId !== r.truth)
  report.push("", "## Ошибки при уверенности ≥ 0.9", "", ...wrong.map((r) =>
    `- «${r.spoken}» → Jev: ${pick(r)?.name ?? r.choice} (${r.confidence?.toFixed(2)}); верно: ${r.candidates.find((c) => c.externalId === r.truth)?.name ?? "нет среди кандидатов"}`))
  writeFileSync(join(out, "report.md"), report.join("\n") + "\n", { mode: 0o600 })
  writeFileSync(join(out, "rows.json"), JSON.stringify(rows, null, 1), { mode: 0o600 })
  process.stdout.write(report.slice(0, 9).join("\n") + `\nreport: ${join(out, "report.md")}\n`)
}

void main().catch((error) => { process.stderr.write(`${String(error)}\n`); process.exit(1) })
