import { beforeEach, describe, expect, it, vi } from "vitest"

const effects = vi.hoisted(() => ({
  logAudit: vi.fn(),
  executeWorkflows: vi.fn(async () => {}),
  fireWebhooks: vi.fn(async () => {}),
  createNotification: vi.fn(async () => {}),
  scoreLeadNow: vi.fn(async () => 50),
}))

const db = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(async () => ({ count: 1 })),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { lead: { findFirst: db.findFirst, updateMany: db.updateMany } },
  logAudit: effects.logAudit,
}))
vi.mock("@/lib/workflow-engine", () => ({ executeWorkflows: effects.executeWorkflows }))
vi.mock("@/lib/webhooks", () => ({ fireWebhooks: effects.fireWebhooks }))
vi.mock("@/lib/notifications", () => ({ createNotification: effects.createNotification }))
vi.mock("@/lib/ai/lead-scoring", () => ({ scoreLeadNow: effects.scoreLeadNow }))
vi.mock("@/lib/field-filter", () => ({
  getFieldPermissions: vi.fn(async () => ({})),
  requireFieldPermissions: vi.fn(async () => ({})),
  filterWritableFields: vi.fn((data: Record<string, unknown>) => data),
  filterEntityFields: vi.fn((data: Record<string, unknown>) => data),
}))
vi.mock("@/lib/inbox/customer-stage", async (importOriginal) => {
  // The schema imports the real stage vocabulary; only the writers are faked.
  const actual = await importOriginal<typeof import("@/lib/inbox/customer-stage")>()
  return {
    ...actual,
    setLeadReportedCustomerStage: vi.fn(async () => ({ conversationsUpdated: 0 })),
    setLeadReportedCustomerStages: vi.fn(async () => ({ conversationsUpdated: 0 })),
  }
})

import { updateLeadCommand } from "@/lib/crm-commands/lead/update-lead"
import {
  dispatchCollectedCommandEffects,
  type CrmCommandPostCommitEffect,
} from "@/lib/crm-commands/execution-context"

/**
 * Roadmap C1.11, the half that text cannot prove.
 *
 * `updateLeadCommand` decides for itself whether to fire its effects or hand
 * them over, with a hand-written `if (execution?.transaction)`. A branch like
 * that is exactly the thing that can be silently wrong: get it backwards and a
 * webhook announces a lead change that the surrounding transaction then rolls
 * back, which no review catches because both arms read correctly.
 */
const VERSION = new Date("2026-09-21T09:00:00.000Z")

/**
 * The command runs its queries through the transaction client when given one,
 * so the fake has to answer the same calls the plain client does.
 */
const transaction = () => ({
  lead: { findFirst: db.findFirst, updateMany: db.updateMany },
}) as never

const actor = {
  organizationId: "org-1",
  userId: "user-1",
  role: "admin" as const,
  source: "voice" as const,
  voiceSessionId: "voice-1",
}

function anyEffectFired(): boolean {
  return [
    effects.logAudit,
    effects.executeWorkflows,
    effects.fireWebhooks,
    effects.createNotification,
  ].some((mock) => mock.mock.calls.length > 0)
}

beforeEach(() => {
  vi.clearAllMocks()
  db.findFirst
    .mockResolvedValueOnce({ id: "lead-1", updatedAt: VERSION })
    .mockResolvedValueOnce({
      id: "lead-1",
      organizationId: "org-1",
      contactName: "Ali Mammadov",
      companyName: null,
      assignedTo: "user-1",
      notes: "Call on Monday",
      updatedAt: new Date("2026-09-21T09:01:00.000Z"),
    })
  db.updateMany.mockResolvedValue({ count: 1 })
})

describe("a lead update inside a transaction", () => {
  it("fires nothing while the transaction is still open", async () => {
    const postCommitEffects: CrmCommandPostCommitEffect[] = []

    await updateLeadCommand(actor, "lead-1", {
      notes: "Call on Monday",
      expectedUpdatedAt: VERSION.toISOString(),
    }, { transaction: transaction(), postCommitEffects })

    expect(anyEffectFired(), "an effect escaped the open transaction").toBe(false)
    expect(effects.scoreLeadNow).not.toHaveBeenCalled()
    expect(postCommitEffects).toHaveLength(1)
  })

  it("fires them once the adapter flushes, and not before", async () => {
    const postCommitEffects: CrmCommandPostCommitEffect[] = []

    await updateLeadCommand(actor, "lead-1", {
      notes: "Call on Monday",
      expectedUpdatedAt: VERSION.toISOString(),
    }, { transaction: transaction(), postCommitEffects })

    dispatchCollectedCommandEffects(postCommitEffects)
    await vi.waitFor(() => expect(effects.logAudit).toHaveBeenCalled())

    expect(effects.executeWorkflows).toHaveBeenCalled()
    expect(effects.fireWebhooks).toHaveBeenCalled()
  })
})

describe("the same update outside a transaction", () => {
  // The REST path. Its effects must not wait for a flush nobody will perform.
  it("fires straight away", async () => {
    await updateLeadCommand(
      { ...actor, source: "rest" },
      "lead-1",
      { notes: "Call on Monday" },
    )

    await vi.waitFor(() => expect(effects.logAudit).toHaveBeenCalled())
    expect(effects.executeWorkflows).toHaveBeenCalled()
    expect(effects.fireWebhooks).toHaveBeenCalled()
  })

  it("produces the same effects a deferred run produces", async () => {
    await updateLeadCommand(
      { ...actor, source: "rest" },
      "lead-1",
      { notes: "Call on Monday" },
    )
    await vi.waitFor(() => expect(effects.fireWebhooks).toHaveBeenCalled())
    const restCalls = {
      audit: effects.logAudit.mock.calls.length,
      workflows: effects.executeWorkflows.mock.calls.length,
      webhooks: effects.fireWebhooks.mock.calls.length,
    }

    vi.clearAllMocks()
    db.findFirst
      .mockResolvedValueOnce({ id: "lead-1", updatedAt: VERSION })
      .mockResolvedValueOnce({
        id: "lead-1",
        organizationId: "org-1",
        contactName: "Ali Mammadov",
        companyName: null,
        assignedTo: "user-1",
        notes: "Call on Monday",
        updatedAt: new Date("2026-09-21T09:01:00.000Z"),
      })
    const postCommitEffects: CrmCommandPostCommitEffect[] = []
    await updateLeadCommand(actor, "lead-1", {
      notes: "Call on Monday",
      expectedUpdatedAt: VERSION.toISOString(),
    }, { transaction: transaction(), postCommitEffects })
    dispatchCollectedCommandEffects(postCommitEffects)
    await vi.waitFor(() => expect(effects.fireWebhooks).toHaveBeenCalled())

    // The point of the roadmap item: voice and REST produce the same effects,
    // the transaction only changes when.
    expect({
      audit: effects.logAudit.mock.calls.length,
      workflows: effects.executeWorkflows.mock.calls.length,
      webhooks: effects.fireWebhooks.mock.calls.length,
    }).toEqual(restCalls)
  })
})
