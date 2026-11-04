/**
 * Which recognizer hears a pharmacy's product names best on the phone line
 * (docs/zeytun-line-recognition-plan.md, task 6). Measurement only: nothing
 * here touches the line, the station or prod data.
 *
 * Every phrase of a labelled set goes through each method, and every text
 * through the line's own catalog search (ZeytunAvailableBalances on a 1C
 * snapshot). Three numbers per method:
 *   - right product among the five candidates the agent would get;
 *   - false product: any candidate for a phrase that names none ("bəli",
 *     "on qutu", the pharmacy's name);
 *   - latency from sending the audio to having the text.
 *
 * Methods (--methods, comma-separated; default all but transcribe-*):
 *   model                — what the Live model sent to the search (labels' heardByModel);
 *   chirp-none|ordered|all — Google Speech-to-Text v2, chirp_3, az-AZ, with no hints,
 *                          the products the line has ordered, or every catalog name
 *                          (chirp_3 takes at most 1000 phrases a request, so "all" is
 *                          split into parallel requests; latency is the slowest, the
 *                          texts are searched each and their candidates interleaved);
 *   flash-none|ordered|all — Gemini (generateContent, --flash-model) with the audio and
 *                          the name list in the instructions, run on prod;
 *   transcribe-none|ordered — gemini-3.5-transcribe with the list as custom vocabulary
 *                          (at most 1000 terms), run on prod. Only with --allow-transcribe:
 *                          the key gets 10 requests a minute and 100 a day for this model, and
 *                          the demo assistant's speech-to-text (/assistant/transcribe) uses the
 *                          same model and key — 2026-11-04 one full run of 47 phrases × 2 used up
 *                          the day. Run it on a small set or when the demo is idle.
 * For every recognizer the table also shows "model+<method>": the model's query first,
 * the recognizer's candidates after — the way task 8.1 would combine them.
 *
 *   node --import jiti/register scripts/zeytun-line/recognizer-benchmark.ts \
 *     --labels ~/inbox/zeytun-recordings/segments/labels.jsonl \
 *     --snapshot <tmp>/catalog.snapshot --ordered ~/inbox/zeytun-recordings/ordered-products.txt \
 *     --out <tmp>/run [--methods model,chirp-none,…] [--detail] [--fresh] [--allow-transcribe]
 *
 * Labels: one JSON line per phrase, {"file", "call", "said", "expected": [externalId…],
 * "expectedNames"?, "heardByModel": "text" | ["text", …], "use"?}; "file" is relative to the
 * labels file; "use": false leaves a doubtful phrase out (cut-caller-phrases.py writes these).
 * Each text is searched on its own and a product counts as found in any of the five-candidate
 * lists, as the agent gets five per search (so "model" matches the stand's baseline count).
 * Ordered products: "externalId|count" lines (most ordered first).
 * Chirp: ~/.config/zeytun/speech-key (mode 600) holds a service account's JSON key (role Cloud
 * Speech Client) or an hour-long access token (`gcloud auth print-access-token`); v2 takes no API
 * key. The Google Cloud project id comes from --project, ~/.config/zeytun/speech-project or the
 * service account; region --chirp-region (default eu: chirp_3 is in "eu" and "us"); --boost N
 * gives every hint that boost (default: none, as in Google's chirp_3 example).
 * Gemini: runs recognizer-gemini-remote.mjs on prod over ssh (key read there); --flash-model
 * (default gemini-3.8-flash), --thinking low|medium|high|none (default low; 3.8 Flash refuses
 * "minimal"), --concurrency (default 3), --transcribe-rpm (default 6: the model allows 10 a
 * minute and the demo assistant shares it). Failed requests (429, timeout) are asked again on
 * the next run; successful ones are kept.
 *
 * Transcripts are kept in <out>/transcripts.json and reused, so a second run only
 * re-scores (--fresh asks again). <out> holds what callers said: keep it out of Git,
 * like the snapshot (scripts/zeytun-line/fetch-catalog-snapshot.sh).
 */
