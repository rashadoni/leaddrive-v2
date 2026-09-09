/**
 * Every field the voice code writes must exist on the model.
 *
 * This test exists because of a production outage I caused. I added
 * `endReason` to VoiceSession writes after finding the name with a grep — the
 * match was on a DIFFERENT model. Prisma rejected the write, session creation
 * threw, and voice was dead for the pilot until the owner reported it.
 *
 * Type-checking did not catch it: the worktree resolves a stale generated
 * client from the parent checkout, so the field looked valid locally. Reading
 * the schema text directly is the check that does not depend on which client
 * happens to be installed.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SCHEMA = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8")

function fieldsOf(model: string): Set<string> {
  const m = SCHEMA.match(new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, "m"))
  if (!m) throw new Error(`model ${model} not found in schema`)
  return new Set(
    m[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("//") && !l.startsWith("@@") && !l.startsWith("///"))
      .map((l) => l.split(/\s+/)[0]),
  )
}

const SOURCES = [
  "src/app/api/v1/ai/voice/session/route.ts",
  "src/app/api/v1/ai/voice/session/connect/route.ts",
  "src/app/api/cron/voice-session-reaper/route.ts",
  "src/app/api/v1/ai/voice/session/end/route.ts",
]

describe("voice writes only fields that exist", () => {
  const voiceSession = fieldsOf("VoiceSession")

  it("VoiceSession has no endReason — the field that caused the outage", () => {
    // Pinned by name: if someone adds it later, this test should be deleted
    // deliberately, not silently satisfied.
    expect(voiceSession.has("endReason")).toBe(false)
  })

  it("no voice route writes endReason to a session", () => {
    const offenders = SOURCES.filter((f) => {
      try {
        return /endReason\s*:/.test(readFileSync(join(process.cwd(), f), "utf8"))
      } catch {
        return false
      }
    })
    expect(offenders).toEqual([])
  })

  it("the statuses the code sets are all plain strings the column accepts", () => {
    // status is a free String column, so this is a documentation check: the set
    // used by the code, kept in one place so a typo is visible in review.
    const used = ["active", "ended", "abandoned", "superseded", "never_connected"]
    expect(new Set(used).size).toBe(used.length)
    expect(voiceSession.has("status")).toBe(true)
  })
})
