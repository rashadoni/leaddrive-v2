import { describe, expect, it } from "vitest"
import {
  buildSectionEvalCases,
  loadRealtimeVoiceContract,
  parseEvalArguments,
  runStaticSectionAudit,
  sanitizedFailureReason,
  stableSignal,
} from "../../scripts/voice-realtime-section-eval.mjs"

describe("voice section static eval harness", () => {
  it("runs every RU/AZ navigation and explanation case without a provider request", async () => {
    const contract = await loadRealtimeVoiceContract()
    const cases = buildSectionEvalCases(contract.matrix)
    const result = runStaticSectionAudit(contract)

    expect(cases).toHaveLength(Object.keys(contract.matrix).length * 2 * 2)
    expect(new Set(cases.map((testCase) => testCase.id)).size).toBe(cases.length)
    expect(result).toMatchObject({
      mode: "static",
      status: "pass",
      sections: Object.keys(contract.matrix).length,
      locales: 2,
      cases: cases.length,
      mismatches: 0,
      liveRequests: 0,
      crmToolsExecuted: 0,
    })
    expect(stableSignal(result)).toBe(
      `VOICE_REALTIME_SECTION_EVAL=PASS mode=static sections=${result.sections} cases=${result.cases} mismatches=0`,
    )
    // ~3 s on an idle machine. On 2026-09-07 it exceeded the previous 15 s on
    // the shared CI box while a typecheck ran beside it — a ≥5× slowdown, not
    // a regression. Sized for that box: docs/ci-cost-policy.md, "CPU and I/O".
  }, 45_000)

  it("keeps bounded static options while rejecting both legacy live switches", () => {
    expect(parseEvalArguments([])).toMatchObject({ live: false, delayMs: 1_000, batchSize: 16 })
    expect(parseEvalArguments(["--limit=4", "--delay-ms=50", "--batch-size=2"]))
      .toMatchObject({ live: false, limit: 4, delayMs: 50, batchSize: 2 })
    expect(() => parseEvalArguments(["--live"])).toThrow("live_mode_retired")
    expect(() => parseEvalArguments(["--model=gpt-realtime-2.1"])).toThrow("live_mode_retired")
    expect(() => parseEvalArguments(["--delay-ms=0"])).toThrow("delay_ms_out_of_range")
    expect(() => parseEvalArguments(["--batch-size=100"])).toThrow("batch_size_out_of_range")
  })

  it("sanitizes failure reasons", () => {
    expect(sanitizedFailureReason(new Error("live_mode_retired"))).toBe("live_mode_retired")
    expect(sanitizedFailureReason(new Error("do not expose provider text"))).toBe("eval_failed")
  })
})
