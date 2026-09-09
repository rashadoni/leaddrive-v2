import { describe, expect, it } from "vitest"

/**
 * Deliberately tiny and deliberately slow enough to be killed by
 * `--testTimeout=1`. `check-test-baseline-timeout-rendering.test.ts` runs this
 * file in a child vitest with that flag to pin what a timed-out test looks
 * like in vitest's JSON report. In the ordinary suite it just passes.
 */
describe("timeout signature probe", () => {
  it("takes a few milliseconds", async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(true).toBe(true)
  })
})
