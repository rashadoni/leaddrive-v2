/**
 * `create_deal` takes its pipeline id from the model, which means an attacker who
 * can influence the conversation can name any pipeline id. `Deal.pipelineId` is a
 * plain FK (schema.prisma:1092) with no tenancy predicate, so an unchecked value
 * would be accepted by the database and point a deal at a foreign pipeline.
 *
 * These tests pin the second barrier: every pipeline/stage lookup on this path
 * carries an explicit organizationId. RLS covers it today; the predicate is what
 * survives the executor being called from a bypass scope.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pipeline: { findFirst: vi.fn() },
    pipelineStage: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    deal: { create: vi.fn() },
    activity: { create: vi.fn() },
    aiPendingAction: { create: vi.fn() },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }))

vi.mock("@/lib/constants", () => ({
  DEFAULT_CURRENCY: "AZN",
  PAGE_SIZE: { DEFAULT: 20 },
  NOREPLY_EMAIL: "noreply@leaddrivecrm.org",
}))

import { executeTool } from "@/lib/ai/tool-executor"
import { prisma, logAudit } from "@/lib/prisma"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.deal.create).mockResolvedValue({ id: "d1", name: "Acme" } as any)
  vi.mocked(prisma.pipelineStage.findFirst).mockResolvedValue({ probability: 30 } as any)
})

describe("executeTool: create_deal tenant pinning", () => {
  it("scopes the model-supplied pipelineId to the caller's organization", async () => {
    vi.mocked(prisma.pipeline.findFirst).mockResolvedValue({ id: "p-own" } as any)

    await executeTool("create_deal", { name: "Acme", pipelineId: "p-foreign", stage: "LEAD" }, "org-1", "u-1", true)

    const lookup = vi.mocked(prisma.pipeline.findFirst).mock.calls[0][0] as any
    expect(lookup.where).toMatchObject({ id: "p-foreign", organizationId: "org-1" })
  })

  it("falls back to the org default instead of writing an unowned pipelineId", async () => {
    // First call = ownership check on the supplied id → not ours.
    // Second call = the org's default pipeline.
    vi.mocked(prisma.pipeline.findFirst)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce({ id: "p-default" } as any)

    await executeTool("create_deal", { name: "Acme", pipelineId: "p-foreign", stage: "LEAD" }, "org-1", "u-1", true)

    const created = vi.mocked(prisma.deal.create).mock.calls[0][0] as any
    expect(created.data.pipelineId).toBe("p-default")
    expect(created.data.pipelineId).not.toBe("p-foreign")
    expect(created.data.organizationId).toBe("org-1")

    const defaultLookup = vi.mocked(prisma.pipeline.findFirst).mock.calls[1][0] as any
    expect(defaultLookup.where).toMatchObject({ organizationId: "org-1", isDefault: true })
  })

  it("leaves pipelineId unset when the org has no default and the supplied one is foreign", async () => {
    vi.mocked(prisma.pipeline.findFirst).mockResolvedValue(null as any)

    await executeTool("create_deal", { name: "Acme", pipelineId: "p-foreign", stage: "LEAD" }, "org-1", "u-1", true)

    const created = vi.mocked(prisma.deal.create).mock.calls[0][0] as any
    expect(created.data.pipelineId).toBeUndefined()
  })

  it("scopes the stage lookup through the pipeline's owner", async () => {
    vi.mocked(prisma.pipeline.findFirst).mockResolvedValue({ id: "p-own" } as any)

    await executeTool("create_deal", { name: "Acme", pipelineId: "p-own", stage: "QUALIFIED" }, "org-1", "u-1", true)

    const stageLookup = vi.mocked(prisma.pipelineStage.findFirst).mock.calls[0][0] as any
    expect(stageLookup.where).toMatchObject({
      pipelineId: "p-own",
      name: "QUALIFIED",
      pipeline: { organizationId: "org-1" },
    })
  })
})

describe("executeTool: audit actor", () => {
  it("records who the AI acted for", async () => {
    vi.mocked(prisma.pipeline.findFirst).mockResolvedValue({ id: "p-own" } as any)

    await executeTool("create_deal", { name: "Acme", stage: "LEAD" }, "org-1", "u-42", true)

    const call = vi.mocked(logAudit).mock.calls.at(-1)!
    expect(call[1]).toBe("ai_action")
    // Sixth arg carries the actor — AuditLog.userId was null for every AI write before this.
    expect(call[5]).toMatchObject({ userId: "u-42" })
  })

  it("records the actor for add_note too", async () => {
    vi.mocked(prisma.activity.create).mockResolvedValue({ id: "a1" } as any)

    await executeTool("add_note", { entityType: "deal", entityId: "d1", content: "hi" }, "org-1", "u-7", true)

    const call = vi.mocked(logAudit).mock.calls.at(-1)!
    expect(call[5]).toMatchObject({ userId: "u-7" })
  })
})
