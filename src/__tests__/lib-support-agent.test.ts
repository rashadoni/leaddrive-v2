import { describe, it, expect, vi, beforeEach } from "vitest"

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn(async (..._a: unknown[]) => null as unknown) }))
vi.mock("@/lib/prisma", () => ({ prisma: { aiAgentConfig: { findFirst } } }))

import { getSupportAgentConfig } from "@/lib/ai/support-agent"

beforeEach(() => findFirst.mockClear())

describe("getSupportAgentConfig", () => {
  it("filters by agentType 'support' — the inbox/Gobustone persona can never bleed into support AI", async () => {
    await getSupportAgentConfig("org_1")
    expect(findFirst).toHaveBeenCalledTimes(1)
    expect(findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org_1", isActive: true, agentType: "support" },
      orderBy: { updatedAt: "desc" },
    })
  })

  it("returns null when the org has no active support agent (caller degrades to its base prompt)", async () => {
    findFirst.mockResolvedValueOnce(null)
    expect(await getSupportAgentConfig("org_1")).toBeNull()
  })
})
