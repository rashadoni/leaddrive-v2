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

// The voice stand (scripts/zeytun-line/voice-stand.ts) counts a hearing error
// when the model's transcript of a phrase misses one of its hear patterns.
// A pattern that misses the phrase as written would report an error on a
// perfect transcript, and the owner would chase a recognizer that heard right.
describe.each(["voice-scenario.json", "voice-scenario-search-words.json", "voice-scenario-promo-order.json", "voice-scenario-demo-promo-strength.json"])("zeytun line voice stand scenario %s", (file) => {
  const scenario = JSON.parse(readFileSync(`scripts/zeytun-line/${file}`, "utf8")) as {
    steps: { n: number; phrases: { say: string; hear?: { match: string }[]; expect?: Expectation }[]; expect: Expectation }[]
    final: { spoken: string; quantity: number }[]
  }
  type Expectation = { tools?: { args?: string }[]; reply?: { match: string }[]; noReply?: { match: string }[] }
  const patterns = (expect: Expectation | undefined) => [...(expect?.tools ?? []).flatMap((rule) => rule.args ? [rule.args] : []),
    ...(expect?.reply ?? []).map((rule) => rule.match), ...(expect?.noReply ?? []).map((rule) => rule.match)]

  it("numbers its steps in order and gives every phrase words", () => {
    expect(scenario.steps.map((step) => step.n)).toEqual(scenario.steps.map((_, i) => i + 1))
    for (const step of scenario.steps) for (const phrase of step.phrases) expect(phrase.say.trim()).not.toBe("")
  })

  it("hears each phrase as written", async () => {
    const { foldLatin } = await import("../../scripts/zeytun-line/stand-crm")
    for (const step of scenario.steps) for (const phrase of step.phrases) for (const rule of phrase.hear ?? []) {
      expect(new RegExp(rule.match, "iu").test(foldLatin(phrase.say)), `${step.n}: «${phrase.say}» / ${rule.match}`).toBe(true)
    }
  })

  it("has checks that are valid regexes", () => {
    for (const step of scenario.steps) {
      for (const pattern of [...patterns(step.expect), ...step.phrases.flatMap((phrase) => patterns(phrase.expect))]) {
        expect(() => new RegExp(pattern, "iu"), `${step.n}: ${pattern}`).not.toThrow()
      }
    }
    for (const line of scenario.final) expect(() => new RegExp(line.spoken, "u")).not.toThrow()
  })
})
