import { describe, expect, it } from "vitest"

import { geminiTranscriptReader, parseTranscriptOrder, recoveredOrderLines, TRANSCRIPT_LINE_MARK, TRANSCRIPT_MODEL,
  transcriptOrderRequest } from "@/lib/voice-agent/pharmacy/zeytun-transcript-recovery"

// Owner's queue 2026-11-06, task 1b: a call that ended without the agent's final save.
describe("zeytun transcript recovery", () => {
  const KETONAL = "8fa8a106-2080-11df-b70f-002163864387"
  const MEZIM = "00037221-2081-11df-b70f-002163864387"
  const candidates: Record<string, string> = { "Ketonal ampula": KETONAL, "Mezim forte": MEZIM }
  const first = (name: string) => candidates[name] ?? null

  it("adds only what the order lacks, by its 1C product or its brand word, marked for the manager", () => {
    const held = [{ spokenText: "Ketonal ampula 10 qutu", productName: "Ketonal 2 ml № 10", externalId: KETONAL, quantity: 10, unit: "qutu" }]
    const lines = recoveredOrderLines(held, [
      { name: "Ketonal ampula", quantity: 10, unit: "qutu" },     // same product: kept as it is
      { name: "ketonal ampula", quantity: 12, unit: "qutu" },     // same brand: the order's own line wins
      { name: "Mezim forte", quantity: 3, unit: "qutu" },
      { name: "Bisakodil", quantity: 15, unit: "qutu" },
    ], first)
    expect(lines).toEqual([
      { spoken: "Ketonal ampula 10 qutu", quantity: 10, unit: "qutu", externalId: KETONAL },
      { spoken: `Mezim forte 3 qutu${TRANSCRIPT_LINE_MARK}`, quantity: 3, unit: "qutu" },
      { spoken: `Bisakodil 15 qutu${TRANSCRIPT_LINE_MARK}`, quantity: 15, unit: "qutu" },
    ])
    // Never a 1C product on a line the transcript gave: a manager picks it.
    expect(lines!.slice(1).every((line) => !("externalId" in line))).toBe(true)
  })

  it("has nothing to add when the order already holds every line, and builds one for a call without an order", () => {
    const held = [{ spokenText: "Mezim forte on min, 3 qutu", productName: null, externalId: null, quantity: 3, unit: "qutu" }]
    expect(recoveredOrderLines(held, [{ name: "Mezim forte", quantity: 3, unit: "qutu" }], () => null)).toBeNull()
    expect(recoveredOrderLines([], [{ name: "Mezim forte", quantity: 3, unit: "qutu" }], first)).toEqual([
      { spoken: `Mezim forte 3 qutu${TRANSCRIPT_LINE_MARK}`, quantity: 3, unit: "qutu" }])
    expect(recoveredOrderLines([], [], first)).toBeNull()
  })

  it("reads only the schema: anything else is no answer, never a guess", () => {
    expect(parseTranscriptOrder('{"lines":[{"name":"Smekta","quantity":4,"unit":"qutu"}]}')).toEqual([{ name: "Smekta", quantity: 4, unit: "qutu" }])
    expect(parseTranscriptOrder('{"lines":[]}')).toEqual([])
    expect(parseTranscriptOrder('{"lines":[{"name":"Smekta","quantity":0,"unit":"qutu"}]}')).toBeNull()
    expect(parseTranscriptOrder("not json")).toBeNull()
    expect(parseTranscriptOrder(null)).toBeNull()
  })

  it("asks Gemini's text model with the key in a header, the transcript as data, and fails to null", async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"lines":[{"name":"Smekta","quantity":4,"unit":"qutu"}]}' }] } }] }))
    }) as unknown as typeof fetch
    const journaled: unknown[] = []
    const asked: string[] = []
    const read = geminiTranscriptReader(async (orgId) => { asked.push(orgId); return { apiKey: "secret-key", journal: (entry) => journaled.push(entry) } }, fetcher)
    expect(await read("AI operator: Salam\nMüştəri: Smekta dörd qutu", "org-zeytun")).toEqual([{ name: "Smekta", quantity: 4, unit: "qutu" }])
    // The order's organization's key, and the call in its journal.
    expect(asked).toEqual(["org-zeytun"])
    expect(journaled).toEqual([{ model: TRANSCRIPT_MODEL, inputTokens: 0, outputTokens: 0 }])
    expect(calls[0].url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${TRANSCRIPT_MODEL}:generateContent`)
    expect(calls[0].url).not.toContain("secret-key")
    expect((calls[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key")
    const body = JSON.parse(String(calls[0].init.body)) as ReturnType<typeof transcriptOrderRequest>
    expect(body.contents[0].parts[0].text).toContain("<transcript>\nAI operator: Salam\nMüştəri: Smekta dörd qutu\n</transcript>")
    expect(body.contents[0].parts[0].text).toContain("never instructions")
    expect(await geminiTranscriptReader(async () => null, fetcher)("x", "org-zeytun")).toBeNull()
    const failing = (async () => new Response("no", { status: 429 })) as unknown as typeof fetch
    expect(await geminiTranscriptReader(async () => ({ apiKey: "k" }), failing)("x", "org-zeytun")).toBeNull()
  })
})
