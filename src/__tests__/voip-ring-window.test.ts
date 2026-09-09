import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * How long the phone may ring is a dialplan decision, not an HTTP client's.
 *
 * The coordinator's ARI originate is synchronous — it returns only once the
 * dialplan has finished with the channel — so the abort signal on that one
 * request is, in effect, the ring window. While it shared the 15 s control
 * budget, every call nobody answered in ~15 s was hung up by us and written
 * down as "no answer": measured on 2026-08-19, a real call rang 19 s and died
 * while the dialplan allowed 60.
 */
const PROVIDER = readFileSync(
  join(process.cwd(), "src/lib/voip/providers/asterisk.ts"),
  "utf8",
)

describe("outbound ring window", () => {
  it("gives the originate its own budget, above the dialplan's 60s Dial()", () => {
    const match = PROVIDER.match(/const ORIGINATE_RING_TIMEOUT_MS = ([\d_]+)/)
    expect(match, "ORIGINATE_RING_TIMEOUT_MS must exist").toBeTruthy()
    const ms = Number(match![1].replace(/_/g, ""))
    expect(ms).toBeGreaterThan(60_000)
  })

  it("keeps the short control budget for everything that is not the originate", () => {
    const control = Number(
      PROVIDER.match(/const ORIGINATE_TIMEOUT_MS = ([\d_]+)/)![1].replace(/_/g, ""),
    )
    expect(control).toBeLessThanOrEqual(15_000)
    // Status probes, hangups and registry reads must stay fast: a stuck one of
    // those used to hold an awaited HTTP response open for minutes.
    const ringUses = PROVIDER.match(/ORIGINATE_RING_TIMEOUT_MS/g) ?? []
    expect(ringUses.length).toBe(2) // the constant itself and exactly one use
  })
})