import { execFileSync, spawn } from "node:child_process"
import { createSign } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { ZeytunAvailableBalances } from "../../src/lib/voice-agent/pharmacy/zeytun-available-balances"
import { spokenNameKey } from "../../src/lib/voice-agent/pharmacy/name-search"
import { spokenProductName } from "../../src/lib/voice-agent/pharmacy/zeytun-learned-names"

interface Label { file: string; call?: string; said: string; expected: string[]; expectedNames?: string[]; heardByModel?: string | string[]; use?: boolean }
interface Transcript { texts: string[]; ms: number | null; error?: string }

const CHIRP_PHRASE_LIMIT = 1000
const TRANSCRIBE_VOCABULARY_LIMIT = 1000
const ALL_METHODS = ["model", "chirp-none", "chirp-ordered", "chirp-all", "flash-none", "flash-ordered", "flash-all", "transcribe-none", "transcribe-ordered"]
/** transcribe-* only on request: the model allows 100 requests a day on this key and the demo assistant needs them. */
const DEFAULT_METHODS = ALL_METHODS.filter((method) => !method.startsWith("transcribe-"))
const ORG = "benchmark"
const GENERIC_WORD_LABELS = 60

function args() {
  const out: Record<string, string | boolean> = {}
  const argv = process.argv.slice(2)
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (!flag.startsWith("--")) throw new Error(`unexpected argument ${flag}`)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith("--")) out[flag.slice(2)] = true
    else { out[flag.slice(2)] = next; index++ }
  }
  return out
}

const expand = (path: string) => resolve(path.replace(/^~(?=\/)/, homedir()))

function privateFile(path: string): string {
  const mode = statSync(path).mode & 0o777
  if (mode & 0o077) throw new Error(`${path} must not be readable by others (chmod 600), mode is ${mode.toString(8)}`)
  return readFileSync(path, "utf8").trim()
}

function readLabels(path: string): Label[] {
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim()).map((line, index) => {
    const label = JSON.parse(line) as Label
    if (typeof label.file !== "string" || typeof label.said !== "string" || !Array.isArray(label.expected)) throw new Error(`labels line ${index + 1}: file, said and expected are required`)
    return label
  }).filter((label) => label.use !== false)
}

async function loadCatalog(path: string) {
  const raw = readFileSync(path), newline = raw.indexOf(10)
  const payload = raw.subarray(newline + 1)
  const goods = (JSON.parse(payload.toString()) as { data: { goods: { Номенклатура: { Guid: string; Наименование: string; НаименованиеАз?: string } }[] } }).data.goods
  const feed = await ZeytunAvailableBalances.build(payload, { organizationId: ORG, observedAt: new Date().toISOString(), source: "attachment" })
  const items = new Map(goods.map((row) => [row.Номенклатура.Guid, { name: row.Номенклатура.Наименование, nameAz: row.Номенклатура.НаименованиеАз || null }]))
  // How many labels each folded word is in: "таблетки", "гель", "крем" are in hundreds and name no product.
  const wordLabels = new Map<string, number>()
  for (const item of items.values()) {
    for (const word of new Set(spokenNameKey(`${item.name} ${item.nameAz ?? ""}`).split(" "))) wordLabels.set(word, (wordLabels.get(word) ?? 0) + 1)
  }
  return { feed, items, wordLabels }
}

/** Hint names, as the line words them for its recognizer (spokenProductName), unique, in the given order. */
function hintNames(ids: Iterable<string>, items: Map<string, { name: string; nameAz: string | null }>): string[] {
  const seen = new Set<string>(), names: string[] = []
  for (const id of ids) {
    const item = items.get(id)
    const name = item ? spokenProductName(item) : null
    if (name && name.length <= 100 && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); names.push(name) }
  }
  return names
}

function orderedIds(path: string | undefined): string[] {
  if (!path) return []
  return readFileSync(expand(path), "utf8").split("\n").map((line) => line.split("|")[0].trim()).filter(Boolean)
}

