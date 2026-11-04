/**
 * Gemini half of the dialog stand (dialog-stand.ts), run ON PROD, because the
 * Gemini key lives only in /etc/leaddrive/app.env there.
 *
 * The stand sends this file as a `node -e` argument over ssh and talks to it
 * in JSON lines; nothing is written on prod. The key is read inside this
 * process and goes only into the request header to Google: never printed,
 * never in an address, never in an error.
 *
 * stdin:  {"id", "model", "body"}   (a generateContent request body)
 * stdout: {"id", "ms", "json"} | {"id", "ms", "error"}
 */
import { readFileSync } from "node:fs"
import { createInterface } from "node:readline"

const API = "https://generativelanguage.googleapis.com/v1beta"

function geminiKey() {
  const line = readFileSync("/etc/leaddrive/app.env", "utf8").split("\n").find((entry) => entry.startsWith("GEMINI_API_KEY="))
  const value = (line ?? "").slice("GEMINI_API_KEY=".length).replace(/^["']|["']$/g, "").split(",")[0].trim()
  if (!value) throw new Error("GEMINI_API_KEY is not set on this host")
  return value
}

const key = geminiKey()

async function run({ id, model, body }) {
  const started = performance.now()
  if (typeof model !== "string" || !/^[a-z0-9.-]{3,80}$/.test(model)) return { id, ms: 0, error: "bad model" }
  try {
    const response = await fetch(`${API}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    })
    const json = await response.json().catch(() => null)
    const ms = Math.round(performance.now() - started)
    if (!response.ok) return { id, ms, error: `http ${response.status}: ${String(json?.error?.message ?? "").slice(0, 300)}` }
    return { id, ms, json }
  } catch (error) {
    return { id, ms: Math.round(performance.now() - started), error: error?.name === "TimeoutError" ? "timeout" : "network" }
  }
}

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue
  const request = JSON.parse(line)
  run(request).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
}
