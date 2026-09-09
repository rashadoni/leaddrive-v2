/**
 * Every declared voice tool must have a handler.
 *
 * This exists because of a real incident: resolving a merge conflict kept the
 * boards SUMMARY FUNCTION but dropped its registration, so the agent offered a
 * tool the server did not answer. Worse, the check I ran by hand counted
 * dispatch branches, got the expected number, and passed — the count matched by
 * coincidence because an unrelated tool had been added in the same range.
 *
 * Counting is not verification. This pins the NAMES.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { VOICE_TOOL_NAMES, VOICE_LIST_TOOLS, VOICE_TOOL_SCHEMAS } from "@/lib/ai/voice/read-tools"

// The dispatch moved out of the route into the shared executor so the chat
// assistant can call the same tools. The guard follows the dispatch: what must
// stay wired is the executor; the route is asserted to delegate to it.
const ROUTE = readFileSync(
  join(process.cwd(), "src/lib/ai/voice/execute-read-tool.ts"),
  "utf8",
)

describe("voice tools are wired end to end", () => {
  const handled = new Set(
    [...ROUTE.matchAll(/toolName === "([a-z_]+)"/g)].map((m) => m[1]),
  )
  // List tools share one delegated branch rather than a named `if`.
  const lists = new Set<string>(VOICE_LIST_TOOLS)

  it("every declared tool is either a list tool or has its own handler", () => {
    const orphans = VOICE_TOOL_NAMES.filter((n) => !lists.has(n) && !handled.has(n))
    expect(orphans).toEqual([])
  })

  it("no handler answers a tool that was never declared", () => {
    const declared = new Set<string>(VOICE_TOOL_NAMES)
    const ghosts = [...handled].filter((n) => !declared.has(n))
    expect(ghosts).toEqual([])
  })

  it("every declared tool has a schema", () => {
    const missing = VOICE_TOOL_NAMES.filter((n) => !VOICE_TOOL_SCHEMAS[n])
    expect(missing).toEqual([])
  })
})

it("the voice route delegates to the shared executor", () => {
  const route = readFileSync(
    join(process.cwd(), "src/app/api/v1/ai/voice/read/route.ts"),
    "utf8",
  )
  // If someone reintroduces an inline handler in the route, the two surfaces
  // stop sharing a brain and drift apart again - the exact disease this
  // extraction cured.
  expect(route).toContain("executeVoiceReadTool")
  expect(route).not.toMatch(/if \(toolName === "get_/)
})