/**
 * Each text searched on its own, five candidates each — what the agent gets per search. A product
 * counts as found when it is in any of the lists, and first when it heads one of them.
 */
function searchAll(feed: ZeytunAvailableBalances, texts: string[]) {
  const lists = texts.filter((text) => text.trim()).map((text) => feed.search(ORG, { text: text.trim().slice(0, 240) }).candidates.slice(0, 5))
  const rankOf = (id: string) => Math.min(...lists.map((list) => list.findIndex((item) => item.externalId === id) + 1 || Infinity))
  const shown: string[] = []
  for (let rank = 0; rank < 5; rank++) for (const list of lists) if (list[rank] && !shown.includes(list[rank].name)) shown.push(list[rank].name)
  return { rankOf, shown: shown.slice(0, 5) }
}

// ---- Chirp 3 (Speech-to-Text v2), from this box ----

/**
 * Auth for Speech-to-Text from the key file: a service account's JSON key, or an OAuth access
 * token ("ya29.…", `gcloud auth print-access-token`, lives an hour) where the organization forbids
 * account keys. Not an API key: v2 refuses plain and service-account-bound API keys alike ("API keys
 * are not supported by this API", both tried 2026-11-04); one is still passed through, so Google's
 * answer shows in the table if that changes. The secret goes only into a request header.
 */
async function speechAuth(secret: string): Promise<{ headers: Record<string, string>; project?: string }> {
  if (secret.startsWith("ya29.")) return { headers: { Authorization: `Bearer ${secret}` } }
  if (!secret.startsWith("{")) return { headers: { "x-goog-api-key": secret } }
  const account = JSON.parse(secret) as { client_email: string; private_key: string; project_id?: string }
  const now = Math.floor(Date.now() / 1000)
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: account.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`
  const assertion = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(account.private_key, "base64url")}`
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  })
  const json = await response.json().catch(() => null) as { access_token?: string; error?: string } | null
  if (!response.ok || !json?.access_token) throw new Error(`service account token refused: http ${response.status} ${json?.error ?? ""}`)
  return { headers: { Authorization: `Bearer ${json.access_token}` }, project: account.project_id }
}

async function chirp(wav: Buffer, phrases: string[], options: { headers: Record<string, string>; project: string; region: string; boost?: number }): Promise<Transcript> {
  const shards: string[][] = []
  for (let start = 0; start < phrases.length; start += CHIRP_PHRASE_LIMIT) shards.push(phrases.slice(start, start + CHIRP_PHRASE_LIMIT))
  const results = await Promise.all((shards.length ? shards : [[]]).map(async (shard) => {
    const body = {
      config: {
        model: "chirp_3", languageCodes: ["az-AZ"], autoDecodingConfig: {},
        ...(shard.length ? { adaptation: { phraseSets: [{ inlinePhraseSet: { phrases: shard.map((value) => ({ value, ...(options.boost ? { boost: options.boost } : {}) })) } }] } } : {}),
      },
      content: wav.toString("base64"),
    }
    const url = `https://${options.region}-speech.googleapis.com/v2/projects/${encodeURIComponent(options.project)}/locations/${options.region}/recognizers/_:recognize`
    const started = performance.now()
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...options.headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) })
      const json = await response.json().catch(() => null) as { error?: { message?: string }; results?: { alternatives?: { transcript?: string }[] }[] } | null
      const ms = Math.round(performance.now() - started)
      if (!response.ok) return { ms, error: `http ${response.status}: ${String(json?.error?.message ?? "").slice(0, 300)}` }
      return { ms, text: (json?.results ?? []).map((result) => result.alternatives?.[0]?.transcript ?? "").join(" ").replace(/\s+/g, " ").trim() }
    } catch (error) {
      return { ms: Math.round(performance.now() - started), error: (error as Error).name === "TimeoutError" ? "timeout" : "network" }
    }
  }))
  const failed = results.find((result) => "error" in result && result.error)
  const ms = Math.max(...results.map((result) => result.ms))
  if (failed && "error" in failed) return { texts: [], ms, error: failed.error }
  return { texts: [...new Set(results.map((result) => ("text" in result ? result.text ?? "" : "")))].filter(Boolean), ms }
}

