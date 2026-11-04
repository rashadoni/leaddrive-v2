import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

// The dialog stand (scripts/zeytun-line/dialog-stand.ts) gives the model the
// station's tool declarations from a fixture. If the station's own
// ZeytunInboundBridge._declarations() changes and the fixture does not, the
// stand silently tests a line that no longer exists.
describe("zeytun line dialog stand", () => {
  it("declares exactly the station's tools", () => {
    const station = JSON.parse(execFileSync("python3", ["-I", "scripts/zeytun-line/dialog-stand-bridge.py", "--declarations"], { encoding: "utf8" }))
    const fixture = JSON.parse(readFileSync("scripts/zeytun-line/station-tool-declarations.json", "utf8"))
    expect(fixture, "regenerate: python3 -I scripts/zeytun-line/dialog-stand-bridge.py --declarations > scripts/zeytun-line/station-tool-declarations.json").toEqual(station)
  })

  it("has scenarios whose rules and checks are valid regexes", () => {
    const { scenarios } = JSON.parse(readFileSync("scripts/zeytun-line/dialog-scenarios.json", "utf8")) as {
      scenarios: { id: string; turns: (string | { say: string; when?: { match: string }[] })[]; checks: Record<string, unknown> }[]
    }
    expect(scenarios.length).toBeGreaterThanOrEqual(6)
    expect(new Set(scenarios.map((scenario) => scenario.id)).size).toBe(scenarios.length)
    for (const scenario of scenarios) {
      expect(scenario.turns.length).toBeGreaterThan(0)
      const patterns = [
        ...scenario.turns.flatMap((turn) => typeof turn === "string" ? [] : (turn.when ?? []).map((rule) => rule.match)),
        ...(["tools", "noTools"] as const).flatMap((key) => ((scenario.checks[key] ?? []) as { args?: string }[]).flatMap((rule) => rule.args ? [rule.args] : [])),
        ...(["reply", "noReply"] as const).flatMap((key) => ((scenario.checks[key] ?? []) as { match: string }[]).map((rule) => rule.match)),
      ]
      for (const pattern of patterns) expect(() => new RegExp(pattern, "iu"), `${scenario.id}: ${pattern}`).not.toThrow()
    }
  })
})
