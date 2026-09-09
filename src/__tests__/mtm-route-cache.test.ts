/**
 * G — MTM route read-cache: the pure key helper (IDB adapter is browser-only,
 * exercised by the stand probe).
 */
import { describe, it, expect } from "vitest"
import { routeCacheKey } from "@/lib/mtm/route-cache"

describe("routeCacheKey", () => {
  it("is stable and distinct per agent + day", () => {
    expect(routeCacheKey("a1", "2026-07-19")).toBe("a1::2026-07-19")
    expect(routeCacheKey("a1", "2026-07-19")).toBe(routeCacheKey("a1", "2026-07-19"))
    expect(routeCacheKey("a1", "2026-07-19")).not.toBe(routeCacheKey("a2", "2026-07-19"))
    expect(routeCacheKey("a1", "2026-07-19")).not.toBe(routeCacheKey("a1", "2026-07-20"))
  })
})
