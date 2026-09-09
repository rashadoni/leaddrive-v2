/**
 * Every detail route in the app must be a decision, not an oversight.
 *
 * Written after the third repeat of the same failure. Openable record types
 * were listed by hand; the list was extended to eight when the owner asked for
 * invoices, and on his very next attempt boards turned out to be the ninth
 * nobody had thought of. A list cannot report what is missing from it, so this
 * walks the app's own routes and makes the omission fail here instead of in a
 * conversation.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import {
  RECORD_TYPE_NAMES,
  RECORD_TYPES,
  NOT_OPENABLE,
} from "@/lib/ai/voice/record-types"
import { VOICE_RECORD_ACCESS } from "@/lib/ai/voice/read-access"
import { VOICE_TOOL_SCHEMAS } from "@/lib/ai/voice/read-tools"

const ROOT = join(process.cwd(), "src/app/(dashboard)")

/** Every `[param]` folder under (dashboard), up to two levels deep. */
function detailRoutes(): string[] {
  const found: string[] = []
  const walk = (dir: string, prefix: string, depth: number) => {
    if (depth > 2 || !existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.name.startsWith("[")) found.push(rel)
      else walk(join(dir, entry.name), rel, depth + 1)
    }
  }
  walk(ROOT, "", 0)
  return found.sort()
}

describe("voice record coverage", () => {
  const routes = detailRoutes()

  it("finds the app's detail routes at all", () => {
    // Guards the guard: a walker that silently finds nothing would make every
    // other assertion below pass for the wrong reason.
    expect(routes.length).toBeGreaterThan(10)
  })

  it("classifies every detail route as openable or explicitly not", () => {
    const registered = new Set(
      Object.values(RECORD_TYPES).map((d) => `${d.route.replace(/^\//, "")}/[id]`),
    )
    // Boards use [divisionId] rather than [id].
    registered.add("boards/[divisionId]")
    const unclassified = routes.filter((r) => !registered.has(r) && !(r in NOT_OPENABLE))
    expect(unclassified).toEqual([])
  })

  it("does not exclude a route that no longer exists", () => {
    const live = new Set(routes)
    const ghosts = Object.keys(NOT_OPENABLE).filter((r) => !live.has(r))
    expect(ghosts).toEqual([])
  })

  it("gives every openable type at least one field to search on", () => {
    const empty = Object.entries(RECORD_TYPES)
      .filter(([, d]) => d.searchFields.length === 0)
      .map(([k]) => k)
    expect(empty).toEqual([])
  })

  it("derives descriptors, authorization and model validation from one record-type list", () => {
    expect(Object.keys(RECORD_TYPES)).toEqual([...RECORD_TYPE_NAMES])
    expect(Object.keys(VOICE_RECORD_ACCESS)).toEqual([...RECORD_TYPE_NAMES])

    for (const type of RECORD_TYPE_NAMES) {
      expect(
        VOICE_TOOL_SCHEMAS.find_record.safeParse({ type, query: "sample" }).success,
        `find_record schema rejected ${type}`,
      ).toBe(true)
    }
  })
})
