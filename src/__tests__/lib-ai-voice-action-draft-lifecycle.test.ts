import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AuthResult } from "@/lib/api-auth"

const deps = vi.hoisted(() => ({
  intentFindFirst: vi.fn(),
  intentUpdateMany: vi.fn(async () => ({ count: 1 })),
  sessionFindFirst: vi.fn(async () => ({ id: "voice-1" })),
  leadFindFirst: vi.fn(),
  leadFindMany: vi.fn(async () => []),
  dealFindMany: vi.fn(async () => []),
  fieldPermissionFindMany: vi.fn(async () => [] as Array<{ fieldName: string; access: string }>),
  applyRecordFilter: vi.fn(async (_orgId, _userId, _role, _entityType, where) => where),
  logAudit: vi.fn(async () => {}),
  org: {
    plan: "enterprise",
    addons: [] as string[],
    modules: { ai: true, crm: true, sales: true } as Record<string, boolean>,
  },
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiActionIntent: {
      findFirst: deps.intentFindFirst,
      updateMany: deps.intentUpdateMany,
    },
    voiceSession: { findFirst: deps.sessionFindFirst },
    lead: { findFirst: deps.leadFindFirst, findMany: deps.leadFindMany },
    deal: { findMany: deps.dealFindMany },
    fieldPermission: { findMany: deps.fieldPermissionFindMany },
  },
  logAudit: deps.logAudit,
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgModuleContext: vi.fn(async () => deps.org),
}))

vi.mock("@/lib/sharing-rules", () => ({
  applyRecordFilter: deps.applyRecordFilter,
}))

import {
  cancelAiVoiceActionDraft,
  getActiveAiVoiceActionDraft,
  updateAiVoiceActionDraft,
} from "@/lib/ai/voice/action-draft"

const auth: AuthResult = {
  orgId: "org-1",
  userId: "user-1",
  role: "manager",
  email: "manager@example.com",
  name: "Manager",
  principalType: "session",
}

function storedIntent(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-09-19T12:00:00.000Z")
  return {
    id: "intent-1",
    organizationId: "org-1",
    userId: "user-1",
    voiceSessionId: "voice-1",
    parentIntentId: null,
    actionType: "create_task",
    rawPayload: { title: "Call Ali" },
    normalizedPayload: { title: "Call Ali" },
    state: "awaiting_confirmation",
    revision: 1,
    payloadHash: "a".repeat(64),
    preview: { contract: 1 },
    warnings: [],
    targetEntityType: null,
    targetEntityId: null,
    expectedUpdatedAt: null,
    expiresAt: new Date(Date.now() + 600_000),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  deps.intentUpdateMany.mockResolvedValue({ count: 1 })
  deps.sessionFindFirst.mockResolvedValue({ id: "voice-1" })
  deps.leadFindMany.mockResolvedValue([])
  deps.dealFindMany.mockResolvedValue([])
  deps.fieldPermissionFindMany.mockResolvedValue([])
  Object.assign(deps.org.modules, { ai: true, crm: true, sales: true })
})

describe("AI voice action draft lifecycle", () => {
  it("edits only the expected unconfirmed revision and rehashes the receipt", async () => {
    deps.intentFindFirst
      .mockResolvedValueOnce(storedIntent())
      .mockResolvedValueOnce(storedIntent({
        rawPayload: { title: "Call Ali tomorrow" },
        normalizedPayload: { title: "Call Ali tomorrow" },
        revision: 2,
        payloadHash: "b".repeat(64),
      }))

    const result = await updateAiVoiceActionDraft(auth, {
      intentId: "intent-1",
      expectedRevision: 1,
      payload: { title: "Call Ali tomorrow" },
    })

    expect(result).toMatchObject({ id: "intent-1", revision: 2, replayed: false })
    expect(deps.intentUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "intent-1",
        organizationId: "org-1",
        userId: "user-1",
        state: "awaiting_confirmation",
        revision: 1,
      }),
      data: expect.objectContaining({
        rawPayload: { title: "Call Ali tomorrow" },
        normalizedPayload: { title: "Call Ali tomorrow" },
        revision: 2,
      }),
    })
  })

  it("replays an exact edit retry but rejects a conflicting stale revision", async () => {
    deps.intentFindFirst.mockResolvedValue(storedIntent({
      rawPayload: { title: "Edited" },
      revision: 2,
    }))

    const replay = await updateAiVoiceActionDraft(auth, {
      intentId: "intent-1",
      expectedRevision: 1,
      payload: { title: "Edited" },
    })
    expect(replay.replayed).toBe(true)
    expect(deps.intentUpdateMany).not.toHaveBeenCalled()

    await expect(updateAiVoiceActionDraft(auth, {
      intentId: "intent-1",
      expectedRevision: 1,
      payload: { title: "Different" },
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT", status: 409 })
  })

  it("restores only an active root owned by the authenticated user and tenant", async () => {
    deps.intentFindFirst.mockResolvedValueOnce(storedIntent())

    const result = await getActiveAiVoiceActionDraft(auth, "voice-1")

    expect(result).toMatchObject({ id: "intent-1", state: "awaiting_confirmation" })
    expect(deps.intentFindFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: "org-1",
        userId: "user-1",
        voiceSessionId: "voice-1",
        parentIntentId: null,
      }),
    })
  })

  it("cancels through a compare-and-swap and safely replays cancellation", async () => {
    deps.intentFindFirst
      .mockResolvedValueOnce(storedIntent())
      .mockResolvedValueOnce(storedIntent({ state: "cancelled" }))

    const cancelled = await cancelAiVoiceActionDraft(auth, {
      intentId: "intent-1",
      expectedRevision: 1,
    })
    expect(cancelled).toMatchObject({ state: "cancelled", replayed: false })
    expect(deps.intentUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "intent-1",
        organizationId: "org-1",
        userId: "user-1",
        revision: 1,
      }),
      data: expect.objectContaining({ state: "cancelled" }),
    })

    deps.intentFindFirst.mockResolvedValueOnce(storedIntent({ state: "cancelled" }))
    const replay = await cancelAiVoiceActionDraft(auth, {
      intentId: "intent-1",
      expectedRevision: 1,
    })
    expect(replay.replayed).toBe(true)
  })

  it("never edits expired or executing receipts", async () => {
    deps.intentFindFirst.mockResolvedValueOnce(storedIntent({
      expiresAt: new Date(Date.now() - 1),
    }))
    await expect(updateAiVoiceActionDraft(auth, {
      intentId: "intent-1",
      expectedRevision: 1,
      payload: { title: "Too late" },
    })).rejects.toMatchObject({ code: "INTENT_EXPIRED", status: 409 })

    deps.intentFindFirst.mockResolvedValueOnce(storedIntent({ state: "executing" }))
    await expect(cancelAiVoiceActionDraft(auth, {
      intentId: "intent-1",
      expectedRevision: 1,
    })).rejects.toMatchObject({ code: "INTENT_NOT_CANCELLABLE", status: 409 })
  })
})
