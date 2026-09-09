import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/ai/budget", () => ({
  isAiFeatureEnabled: vi.fn(),
}))

import { isAiFeatureEnabled } from "@/lib/ai/budget"
import { isSupportAiEnabled } from "@/lib/ai/support-feature"

describe("isSupportAiEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("preserves the legacy enabled default when the opt-out flag is absent", async () => {
    vi.mocked(isAiFeatureEnabled).mockResolvedValue(false)

    await expect(isSupportAiEnabled("org-1")).resolves.toBe(true)
    expect(isAiFeatureEnabled).toHaveBeenCalledWith("org-1", "supportAiDisabled")
  })

  it("disables Support AI only after an explicit opt-out", async () => {
    vi.mocked(isAiFeatureEnabled).mockResolvedValue(true)

    await expect(isSupportAiEnabled("org-1")).resolves.toBe(false)
  })
})
