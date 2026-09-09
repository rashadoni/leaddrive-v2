import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("sidebar route prefetch", () => {
  it("does not prefetch the large tenant navigation menu", () => {
    const source = readFileSync("src/components/sidebar.tsx", "utf8")
    const itemLinks = source.match(/key=\{item\.href\}[\s\S]{0,160}?prefetch=\{false\}/g) ?? []

    expect(itemLinks).toHaveLength(2)
  })
})
