import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

// Enforcement test for the AI-timeout hardening.
//
// No server-side module may construct `new Anthropic(...)` directly — every call
// site must go through getAnthropicClient() (src/lib/ai/anthropic-client.ts),
// which bounds the timeout. The factory file is the single legal home for the
// raw constructor. This guards against a future edit re-introducing an unbounded
// client (the /deals "Da Vinci аналитика" infinite-spinner regression) and proves
// the refactor covered every site, not just the known ones.

const SRC = join(process.cwd(), "src")
const FACTORY = join(SRC, "lib", "ai", "anthropic-client.ts")
const BARE_CTOR = /new\s+Anthropic\s*\(/

function collectTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      // Test files legitimately mock the SDK with their own `new Anthropic()`.
      if (entry === "__tests__" || entry === "node_modules") continue
      collectTsFiles(full, acc)
    } else if (/\.tsx?$/.test(entry)) {
      acc.push(full)
    }
  }
  return acc
}

/** Strip whole-line and trailing `//` comments so prose can't trip the check. */
function stripComments(src: string): string {
  return src
    .split("\n")
    .filter((raw) => {
      const trimmed = raw.trim()
      return !(trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*"))
    })
    .map((raw) => raw.split("//")[0])
    .join("\n")
}

/**
 * True if `src` has a bare `new Anthropic(` in code. Tests the comment-stripped
 * source as a whole (not line-by-line) so a constructor split across lines —
 * `new` ⏎ `Anthropic(` — can't slip through (the regex's `\s+` spans the newline).
 */
function isBareConstructorInCode(src: string): boolean {
  return BARE_CTOR.test(stripComments(src))
}

describe("no bare `new Anthropic(` outside the factory", () => {
  it("every Anthropic client is constructed via getAnthropicClient()", () => {
    const offenders: string[] = []
    for (const file of collectTsFiles(SRC)) {
      if (file === FACTORY) continue
      if (isBareConstructorInCode(readFileSync(file, "utf8"))) {
        offenders.push(relative(process.cwd(), file))
      }
    }
    expect(
      offenders,
      `These files must build the client via getAnthropicClient() (see src/lib/ai/anthropic-client.ts) instead of a bare, unbounded new Anthropic(): ${offenders.join(", ")}`,
    ).toEqual([])
  }, 15_000)

  it("the factory itself still owns exactly one raw constructor", () => {
    // Sanity: the legal constructor lives here. If this ever reads 0, the factory
    // stopped binding a timeout; if >1, something odd crept in. Count only in code —
    // the file's own doc-comment mentions `new Anthropic(...)` in prose (false positive).
    const matches = stripComments(readFileSync(FACTORY, "utf8")).match(/new\s+Anthropic\s*\(/g) ?? []
    expect(matches.length).toBe(1)
  })
})
