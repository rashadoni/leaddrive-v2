/**
 * Gemini half of the recognizer benchmark (recognizer-benchmark.ts), run ON
 * PROD, because the Gemini key lives only in /etc/leaddrive/app.env there.
 *
 * The benchmark sends this file as a `node -e` argument and the clips on
 * stdin; nothing is written on prod. The key is read inside this process and
 * goes only into the request header to Google: never printed, never in an
 * address, never in an error. Interactions calls say `store: false`.
 *
 * stdin: {"lists": {"<name>": ["Ketonal", …]}, "concurrency": 3, "transcribePerMinute": 6,
 *         "jobs": [{"id", "kind": "flash"|"transcribe", "model", "list"?, "thinking"?, "wav": "<base64>"}]}
 * stdout: one JSON line per job: {"id", "text"} | {"id", "error"}, plus "ms" —
 *         from sending the request to having its text.
 *
 * gemini-3.5-transcribe allows 10 requests a minute on this key's tier, and the demo
 * assistant (`/assistant/transcribe`) uses the same model and key: transcribe requests are
 * paced to `transcribePerMinute` (default 6) so the benchmark leaves it room.
 */
import { readFileSync } from "node:fs"

const API = "https://generativelanguage.googleapis.com/v1beta"

function geminiKey() {
  const line = readFileSync("/etc/leaddrive/app.env", "utf8").split("\n").find((entry) => entry.startsWith("GEMINI_API_KEY="))
  const value = (line ?? "").slice("GEMINI_API_KEY=".length).replace(/^["']|["']$/g, "").split(",")[0].trim()
  if (!value) throw new Error("GEMINI_API_KEY is not set on this host")
  return value
}

const FLASH_RULES = [
  "You transcribe one short phrase that a pharmacy in Baku says on the phone to a medicine wholesaler.",
  "The speech is Azerbaijani; product names are often brands of Russian or European origin.",
  "Write exactly what was said, in Azerbaijani Latin letters; write numbers as digits.",
  "When a word is the name of a product, spell it as it appears in the product list below.",
  "If no product is named, do not add one. Answer with the transcript only, nothing else.",
].join("\n")

function flashBody(job, names) {
  return {
    url: `${API}/models/${job.model}:generateContent`,
    body: {
      systemInstruction: { parts: [{ text: names?.length ? `${FLASH_RULES}\n\nProduct list:\n${names.join(", ")}` : FLASH_RULES.split("\n").filter((line) => !line.includes("product list")).join("\n") }] },
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "audio/wav", data: job.wav } }] }],
      generationConfig: { temperature: 0, ...(job.thinking ? { thinkingConfig: { thinkingLevel: job.thinking } } : {}) },
    },
    text: (json) => (json?.candidates?.[0]?.content?.parts ?? []).filter((part) => !part.thought && typeof part.text === "string").map((part) => part.text).join(" "),
  }
}

function transcribeBody(job, names) {
  return {
    url: `${API}/interactions`,
    body: {
      model: job.model,
      input: [{ type: "audio", data: job.wav, mime_type: "audio/wav" }],
      // Verbatim (the default): custom vocabulary is reported not to work in "smart" mode.
      generation_config: { transcription_config: { language_codes: ["az-AZ", "ru-RU"], ...(names?.length ? { custom_vocabulary: names } : {}) } },
      store: false,
    },
    text: (json) => {
      const parts = []
      for (const step of json?.steps ?? []) {
        if (step?.type !== "model_output") continue
        for (const block of step.content ?? []) if (block?.type === "text" && typeof block.text === "string") parts.push(block.text)
      }
      return parts.length ? parts.join(" ") : typeof json?.output_text === "string" ? json.output_text : ""
    },
  }
}

let nextTranscribeAt = 0
async function paced(job, perMinute) {
  if (job.kind !== "transcribe") return
  const at = Math.max(Date.now(), nextTranscribeAt)
  nextTranscribeAt = at + Math.ceil(60_000 / perMinute)
  if (at > Date.now()) await new Promise((done) => setTimeout(done, at - Date.now()))
}

async function run(job, key, lists) {
  const names = job.list ? lists[job.list] : undefined
  const request = job.kind === "flash" ? flashBody(job, names) : transcribeBody(job, names)
  const started = performance.now()
  try {
    const response = await fetch(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(60_000),
    })
    const json = await response.json().catch(() => null)
    const ms = Math.round(performance.now() - started)
    if (!response.ok) return { id: job.id, ms, error: `http ${response.status}: ${String(json?.error?.message ?? "").slice(0, 300)}` }
    return { id: job.id, ms, text: request.text(json).replace(/\s+/g, " ").trim() }
  } catch (error) {
    return { id: job.id, ms: Math.round(performance.now() - started), error: error?.name === "TimeoutError" ? "timeout" : "network" }
  }
}

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const input = JSON.parse(Buffer.concat(chunks).toString("utf8"))
const key = geminiKey()
const queue = [...input.jobs]
await Promise.all(Array.from({ length: Math.max(1, Math.min(8, input.concurrency ?? 3)) }, async () => {
  for (let job = queue.shift(); job; job = queue.shift()) {
    await paced(job, Math.max(1, Math.min(9, input.transcribePerMinute ?? 6)))
    process.stdout.write(`${JSON.stringify(await run(job, key, input.lists ?? {}))}\n`)
  }
}))