// ---- Gemini, on prod ----

function prodGemini(jobs: object[], lists: Record<string, string[]>, concurrency: number, transcribePerMinute: number): Promise<Map<string, { text?: string; error?: string; ms: number }>> {
  const script = readFileSync(join(dirname(new URL(import.meta.url).pathname), "recognizer-gemini-remote.mjs")).toString("base64")
  const key = process.env.LEADDRIVE_PROD_SSH_KEY ?? join(homedir(), ".ssh/leaddrive_prod_2026_09_09")
  const host = process.env.LEADDRIVE_PROD_HOST ?? "root@13.140.132.245"
  // The script travels as an argument (base64: no quoting), the clips on stdin; prod keeps nothing.
  const child = spawn("ssh", ["-o", "BatchMode=yes", "-i", key, host, `node --input-type=module -e "$(printf %s '${script}' | base64 -d)"`], { stdio: ["pipe", "pipe", "inherit"] })
  const results = new Map<string, { text?: string; error?: string; ms: number }>()
  let buffer = ""
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8")
    for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
      if (!line.trim()) continue
      const result = JSON.parse(line) as { id: string; text?: string; error?: string; ms: number }
      results.set(result.id, result)
      process.stderr.write(".")
    }
  })
  child.stdin.end(JSON.stringify({ lists, concurrency, transcribePerMinute, jobs }))
  return new Promise((done, fail) => child.on("close", (code) => {
    process.stderr.write("\n")
    if (code === 0) done(results)
    else fail(new Error(`prod Gemini run exited ${code} after ${results.size} of ${jobs.length} jobs`))
  }))
}

// ---- report ----

const pct = (part: number, whole: number) => (whole ? `${(100 * part / whole).toFixed(0)}% (${part}/${whole})` : "—")
function percentile(values: number[], p: number): string {
  if (!values.length) return "—"
  const sorted = [...values].sort((a, b) => a - b)
  return `${(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] / 1000).toFixed(2)} s`
}

