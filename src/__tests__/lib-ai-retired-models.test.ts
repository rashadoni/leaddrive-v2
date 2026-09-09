/**
 * A retired model ID is a silent outage.
 *
 * Anthropic answers 404 for a model it no longer serves, which kills the whole
 * assistant turn — and the ID can come from a tenant's stored agent config,
 * written long before the retirement. Verified against the live account on
 * 2026-08-20: claude-sonnet-4-20250514 was dead, and this repository's own chat
 * default still pointed at it.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { DEFAULT_AI_MODEL, KNOWN_AI_MODELS, calculateAiCost, resolveAiModel } from "@/lib/ai/budget"

const RETIRED = ["claude-sonnet-4-20250514", "claude-sonnet-4-5-20250514", "claude-sonnet-4-6-20250514"]

describe("retired models", () => {
  it("substitutes the current default for a stored ID the API no longer serves", () => {
    for (const model of RETIRED) expect(resolveAiModel(model)).toBe(DEFAULT_AI_MODEL)
  })

  it("leaves a live configured model alone and honours a caller's own fallback", () => {
    expect(resolveAiModel("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5-20251001")
    expect(resolveAiModel(null, "claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5-20251001")
    expect(resolveAiModel("claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"))
      .toBe("claude-haiku-4-5-20251001")
  })

  it("stops offering retired IDs for new configuration, but keeps pricing them", () => {
    for (const model of RETIRED) expect(KNOWN_AI_MODELS).not.toContain(model)
    expect(KNOWN_AI_MODELS).toContain(DEFAULT_AI_MODEL)
    // Historical interaction logs still reference the old ID; their cost must
    // not silently fall back to the cheapest rate.
    expect(calculateAiCost("claude-sonnet-4-20250514", 1_000_000, 0)).toBe(3)
  })

  it("keeps no retired ID hard-coded on a live AI call path", () => {
    const paths = [
      "src/app/api/v1/ai/chat/route.ts",
      "src/app/api/v1/contract-clauses/draft/route.ts",
      "src/app/api/v1/public/portal-chat/route.ts",
      "src/app/api/v1/webhooks/whatsapp/route.ts",
    ]
    for (const path of paths) {
      const source = readFileSync(join(process.cwd(), path), "utf8")
      for (const model of RETIRED) expect(source, path).not.toContain(model)
    }
  })
})
