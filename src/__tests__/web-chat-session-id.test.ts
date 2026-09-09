import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Finding F-35 (docs/isms/ISMS-02-gap-analysis.md).
 *
 * The web-chat session id is the whole credential: messages, typing, upload and
 * message all accept it alone, from anyone, over endpoints that answer 200
 * anonymously. `@default(cuid())` is the wrong generator for a bearer value —
 * a cuid carries a timestamp prefix, a per-process fingerprint and a sequential
 * counter, and its authors say plainly it is not a security primitive.
 *
 * The fix keeps the column and the widget untouched: the id is simply supplied
 * from a CSPRNG at creation, so existing sessions keep working and new ones
 * stop being guessable.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(l => {
      const t = l.trim()
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*")
    })
    .join("\n")
}

describe("web chat session identity", () => {
  const src = code("src/app/api/v1/public/web-chat/session/route.ts")

  it("generates the session id from a CSPRNG", () => {
    expect(src).toContain("randomBytes")
    expect(src).toMatch(/id:\s*sessionId/)
  })

  it("does not fall back to the database default", () => {
    // Leaving the id to @default(cuid()) is exactly the defect.
    expect(src).not.toMatch(/webChatSession\.create\(\{\s*data:\s*\{\s*organizationId/)
  })

  it("uses at least 128 bits", () => {
    const bytes = /randomBytes\((\d+)\)/.exec(src)?.[1]
    expect(Number(bytes)).toBeGreaterThanOrEqual(16)
  })
})
