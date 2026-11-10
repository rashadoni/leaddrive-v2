/**
 * Claude is reached through one door: `src/lib/ai/gateway` (owner, 2026-11-09:
 * «чётко, с одного входа и выхода»). Before it, 46 files built their own
 * client and 36 places read keys straight from the environment, so a
 * client's own key, its budget and its spend report could not exist.
 *
 * The door picks the organization's key or the platform's, checks the
 * organization's AI budget and writes every paid call to `ai_usage`. A file
 * that builds a client itself skips all three — this test names it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.join(process.cwd(), "src")
const DOOR = [
  path.join("lib", "ai", "gateway") + path.sep,
  path.join("lib", "ai", "anthropic-client.ts"),
]

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sources(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ["builds its own client (getAnthropicClient)", /\bgetAnthropicClient\s*\(/],
  ["imports the low-level client factory", /from\s+["'](?:@\/lib\/ai|\.{1,2}(?:\/[\w-]+)*)\/anthropic-client["']/],
  ["builds its own client (new Anthropic)", /\bnew\s+Anthropic\s*\(/],
  ["reads the platform key itself", /process\.env\.ANTHROPIC_API_KEY/],
  // Stage 3 (2026-11-10): Gemini, OpenAI, Voyage and Google Vision go through
  // the same door; their platform keys are read only in gateway/platform-key.ts.
  ["reads a platform provider key itself", /\benv\.(?:GEMINI_API_KEY|OPENAI_API_KEY|VOYAGE_API_KEY|GOOGLE_VISION_API_KEY)\b/],
  ["imports the SDK as a value (types only outside the gateway)", /^import\s+(?!type\b)[^"']*?from\s+["']@anthropic-ai\/sdk["']/m],
]

describe("one door to every AI provider", () => {
  it("no file outside src/lib/ai/gateway builds a Claude client or reads a provider key", () => {
    const offenders: string[] = []
    for (const file of sources(ROOT)) {
      const relative = path.relative(ROOT, file)
      if (DOOR.some((door) => relative === door || relative.startsWith(door))) continue
      const text = readFileSync(file, "utf8")
      for (const [why, pattern] of FORBIDDEN) if (pattern.test(text)) offenders.push(`${relative}: ${why}`)
    }
    expect(offenders).toEqual([])
  })

  it("every feature the door is called with is named in the spend report", async () => {
    const { AI_FEATURES } = await import("@/lib/ai/gateway/features")
    const named = new Set(Object.keys(AI_FEATURES))
    const unnamed: string[] = []
    for (const file of sources(ROOT)) {
      const text = readFileSync(file, "utf8")
      for (const call of text.matchAll(/\b(?:anthropicFor|anthropicAccess|anthropicOrRefusal|resolveTranscriptionClient|resolveVisionOcrClient|voyageEmbedding)\([^,()]+,\s*"([\w-]+)"/g)) {
        if (!named.has(call[1])) unnamed.push(`${path.relative(ROOT, file)}: ${call[1]}`)
      }
      // The provider is the second argument of the plain-HTTP door.
      for (const call of text.matchAll(/\b(?:aiKeyFor|aiKeyOrRefusal|journalPlatformAiCall|journalAiCallOnCurrentKey)\([^,()]+,\s*"[\w-]+",\s*"([\w-]+)"/g)) {
        if (!named.has(call[1])) unnamed.push(`${path.relative(ROOT, file)}: ${call[1]}`)
      }
    }
    expect(unnamed).toEqual([])
  })
})
