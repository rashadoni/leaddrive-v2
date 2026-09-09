import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: {
      findMany: vi.fn(),
    },
    aiShadowAction: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    aiInteractionLog: {
      create: vi.fn(),
    },
  },
}))

vi.mock("@/lib/ai/anthropic-client", () => ({
  getAnthropicClient: vi.fn(),
}))

vi.mock("@/lib/ai/budget", () => ({
  calculateAiCost: vi.fn(() => 0),
}))

vi.mock("@/lib/prisma-decimal", () => ({
  decimalToNumber: vi.fn((value: unknown) => Number(value ?? 0)),
}))

import { findContractsForRenewal } from "@/lib/ai/renewal"
import { prisma } from "@/lib/prisma"

describe("findContractsForRenewal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.contract.findMany).mockResolvedValue([])
    vi.mocked(prisma.aiShadowAction.findMany).mockResolvedValue([])
  })

  it("selects only active/renewing contracts for renewal proposals", async () => {
    await findContractsForRenewal("org-1", new Date("2026-07-03T00:00:00.000Z"))

    const call = vi.mocked(prisma.contract.findMany).mock.calls[0][0]
    expect(call.where.status.in).toEqual(["active", "renewing"])
    expect(call.where.status.notIn).toBeUndefined()
  })
})