async function main() {
  const opts = args()
  if (!opts.labels || !opts.snapshot || !opts.out) throw new Error("usage: recognizer-benchmark.ts --labels <labels.jsonl> --snapshot <catalog.snapshot> --out <dir> [--ordered <file>] [--methods a,b] [--detail] [--fresh]")
  const labelsPath = expand(String(opts.labels)), outDir = expand(String(opts.out))
  const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim()
  if (`${outDir}/`.startsWith(`${repo}/`)) throw new Error("--out holds what callers said: put it outside the repository")
  mkdirSync(outDir, { recursive: true, mode: 0o700 })
  const labels = readLabels(labelsPath)
  const methods = String(opts.methods ?? DEFAULT_METHODS.join(",")).split(",").map((method) => method.trim()).filter(Boolean)
  for (const method of methods) if (!ALL_METHODS.includes(method)) throw new Error(`unknown method ${method}; known: ${ALL_METHODS.join(", ")}`)
  if (methods.some((method) => method.startsWith("transcribe-")) && !opts["allow-transcribe"]) {
    throw new Error("transcribe-* shares gemini-3.5-transcribe's 100 requests a day with the demo assistant: add --allow-transcribe to run it")
  }

  const { feed, items, wordLabels } = await loadCatalog(expand(String(opts.snapshot)))
  const ordered = orderedIds(opts.ordered as string | undefined)
  const orderedNames = hintNames(ordered, items)
  const allNames = hintNames([...ordered, ...[...items.keys()].sort((a, b) => items.get(a)!.name.localeCompare(items.get(b)!.name))], items)
  const lists: Record<string, string[]> = { ordered: orderedNames, all: allNames }
  console.log(`phrases: ${labels.length} (${labels.filter((label) => !label.expected.length).length} without a product), catalog items: ${items.size}, hint names: all ${allNames.length}, ordered ${orderedNames.length}`)
  if (methods.some((method) => method.endsWith("-ordered")) && !orderedNames.length) throw new Error("an *-ordered method needs --ordered with products found in the snapshot")

  const cachePath = join(outDir, "transcripts.json")
  const cache: Record<string, Transcript> = existsSync(cachePath) && !opts.fresh ? JSON.parse(readFileSync(cachePath, "utf8")) : {}
  const save = () => writeFileSync(cachePath, JSON.stringify(cache, null, 1), { mode: 0o600 })
  const wavOf = (label: Label) => readFileSync(resolve(dirname(labelsPath), label.file))
  const keyOf = (method: string, label: Label) => `${method}\t${label.file}`

  // (a) the Live model's own query
  for (const label of labels) {
    const heard = label.heardByModel === undefined ? [] : Array.isArray(label.heardByModel) ? label.heardByModel : [label.heardByModel]
    cache[keyOf("model", label)] = { texts: heard, ms: null }
  }

  // (b) Chirp 3
  const chirpMethods = methods.filter((method) => method.startsWith("chirp-"))
  if (chirpMethods.length) {
    const keyFile = join(homedir(), ".config/zeytun/speech-key"), projectFile = join(homedir(), ".config/zeytun/speech-project")
    if (!existsSync(keyFile)) throw new Error(`no Speech-to-Text key: ${keyFile} (mode 600)`)
    const auth = await speechAuth(privateFile(keyFile))
    const project = String(opts.project ?? (existsSync(projectFile) ? readFileSync(projectFile, "utf8").trim() : auth.project ?? ""))
    if (!project) throw new Error(`no Google Cloud project id: --project or ${projectFile}`)
    const chirpOptions = { headers: auth.headers, project, region: String(opts["chirp-region"] ?? "eu"), boost: opts.boost ? Number(opts.boost) : undefined }
    for (const method of chirpMethods) {
      const phrases = method === "chirp-none" ? [] : lists[method.slice("chirp-".length)]
      for (const label of labels) {
        if (cache[keyOf(method, label)] && !cache[keyOf(method, label)].error) continue
        cache[keyOf(method, label)] = await chirp(wavOf(label), phrases, chirpOptions)
        process.stderr.write(".")
      }
      process.stderr.write("\n")
      save()
    }
  }

  // (c) Gemini on prod
  const geminiMethods = methods.filter((method) => method.startsWith("flash-") || method.startsWith("transcribe-"))
  const jobs: object[] = []
  for (const method of geminiMethods) {
    const [kind, list] = method.split("-")
    for (const label of labels) {
      if (cache[keyOf(method, label)] && !cache[keyOf(method, label)].error) continue
      jobs.push({
        id: keyOf(method, label), kind,
        model: kind === "flash" ? String(opts["flash-model"] ?? "gemini-3.8-flash") : "gemini-3.5-transcribe",
        ...(list === "none" ? {} : { list: kind === "transcribe" ? `${list}:vocabulary` : list }),
        ...(kind === "flash" && opts.thinking !== "none" ? { thinking: String(opts.thinking ?? "low") } : {}),
        wav: wavOf(label).toString("base64"),
      })
    }
  }
  if (jobs.length) {
    if (geminiMethods.includes("transcribe-all")) throw new Error("transcribe-all is not offered: custom vocabulary takes at most 1000 terms")
    const remoteLists = { ...lists, "ordered:vocabulary": orderedNames.slice(0, TRANSCRIBE_VOCABULARY_LIMIT) }
    console.log(`Gemini on prod: ${jobs.length} requests`)
    const results = await prodGemini(jobs, remoteLists, Number(opts.concurrency ?? 3), Number(opts["transcribe-rpm"] ?? 6))
    for (const [id, result] of results) cache[id] = result.error ? { texts: [], ms: result.ms, error: result.error } : { texts: result.text ? [result.text] : [], ms: result.ms }
    save()
  }

  // score
  // Catalog names, folded the way the search folds words: four letters or more ("on", "bəli" are not
  // names), and not a word of more than GENERIC_WORD_LABELS labels (a form like "таблетки", not a name).
  const catalogWords = new Set(allNames.map((name) => spokenNameKey(name))
    .filter((key) => key.length >= 4 && !key.includes(" ") && (wordLabels.get(key) ?? 0) <= GENERIC_WORD_LABELS))
  const inventedNames = (texts: string[], said: string) => {
    const saidWords = new Set(spokenNameKey(said).split(" "))
    return [...new Set(texts.flatMap((text) => spokenNameKey(text).split(" ")))].filter((word) => catalogWords.has(word) && !saidWords.has(word))
  }
  const rows: string[][] = [["method", "product in five", "product first", "phrase complete", "false product (none said)", "invented name (product said)", "errors", "latency p50", "p90"]]
  const detail: string[] = []
  const scored = [...methods, ...methods.filter((method) => method !== "model").map((method) => `model+${method}`)]
  for (const method of scored) {
    let hit = 0, expected = 0, first = 0, complete = 0, withProduct = 0, falseHit = 0, empty = 0, invented = 0, errors = 0
    const latencies: number[] = []
    for (const label of labels) {
      const parts = method.startsWith("model+") ? ["model", method.slice("model+".length)] : [method]
      const transcripts = parts.map((part) => cache[keyOf(part, label)] ?? { texts: [], ms: null, error: "not run" })
      const own = transcripts[transcripts.length - 1]
      if (own.error) errors++
      if (own.ms !== null && !own.error && !method.startsWith("model+")) latencies.push(own.ms)
      const found = searchAll(feed, transcripts.flatMap((transcript) => transcript.texts))
      const ranks = label.expected.map((id) => found.rankOf(id))
      const wrongNames = inventedNames(transcripts.flatMap((transcript) => transcript.texts), [label.said, ...(label.expectedNames ?? [])].join(" "))
      let verdict: string
      const rank = ranks.map((place) => (Number.isFinite(place) ? `#${place}` : "—")).join(",")
      if (label.expected.length) {
        withProduct++
        expected += label.expected.length
        const got = ranks.filter((place) => Number.isFinite(place)).length
        hit += got
        first += ranks.filter((place) => place === 1).length
        if (got === label.expected.length) complete++
        if (wrongNames.length) invented++
        verdict = got === label.expected.length ? "✓" : got ? "½" : "✗"
      } else {
        empty++
        if (wrongNames.length) falseHit++
        verdict = wrongNames.length ? "✗ false product" : "✓"
      }
      if (wrongNames.length) verdict += ` [${wrongNames.join(", ")}]`
      if (opts.detail && !method.startsWith("model+")) {
        detail.push(`${method.padEnd(18)} ${verdict.padEnd(18)} ${label.file}  said: ${label.said}\n${" ".repeat(36)}heard: ${own.error ? `ERROR ${own.error}` : transcripts.flatMap((t) => t.texts).join(" | ") || "—"}\n${" ".repeat(36)}found${rank ? ` (expected ${rank})` : ""}: ${found.shown.map((name) => name.slice(0, 28).trim()).join("; ") || "—"}`)
      }
    }
    rows.push([method, pct(hit, expected), pct(first, expected), pct(complete, withProduct), pct(falseHit, empty), pct(invented, withProduct), String(errors), percentile(latencies, 0.5), percentile(latencies, 0.9)])
  }
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)))
  const table = rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join("  ")).join("\n")
  console.log(`\n${table}`)
  if (detail.length) console.log(`\n${detail.join("\n")}`)
  writeFileSync(join(outDir, "report.txt"), `${table}\n\n${detail.join("\n")}\n`, { mode: 0o600 })
  console.log(`\nsaved ${join(outDir, "report.txt")} and ${cachePath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
