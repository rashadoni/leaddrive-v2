import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/ai/support-feature", () => ({
  isSupportAiEnabled: vi.fn().mockResolvedValue(false),
}))
vi.mock("@/lib/ai/budget", () => ({
  checkAiBudget: vi.fn(),
  calculateAiCost: vi.fn(),
}))
vi.mock("@/lib/ai/anthropic-client", () => ({
  getAnthropicClient: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: { aiInteractionLog: { create: vi.fn() } },
}))

import { checkAiBudget } from "@/lib/ai/budget"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { categorizeComplaint } from "@/lib/complaint-ai"

describe("categorizeComplaint Support master switch", () => {
  it("returns before budget, model, or logging side effects when disabled", async () => {
    await expect(categorizeComplaint("org-1", { content: "Broken service" })).resolves.toBeNull()
    expect(checkAiBudget).not.toHaveBeenCalled()
    expect(getAnthropicClient).not.toHaveBeenCalled()
  })
})
