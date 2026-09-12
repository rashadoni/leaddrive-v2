/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { organization: { findFirst: vi.fn() } },
}))

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn(async (_orgId: string, callback: () => Promise<unknown>) => callback()),
}))

import { prisma } from "@/lib/prisma"
import {
  hasSupportAiSettingsEntitlement,
  isSupportAiSettingsRole,
} from "@/lib/ai/support-settings-access"

describe("Support AI settings access", () => {
  beforeEach(() => vi.clearAllMocks())

  it("allows only administrator roles", () => {
    expect(isSupportAiSettingsRole("admin")).toBe(true)
    expect(isSupportAiSettingsRole("superadmin")).toBe(true)
    expect(isSupportAiSettingsRole("manager")).toBe(false)
    expect(isSupportAiSettingsRole("viewer")).toBe(false)
  })

  it("requires Support and AI together", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({
      plan: "tier-25",
      addons: [],
      features: ["support", "ai"],
      modules: {},
    } as any)

    await expect(hasSupportAiSettingsEntitlement("org-1")).resolves.toBe(true)
  })

  it.each([
    [["support"], "AI"],
    [["ai"], "Support"],
    [[], "both"],
  ])("denies when %s lacks %s entitlement", async (features) => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({
      plan: "tier-25",
      addons: [],
      features,
      modules: {},
    } as any)

    await expect(hasSupportAiSettingsEntitlement("org-1")).resolves.toBe(false)
  })

  it("fails closed when entitlement state cannot be read", async () => {
    vi.mocked(prisma.organization.findFirst).mockRejectedValue(new Error("database unavailable"))

    await expect(hasSupportAiSettingsEntitlement("org-1")).resolves.toBe(false)
  })
})
