import { describe, expect, it, vi } from "vitest"
import { Prisma } from "@prisma/client"

import {
  cancelVoiceQueue,
  createSelectedVoiceQueue,
  evaluateVoiceQueueFeature,
  previewSelectedVoiceQueue,
  resolveUncertainVoiceQueueItem,
  resolveVoiceQueueOwner,
  VoiceQueueError,
} from "@/lib/voice-agent/queue-service"
import {
  processSequentialVoiceQueueOrganization,
  recheckVoiceQueueItemEligibility,
} from "@/lib/voice-agent/queue-worker"
import {
  MANUAL_LEAD_AI_ORGANIZATION_LIMIT_24H,
  MANUAL_LEAD_AI_USER_LIMIT_24H,
} from "@/lib/voice-agent/manual-lead-call"

const auth = { orgId: "org-1", userId: "seller-1", role: "sales" } as const
const featureOptions = { executionEnabled: true, pilotOrganizationId: "org-1" }

const eligibleQueueDecision = {
  eligible: true as const,
  targetPhoneE164: "+994500000001",
  targetDialNumber: "994500000001",
  assignedTo: "seller-1",
  consentBasis: "bulk_per_call_attestation" as const,
  provider: {
    channelConfigId: "voip-config",
    fromNumber: "queue-caller",
    settings: {
      provider: "asterisk" as const,
      ariHost: "pbx.internal",
      ariPort: 8088,
      username: "runtime-user",
      password: "runtime-password",
      context: "from-internal",
      callerExtension: "queue-caller",
      recordCalls: false,
    },
  },
  policySnapshot: { queuePolicy: "test" },
}

function enabledChannelConfig() {
  return {
    id: "voip-config",
    configName: "Asterisk",
    phoneNumber: null,
    apiKey: null,
    isActive: true,
    settings: {
      provider: "asterisk",
      ariHost: "pbx.internal",
      username: "runtime-user",
      password: "runtime-password",
      callerExtension: "queue-caller",
      voiceQueueEnabled: true,
      manualLeadAiCallsEnabled: true,
      voiceAgentEnabled: true,
      voiceAgentMode: "outbound",
    },
  }
}

type CallHistoryRow = {
  leadId: string | null
  direction: string
  fromNumber: string
  toNumber: string
  targetPhoneE164: string | null
  callMode: string
  wasAnswered: boolean
  providerOutcome: string | null
  conversationOutcome: string | null
  status: string
  duration: number | null
}

function callHistoryRow(overrides: Partial<CallHistoryRow> = {}): CallHistoryRow {
  return {
    leadId: null,
    direction: "outbound",
    fromNumber: "agent",
    toNumber: "+994500000001",
    targetPhoneE164: null,
    callMode: "human",
    wasAnswered: false,
    providerOutcome: null,
    conversationOutcome: null,
    status: "completed",
    duration: null,
    ...overrides,
  }
}

describe("voice queue feature and owner gates", () => {
  it("requires both the server gate and the explicit tenant setting", async () => {
    const findMany = vi.fn().mockResolvedValue([enabledChannelConfig()])
    await expect(evaluateVoiceQueueFeature({
      db: { channelConfig: { findMany } } as never,
      organizationId: "org-1",
      options: { executionEnabled: false, pilotOrganizationId: "org-1" },
    })).resolves.toEqual({ enabled: false, blocker: "voice_queue_disabled" })
    expect(findMany).not.toHaveBeenCalled()

    await expect(evaluateVoiceQueueFeature({
      db: { channelConfig: { findMany } } as never,
      organizationId: "org-1",
      options: featureOptions,
    })).resolves.toEqual({ enabled: true, blocker: null })
  })

  it("does not treat the queue toggle alone as a runnable Asterisk configuration", async () => {
    await expect(evaluateVoiceQueueFeature({
      db: {
        channelConfig: {
          findMany: vi.fn().mockResolvedValue([{
            ...enabledChannelConfig(),
            settings: { provider: "asterisk", voiceQueueEnabled: true },
          }]),
        },
      } as never,
      organizationId: "org-1",
      options: featureOptions,
    })).resolves.toEqual({ enabled: false, blocker: "voice_queue_disabled" })
  })

  it("forces seller scope and requires an explicit owner for managers", () => {
    expect(resolveVoiceQueueOwner({ auth, ownerUserId: null })).toBe("seller-1")
    expect(() => resolveVoiceQueueOwner({ auth, ownerUserId: "seller-2" }))
      .toThrowError(new VoiceQueueError("queue_not_found"))
    expect(() => resolveVoiceQueueOwner({
      auth: { ...auth, role: "manager" },
      ownerUserId: null,
    })).toThrowError(new VoiceQueueError("owner_scope_required"))
  })
})

describe("selected queue eligibility snapshot", () => {
  it("keeps the feature blocker global and caps eligible items in stable order", async () => {
    const leads = [
      { id: "lead-a", assignedTo: "seller-1", status: "new", phone: "+994500000001" },
      { id: "lead-b", assignedTo: "seller-1", status: "new", phone: "+994500000002" },
      { id: "lead-c", assignedTo: "seller-1", status: "new", phone: "+994500000003" },
    ]
    const preview = await previewSelectedVoiceQueue({
      db: {
        channelConfig: { findMany: vi.fn().mockResolvedValue([enabledChannelConfig()]) },
        user: { findFirst: vi.fn().mockResolvedValue({ id: "seller-1" }) },
        lead: { findMany: vi.fn().mockResolvedValue(leads) },
        voiceSuppression: { findMany: vi.fn().mockResolvedValue([]) },
        voiceConsent: { findMany: vi.fn().mockResolvedValue([]) },
        callLog: { findMany: vi.fn().mockResolvedValue([]) },
        voiceCallQueueItem: { findMany: vi.fn().mockResolvedValue([]) },
        voiceCallSession: {
          // One call left in each ceiling. Derived from the constants rather
          // than written out, because the ceilings are deployment-tunable: this
          // test was pinned to the old 5/20 and silently went red the day they
          // were raised, which says nothing about whether the cap still works.
          count: vi.fn()
            .mockResolvedValueOnce(MANUAL_LEAD_AI_USER_LIMIT_24H - 1)
            .mockResolvedValueOnce(MANUAL_LEAD_AI_ORGANIZATION_LIMIT_24H - 1),
        },
      } as never,
      auth,
      leadIds: leads.map((lead) => lead.id),
      featureOptions,
    })

    expect(preview.blockers).toEqual([])
    expect(preview.items.map((item) => ({ id: item.leadId, eligible: item.eligible }))).toEqual([
      { id: "lead-a", eligible: true },
      { id: "lead-b", eligible: false },
      { id: "lead-c", eligible: false },
    ])
    expect(preview.items[1]?.blockers).toEqual([
      "user_limit_reached",
      "organization_limit_reached",
    ])
  })

  it("creates an immutable batch from only the server-refreshed eligible subset", async () => {
    const now = new Date("2026-08-10T08:00:00.000Z")
    const leads = [
      { id: "lead-a", assignedTo: "seller-1", status: "new", phone: "+994500000001" },
      { id: "lead-b", assignedTo: "seller-1", status: "new", phone: null },
    ]
    const findLeads = vi.fn(async (args: { where: { id: { in: string[] } } }) => (
      leads.filter((lead) => args.where.id.in.includes(lead.id))
    ))
    const createQueue = vi.fn(async (args: {
      data: {
        ownerUserId: string
        createdByUserId: string
        name: string | null
        source: string
        status: string
        totalItems: number
        items: {
          create: Array<{
            leadId: string
            position: number
            queuedLeadKey: string
            queuedPhoneKey: string
          }>
        }
      }
    }) => ({
      id: "queue-1",
      ownerUserId: args.data.ownerUserId,
      createdByUserId: args.data.createdByUserId,
      name: args.data.name,
      source: args.data.source,
      status: args.data.status,
      totalItems: args.data.totalItems,
      startedAt: null,
      pausedAt: null,
      completedAt: null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
      items: args.data.items.create.map((item, index) => ({
        id: `item-${index}`,
        leadId: item.leadId,
        position: item.position,
        status: "pending",
        outcome: null,
        blockReason: null,
        voiceCallSessionId: null,
        claimedAt: null,
        startedAt: null,
        endedAt: null,
        createdAt: now,
      })),
    }))
    const db = {
      channelConfig: { findMany: vi.fn().mockResolvedValue([enabledChannelConfig()]) },
      user: { findFirst: vi.fn().mockResolvedValue({ id: "seller-1" }) },
      lead: { findMany: findLeads },
      voiceSuppression: { findMany: vi.fn().mockResolvedValue([]) },
      voiceConsent: { findMany: vi.fn().mockResolvedValue([]) },
      callLog: { findMany: vi.fn().mockResolvedValue([]) },
      voiceCallSession: { count: vi.fn().mockResolvedValue(0) },
      voiceCallQueue: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: createQueue,
      },
      voiceCallQueueItem: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(db)),
    }

    const result = await createSelectedVoiceQueue({
      db: db as never,
      auth,
      leadIds: ["lead-a", "lead-b"],
      idempotencyKey: "00000000-0000-4000-8000-000000000002",
      consentConfirmed: true,
      now,
      featureOptions,
    })

    expect(result.replayed).toBe(false)
    expect(result.queue.totalItems).toBe(1)
    expect(result.queue.items?.map((item) => item.leadId)).toEqual(["lead-a"])
    expect(createQueue.mock.calls[0]?.[0].data.items.create).toEqual([
      expect.objectContaining({
        leadId: "lead-a",
        position: 0,
        queuedLeadKey: "lead-a",
        queuedPhoneKey: "+994500000001",
      }),
    ])
    expect(db.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ role: "sales", isActive: true }),
    }))
  })

  it("keeps only the first selected lead for a normalized duplicate phone", async () => {
    const leads = [
      { id: "lead-a", assignedTo: "seller-1", status: "new", phone: "+994 50 000 00 01" },
      { id: "lead-b", assignedTo: "seller-1", status: "new", phone: "0500000001" },
    ]
    const preview = await previewSelectedVoiceQueue({
      db: {
        channelConfig: { findMany: vi.fn().mockResolvedValue([enabledChannelConfig()]) },
        user: { findFirst: vi.fn().mockResolvedValue({ id: "seller-1" }) },
        lead: { findMany: vi.fn().mockResolvedValue(leads) },
        voiceSuppression: { findMany: vi.fn().mockResolvedValue([]) },
        voiceConsent: { findMany: vi.fn().mockResolvedValue([]) },
        callLog: { findMany: vi.fn().mockResolvedValue([]) },
        voiceCallQueueItem: { findMany: vi.fn().mockResolvedValue([]) },
        voiceCallSession: { count: vi.fn().mockResolvedValue(0) },
      } as never,
      auth,
      leadIds: leads.map((lead) => lead.id),
      featureOptions,
    })

    expect(preview.items[0]).toMatchObject({ leadId: "lead-a", eligible: true })
    expect(preview.items[1]).toMatchObject({
      leadId: "lead-b",
      eligible: false,
      blockers: ["duplicate_phone"],
    })
  })

  it("does not let an inactive first duplicate reserve the phone from a later active lead", async () => {
    const leads = [
      { id: "lead-inactive", assignedTo: "seller-1", status: "lost", phone: "+994500000001" },
      { id: "lead-active", assignedTo: "seller-1", status: "new", phone: "0500000001" },
    ]
    const preview = await previewSelectedVoiceQueue({
      db: {
        channelConfig: { findMany: vi.fn().mockResolvedValue([enabledChannelConfig()]) },
        user: { findFirst: vi.fn().mockResolvedValue({ id: "seller-1" }) },
        lead: { findMany: vi.fn().mockResolvedValue(leads) },
        voiceSuppression: { findMany: vi.fn().mockResolvedValue([]) },
        voiceConsent: { findMany: vi.fn().mockResolvedValue([]) },
        callLog: { findMany: vi.fn().mockResolvedValue([]) },
        voiceCallQueueItem: { findMany: vi.fn().mockResolvedValue([]) },
        voiceCallSession: { count: vi.fn().mockResolvedValue(0) },
      } as never,
      auth,
      leadIds: leads.map((lead) => lead.id),
      featureOptions,
    })

    expect(preview.items[0]).toMatchObject({ eligible: false, blockers: ["lead_inactive"] })
    expect(preview.items[1]).toMatchObject({ eligible: true, blockers: [] })
  })

  it("blocks a duplicate lead record by canonical target phone after a proven connection", async () => {
    const lead = {
      id: "lead-new-record",
      assignedTo: "seller-1",
      status: "new",
      phone: "+994500000001",
    }
    const preview = await previewSelectedVoiceQueue({
      db: {
        channelConfig: { findMany: vi.fn().mockResolvedValue([enabledChannelConfig()]) },
        user: { findFirst: vi.fn().mockResolvedValue({ id: "seller-1" }) },
        lead: { findMany: vi.fn().mockResolvedValue([lead]) },
        voiceSuppression: { findMany: vi.fn().mockResolvedValue([]) },
        voiceConsent: { findMany: vi.fn().mockResolvedValue([]) },
        callLog: {
          findMany: vi.fn().mockResolvedValue([callHistoryRow({
            leadId: "different-lead-record",
            toNumber: "+994500000001",
            targetPhoneE164: "+994500000001",
            wasAnswered: true,
          })]),
        },
        voiceCallQueueItem: { findMany: vi.fn().mockResolvedValue([]) },
        voiceCallSession: { count: vi.fn().mockResolvedValue(0) },
      } as never,
      auth,
      leadIds: [lead.id],
      featureOptions,
    })

    expect(preview.items[0]).toMatchObject({
      eligible: false,
      blockers: ["connected_before"],
    })
  })

  it("blocks legacy completed evidence only for the exact same lead", async () => {
    const lead = {
      id: "lead-legacy",
      assignedTo: "seller-1",
      status: "new",
      phone: "+994500000001",
    }
    const preview = await previewSelectedVoiceQueue({
      db: {
        channelConfig: { findMany: vi.fn().mockResolvedValue([enabledChannelConfig()]) },
        user: { findFirst: vi.fn().mockResolvedValue({ id: "seller-1" }) },
        lead: { findMany: vi.fn().mockResolvedValue([lead]) },
        voiceSuppression: { findMany: vi.fn().mockResolvedValue([]) },
        voiceConsent: { findMany: vi.fn().mockResolvedValue([]) },
        callLog: {
          findMany: vi.fn().mockResolvedValue([callHistoryRow({
            leadId: lead.id,
            toNumber: "unrelated-legacy-value",
            status: "completed",
            duration: 42,
          })]),
        },
        voiceCallQueueItem: { findMany: vi.fn().mockResolvedValue([]) },
        voiceCallSession: { count: vi.fn().mockResolvedValue(0) },
      } as never,
      auth,
      leadIds: [lead.id],
      featureOptions,
    })

    expect(preview.items[0]).toMatchObject({
      eligible: false,
      blockers: ["connected_before"],
    })
  })

  it("blocks a duplicate phone stored as an exact deterministic legacy raw variant", async () => {
    const lead = {
      id: "lead-raw-variant",
      assignedTo: "seller-1",
      status: "new",
      phone: "+994500000001",
    }
    const preview = await previewSelectedVoiceQueue({
      db: {
        channelConfig: { findMany: vi.fn().mockResolvedValue([enabledChannelConfig()]) },
        user: { findFirst: vi.fn().mockResolvedValue({ id: "seller-1" }) },
        lead: { findMany: vi.fn().mockResolvedValue([lead]) },
        voiceSuppression: { findMany: vi.fn().mockResolvedValue([]) },
        voiceConsent: { findMany: vi.fn().mockResolvedValue([]) },
        callLog: {
          findMany: vi.fn().mockResolvedValue([callHistoryRow({
            leadId: "different-lead",
            toNumber: "0500000001",
            providerOutcome: "connected",
          })]),
        },
        voiceCallQueueItem: { findMany: vi.fn().mockResolvedValue([]) },
        voiceCallSession: { count: vi.fn().mockResolvedValue(0) },
      } as never,
      auth,
      leadIds: [lead.id],
      featureOptions,
    })

    expect(preview.items[0]).toMatchObject({
      eligible: false,
      blockers: ["connected_before"],
    })
  })

  it("does not classify a no-answer row as a prior connection", async () => {
    const lead = {
      id: "lead-no-answer",
      assignedTo: "seller-1",
      status: "new",
      phone: "+994500000001",
    }
    const preview = await previewSelectedVoiceQueue({
      db: {
        channelConfig: { findMany: vi.fn().mockResolvedValue([enabledChannelConfig()]) },
        user: { findFirst: vi.fn().mockResolvedValue({ id: "seller-1" }) },
        lead: { findMany: vi.fn().mockResolvedValue([lead]) },
        voiceSuppression: { findMany: vi.fn().mockResolvedValue([]) },
        voiceConsent: { findMany: vi.fn().mockResolvedValue([]) },
        callLog: {
          findMany: vi.fn().mockResolvedValue([callHistoryRow({
            leadId: lead.id,
            targetPhoneE164: "+994500000001",
            status: "no-answer",
            duration: 0,
            providerOutcome: "no_answer",
          })]),
        },
        voiceCallQueueItem: { findMany: vi.fn().mockResolvedValue([]) },
        voiceCallSession: { count: vi.fn().mockResolvedValue(0) },
      } as never,
      auth,
      leadIds: [lead.id],
      featureOptions,
    })

    expect(preview.items[0]).toMatchObject({ eligible: true, blockers: [] })
  })

  it("classifies a queued-lead uniqueness race as already_queued, not idempotency failure", async () => {
    const lead = {
      id: "lead-a",
      assignedTo: "seller-1",
      status: "new",
      phone: "+994500000001",
    }
    const duplicate = new Prisma.PrismaClientKnownRequestError("duplicate queue target", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: "voice_call_queue_items_org_queued_lead_key" },
    })
    const db = {
      channelConfig: { findMany: vi.fn().mockResolvedValue([enabledChannelConfig()]) },
      user: { findFirst: vi.fn().mockResolvedValue({ id: "seller-1" }) },
      lead: { findMany: vi.fn().mockResolvedValue([lead]) },
      voiceSuppression: { findMany: vi.fn().mockResolvedValue([]) },
      voiceConsent: { findMany: vi.fn().mockResolvedValue([]) },
      callLog: { findMany: vi.fn().mockResolvedValue([]) },
      voiceCallSession: { count: vi.fn().mockResolvedValue(0) },
      voiceCallQueueItem: {
        findMany: vi.fn().mockResolvedValue([{
          leadId: lead.id,
          queuedPhoneKey: lead.phone,
        }]),
      },
      voiceCallQueue: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn().mockRejectedValue(duplicate),
    }

    await expect(createSelectedVoiceQueue({
      db: db as never,
      auth,
      leadIds: [lead.id],
      idempotencyKey: "00000000-0000-4000-8000-000000000002",
      consentConfirmed: true,
      featureOptions,
    })).rejects.toMatchObject({ code: "already_queued" })
  })
})

describe("queue cancellation boundary", () => {
  it("cancels only pending items and never attempts to terminate an active call", async () => {
    const now = new Date("2026-08-10T08:00:00.000Z")
    const db = {
      voiceCallQueue: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue({
          id: "queue-1",
          ownerUserId: "seller-1",
          createdByUserId: "seller-1",
          name: null,
          source: "selected",
          status: "cancelled",
          totalItems: 2,
          startedAt: now,
          pausedAt: null,
          completedAt: null,
          cancelledAt: now,
          createdAt: now,
          updatedAt: now,
          items: [],
        }),
      },
      voiceCallQueueItem: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      voiceCallSession: { updateMany: vi.fn() },
      callLog: { updateMany: vi.fn() },
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(db)),
    }

    await cancelVoiceQueue({
      db: db as never,
      auth,
      queueId: "queue-1",
      now,
    })

    expect(db.voiceCallQueueItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "pending" }),
      data: expect.objectContaining({
        status: "cancelled",
        queuedLeadKey: null,
        queuedPhoneKey: null,
      }),
    }))
    expect(db.voiceCallSession.updateMany).not.toHaveBeenCalled()
    expect(db.callLog.updateMany).not.toHaveBeenCalled()
  })
})

describe("dispatch-uncertain operator resolution", () => {
  const managerAuth = { orgId: "org-1", userId: "manager-1", role: "manager" } as const
  const now = new Date("2026-08-10T08:10:00.000Z")

  function resolutionDb() {
    const finalQueue = {
      id: "queue-1",
      ownerUserId: "seller-1",
      createdByUserId: "manager-1",
      name: null,
      source: "selected",
      status: "paused",
      totalItems: 2,
      startedAt: new Date("2026-08-10T08:00:00.000Z"),
      pausedAt: now,
      completedAt: null,
      cancelledAt: null,
      createdAt: new Date("2026-08-10T07:55:00.000Z"),
      updatedAt: now,
      items: [],
    }
    const db = {
      channelConfig: { findFirst: vi.fn().mockResolvedValue(enabledChannelConfig()) },
      voiceCallQueueItem: {
        findFirst: vi.fn().mockResolvedValue({
          id: "item-1",
          queueId: "queue-1",
          updatedAt: new Date("2026-08-10T08:00:00.000Z"),
          voiceCallSession: {
            id: "session-1",
            providerCallId: "00000000-0000-4000-8000-000000000111",
            channelConfigId: "voip-config",
            callLogId: "call-1",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(1),
      },
      voiceCallSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      callLog: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      voiceCallQueue: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue(finalQueue),
      },
      callEvent: { create: vi.fn().mockResolvedValue({ id: "event-1" }) },
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(db)),
    }
    return db
  }

  it("settles only from a durable not_accepted tombstone and records its revision", async () => {
    const db = resolutionDb()
    const finalizeCallAttempt = vi.fn().mockResolvedValue({
      state: "not_accepted",
      revision: 7,
      updatedAt: "2026-08-10T08:09:00.000Z",
    })

    await expect(resolveUncertainVoiceQueueItem({
      db: db as never,
      auth: managerAuth,
      ownerUserId: "seller-1",
      queueId: "queue-1",
      itemId: "item-1",
      acknowledgeNoRedial: true,
      now,
      minimumAgeMs: 0,
      finalizeCallAttempt,
    })).resolves.toMatchObject({ id: "queue-1", status: "paused" })

    expect(finalizeCallAttempt).toHaveBeenCalledTimes(1)
    expect(db.voiceCallSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        outcome: "failed",
        blockReason: "provider_not_accepted",
        activeOrganizationKey: null,
        activeLeadKey: null,
        activePhoneKey: null,
      }),
    }))
    expect(db.voiceCallQueueItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        outcome: "failed",
        blockReason: "provider_not_accepted",
        queuedLeadKey: null,
        queuedPhoneKey: null,
      }),
    }))
    expect(db.callLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        providerOutcome: "failed",
        conversationOutcome: "failed",
      }),
    }))
    expect(db.callEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: "voice_provider_finality_resolved",
        payload: expect.objectContaining({
          resolution: "provider_not_accepted",
          providerState: "not_accepted",
          providerRevision: 7,
        }),
      }),
    }))
  })

  it("acknowledges durable provider-unknown evidence without another provider probe or redial", async () => {
    const db = resolutionDb()
    db.voiceCallQueueItem.findFirst.mockResolvedValueOnce({
      id: "item-1",
      queueId: "queue-1",
      updatedAt: new Date("2026-08-10T08:00:00.000Z"),
      voiceCallSession: {
        id: "session-1",
        providerCallId: "00000000-0000-4000-8000-000000000111",
        channelConfigId: "voip-config",
        callLogId: "call-1",
        blockReason: "provider_unknown_no_redial",
      },
    })
    const finalizeCallAttempt = vi.fn()

    await expect(resolveUncertainVoiceQueueItem({
      db: db as never,
      auth: managerAuth,
      ownerUserId: "seller-1",
      queueId: "queue-1",
      itemId: "item-1",
      acknowledgeNoRedial: true,
      now,
      minimumAgeMs: 0,
      finalizeCallAttempt,
    })).resolves.toMatchObject({ id: "queue-1", status: "paused" })

    expect(finalizeCallAttempt).not.toHaveBeenCalled()
    expect(db.channelConfig.findFirst).not.toHaveBeenCalled()
    expect(db.voiceCallSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        blockReason: "provider_unknown_no_redial",
        activeOrganizationKey: null,
      }),
      data: expect.objectContaining({
        status: "cancelled",
        outcome: "operator_closed_unknown_no_redial",
        activeLeadKey: null,
        activePhoneKey: null,
      }),
    }))
    expect(db.voiceCallQueueItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "skipped",
        outcome: "skipped",
        blockReason: "operator_closed_unknown_no_redial",
        queuedLeadKey: null,
        queuedPhoneKey: null,
      }),
    }))
    expect(db.callLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ conversationOutcome: "provider_unknown_no_redial" }),
      data: { conversationOutcome: "operator_closed_unknown_no_redial" },
    }))
  })

  it.each(["accepted", "active", "unknown"] as const)(
    "keeps every fence when durable provider state is %s",
    async (state) => {
      const db = resolutionDb()
      await expect(resolveUncertainVoiceQueueItem({
        db: db as never,
        auth: managerAuth,
        ownerUserId: "seller-1",
        queueId: "queue-1",
        itemId: "item-1",
        acknowledgeNoRedial: true,
        now,
        minimumAgeMs: 0,
        finalizeCallAttempt: vi.fn().mockResolvedValue(
          state === "unknown"
            ? { state }
            : { state, revision: 4, updatedAt: "2026-08-10T08:09:00.000Z" },
        ),
      })).rejects.toMatchObject({
        code: state === "unknown" ? "uncertain_status_unavailable" : "uncertain_call_still_active",
      })
      expect(db.$transaction).not.toHaveBeenCalled()
      expect(db.voiceCallSession.updateMany).not.toHaveBeenCalled()
      expect(db.voiceCallQueueItem.updateMany).not.toHaveBeenCalled()
      expect(db.callLog.updateMany).not.toHaveBeenCalled()
    },
  )

  it("keeps every fence when the finality request fails", async () => {
    const db = resolutionDb()

    await expect(resolveUncertainVoiceQueueItem({
      db: db as never,
      auth: managerAuth,
      ownerUserId: "seller-1",
      queueId: "queue-1",
      itemId: "item-1",
      acknowledgeNoRedial: true,
      now,
      minimumAgeMs: 0,
      finalizeCallAttempt: vi.fn().mockRejectedValue(new Error("network down")),
    })).rejects.toMatchObject({ code: "uncertain_status_unavailable" })

    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.voiceCallSession.updateMany).not.toHaveBeenCalled()
  })

  it("persists terminal no_answer when the signed callback is lost", async () => {
    const db = resolutionDb()
    await expect(resolveUncertainVoiceQueueItem({
      db: db as never,
      auth: managerAuth,
      ownerUserId: "seller-1",
      queueId: "queue-1",
      itemId: "item-1",
      acknowledgeNoRedial: true,
      now,
      minimumAgeMs: 0,
      finalizeCallAttempt: vi.fn().mockResolvedValue({
        state: "terminal",
        outcome: "no_answer",
        revision: 8,
        updatedAt: "2026-08-10T08:09:30.000Z",
      }),
    })).resolves.toMatchObject({ id: "queue-1", status: "paused" })

    expect(db.voiceCallSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "no_answer", outcome: "no_answer" }),
    }))
    expect(db.voiceCallQueueItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "no_answer", outcome: "no_answer" }),
    }))
    const callLogData = db.callLog.updateMany.mock.calls[0]?.[0]?.data
    expect(callLogData).toEqual(expect.objectContaining({
      status: "no-answer",
      providerOutcome: "no_answer",
      conversationOutcome: "no_answer",
      wasAnswered: false,
      endedAt: now,
    }))
  })

  it("blocks duplicate eligibility after terminal connected until callback enrichment", async () => {
    const db = resolutionDb()
    await expect(resolveUncertainVoiceQueueItem({
      db: db as never,
      auth: managerAuth,
      ownerUserId: "seller-1",
      queueId: "queue-1",
      itemId: "item-1",
      acknowledgeNoRedial: true,
      now,
      minimumAgeMs: 0,
      finalizeCallAttempt: vi.fn().mockResolvedValue({
        state: "terminal",
        outcome: "connected",
        revision: 9,
        updatedAt: "2026-08-10T08:09:45.000Z",
      }),
    })).resolves.toMatchObject({ id: "queue-1", status: "paused" })

    expect(db.callLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ providerOutcome: null }),
      data: expect.objectContaining({
        status: "completed",
        wasAnswered: true,
        conversationOutcome: "provider_connected_pending_result",
      }),
    }))
    const callLogData = db.callLog.updateMany.mock.calls[0]?.[0]?.data
    expect(callLogData).not.toHaveProperty("providerOutcome")
  })

  it("loses a stale session CAS without releasing any downstream fence", async () => {
    const db = resolutionDb()
    db.voiceCallSession.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(resolveUncertainVoiceQueueItem({
      db: db as never,
      auth: managerAuth,
      ownerUserId: "seller-1",
      queueId: "queue-1",
      itemId: "item-1",
      acknowledgeNoRedial: true,
      now,
      minimumAgeMs: 0,
      finalizeCallAttempt: vi.fn().mockResolvedValue({
        state: "not_accepted",
        revision: 10,
        updatedAt: "2026-08-10T08:09:50.000Z",
      }),
    })).rejects.toMatchObject({ code: "uncertain_item_stale" })

    expect(db.voiceCallQueueItem.updateMany).not.toHaveBeenCalled()
    expect(db.callLog.updateMany).not.toHaveBeenCalled()
    expect(db.callEvent.create).not.toHaveBeenCalled()
  })

  it("rolls back settlement when the queue-item CAS loses", async () => {
    const db = resolutionDb()
    db.voiceCallQueueItem.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(resolveUncertainVoiceQueueItem({
      db: db as never,
      auth: managerAuth,
      ownerUserId: "seller-1",
      queueId: "queue-1",
      itemId: "item-1",
      acknowledgeNoRedial: true,
      now,
      minimumAgeMs: 0,
      finalizeCallAttempt: vi.fn().mockResolvedValue({
        state: "terminal",
        outcome: "cancelled",
        revision: 11,
        updatedAt: "2026-08-10T08:09:55.000Z",
      }),
    })).rejects.toMatchObject({ code: "uncertain_item_stale" })

    expect(db.callLog.updateMany).not.toHaveBeenCalled()
    expect(db.callEvent.create).not.toHaveBeenCalled()
  })

  it("hides manager-only resolution from a seller before any provider read", async () => {
    const db = resolutionDb()
    const finalizeCallAttempt = vi.fn()
    await expect(resolveUncertainVoiceQueueItem({
      db: db as never,
      auth,
      queueId: "queue-1",
      itemId: "item-1",
      acknowledgeNoRedial: true,
      finalizeCallAttempt,
    })).rejects.toMatchObject({ code: "queue_not_found" })
    expect(finalizeCallAttempt).not.toHaveBeenCalled()
    expect(db.voiceCallQueueItem.findFirst).not.toHaveBeenCalled()
  })
})

describe("sequential worker", () => {
  function dispatchDb(params?: { remainingAfterTerminal?: number }) {
    const now = new Date("2026-08-10T08:00:00.000Z")
    const itemFindFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "item-1",
        queueId: "queue-1",
        ownerUserId: "seller-1",
        leadId: "lead-1",
        idempotencyKey: "00000000-0000-4000-8000-000000000002",
        queuedPhoneKey: "+994500000001",
      })
    const db = {
      channelConfig: { findMany: vi.fn().mockResolvedValue([enabledChannelConfig()]) },
      voiceCallQueue: {
        findFirst: vi.fn().mockResolvedValue({
          id: "queue-1",
          ownerUserId: "seller-1",
          consentAudit: {
            scope: "sales",
            consentConfirmed: true,
            basis: "bulk_per_call_attestation",
            attestedByUserId: "seller-1",
            attestedAt: now.toISOString(),
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      voiceCallQueueItem: {
        findFirst: itemFindFirst,
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(params?.remainingAfterTerminal ?? 0),
      },
      callLog: {
        create: vi.fn().mockResolvedValue({ id: "call-1" }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      voiceCallSession: {
        create: vi.fn().mockResolvedValue({ id: "session-1" }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ id: "lead-1" }]),
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn(async (operation: unknown) => {
        if (Array.isArray(operation)) return Promise.all(operation)
        return (operation as (tx: unknown) => unknown)(db)
      }),
    }
    return { db, now }
  }

  it("does no claim or provider work while the server gate is disabled and no item is active", async () => {
    const findMany = vi.fn()
    const findItem = vi.fn().mockResolvedValue(null)
    const dispatch = vi.fn()
    const result = await processSequentialVoiceQueueOrganization({
      db: {
        channelConfig: { findMany },
        voiceCallQueueItem: { findFirst: findItem },
      } as never,
      organizationId: "org-1",
      featureOptions: { executionEnabled: false, pilotOrganizationId: "org-1" },
      dispatch,
    })

    expect(result).toEqual({ status: "disabled" })
    expect(findMany).not.toHaveBeenCalled()
    expect(findItem).toHaveBeenCalledOnce()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it("terminally blocks claim-time execution after the seller is deactivated", async () => {
    const decision = await recheckVoiceQueueItemEligibility({
      db: {
        channelConfig: { findMany: vi.fn().mockResolvedValue([enabledChannelConfig()]) },
        user: { findFirst: vi.fn().mockResolvedValue(null) },
        lead: {
          findFirst: vi.fn().mockResolvedValue({
            id: "lead-a",
            assignedTo: "seller-1",
            status: "new",
            phone: "+994500000001",
          }),
        },
      } as never,
      item: {
        id: "item-a",
        organizationId: "org-1",
        queueId: "queue-a",
        ownerUserId: "seller-1",
        leadId: "lead-a",
        idempotencyKey: "00000000-0000-4000-8000-000000000002",
        queuedPhoneKey: "+994500000001",
        leaseToken: "lease-a",
        consentAudit: {
          scope: "sales",
          consentConfirmed: true,
          basis: "bulk_per_call_attestation",
          attestedByUserId: "seller-1",
          attestedAt: "2026-08-10T08:00:00.000Z",
        },
      },
      now: new Date("2026-08-10T08:00:00.000Z"),
      featureOptions,
    })

    expect(decision).toMatchObject({
      eligible: false,
      blocker: "owner_inactive",
      terminal: true,
    })
  })

  it("uses the shared exact call-history predicate at claim time", async () => {
    const callLogFindFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "prior-call" })
    const decision = await recheckVoiceQueueItemEligibility({
      db: {
        channelConfig: { findMany: vi.fn().mockResolvedValue([enabledChannelConfig()]) },
        user: { findFirst: vi.fn().mockResolvedValue({ id: "seller-1" }) },
        lead: {
          findFirst: vi.fn().mockResolvedValue({
            id: "lead-a",
            assignedTo: "seller-1",
            status: "new",
            phone: "+994500000001",
          }),
        },
        businessHours: {
          findFirst: vi.fn().mockResolvedValue({
            timezone: "Asia/Baku",
            isActive: true,
            schedule: {
              mon: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
            },
            holidays: [],
          }),
        },
        voiceCallSession: {
          findFirst: vi.fn().mockResolvedValue(null),
          count: vi.fn().mockResolvedValue(0),
        },
        voiceSuppression: { findFirst: vi.fn().mockResolvedValue(null) },
        voiceConsent: { findMany: vi.fn().mockResolvedValue([]) },
        callLog: { findFirst: callLogFindFirst },
      } as never,
      item: {
        id: "item-a",
        organizationId: "org-1",
        queueId: "queue-a",
        ownerUserId: "seller-1",
        leadId: "lead-a",
        idempotencyKey: "00000000-0000-4000-8000-000000000002",
        queuedPhoneKey: "+994500000001",
        leaseToken: "lease-a",
        consentAudit: {
          scope: "sales",
          consentConfirmed: true,
          basis: "bulk_per_call_attestation",
          attestedByUserId: "seller-1",
          attestedAt: "2026-08-10T06:00:00.000Z",
        },
      },
      now: new Date("2026-08-10T06:00:00.000Z"),
      featureOptions,
    })

    expect(decision).toMatchObject({
      eligible: false,
      blocker: "connected_before",
      terminal: true,
    })
    const unresolvedQuery = JSON.stringify(callLogFindFirst.mock.calls[0]?.[0])
    expect(unresolvedQuery).toContain('"callMode":{"in":["human"]}')
    expect(unresolvedQuery).toContain('"conversationOutcome":"provider_unknown_no_redial"')
    const query = JSON.stringify(callLogFindFirst.mock.calls[1]?.[0])
    expect(query).toContain('"targetPhoneE164":"+994500000001"')
    expect(query).toContain('"toNumber":{"in":["+994500000001","994500000001","0500000001"]}')
    expect(query).toContain('"leadId":"lead-a","callMode":"human","status":"completed","duration":{"gt":0}')
    expect(query).not.toContain("contains")
  })
  it("does not claim or dispatch another item while the previous session is non-terminal", async () => {
    const dispatch = vi.fn()
    const transaction = vi.fn()
    const result = await processSequentialVoiceQueueOrganization({
      db: {
        channelConfig: { findMany: vi.fn().mockResolvedValue([enabledChannelConfig()]) },
        voiceCallQueueItem: {
          findFirst: vi.fn().mockResolvedValue({
            id: "item-1",
            queueId: "queue-1",
            status: "waiting_terminal",
            leaseUntil: null,
            voiceCallSession: {
              id: "session-1",
              status: "dispatching",
              outcome: null,
              endedAt: null,
            },
          }),
        },
        $transaction: transaction,
      } as never,
      organizationId: "org-1",
      featureOptions,
      dispatch,
    })

    expect(result).toEqual({ status: "waiting_terminal" })
    expect(transaction).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it("dispatches only the first pending item and then persists waiting_terminal", async () => {
    const { db, now } = dispatchDb()
    const recheckEligibility = vi.fn().mockResolvedValue(eligibleQueueDecision)
    const dispatch = vi.fn(async (input: { providerCallId: string }) => ({
      success: true,
      callSid: input.providerCallId,
    }))
    const result = await processSequentialVoiceQueueOrganization({
      db: db as never,
      organizationId: "org-1",
      now,
      featureOptions,
      recheckEligibility,
      dispatch,
    })

    expect(result).toEqual({ status: "dispatching" })
    expect(dispatch).toHaveBeenCalledOnce()
    expect(db.callLog.create).toHaveBeenCalledOnce()
    expect(db.voiceCallSession.create).toHaveBeenCalledOnce()
    expect(db.voiceCallQueueItem.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: { status: "waiting_terminal" },
    }))
    expect(db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      db.$queryRaw.mock.invocationCallOrder[0],
    )
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      db.$executeRaw.mock.invocationCallOrder[1],
    )
    expect(db.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(
      recheckEligibility.mock.invocationCallOrder[0],
    )
  })

  it("moves a waiting-terminal item to attention when its callback lease expires", async () => {
    const now = new Date("2026-08-10T08:20:00.000Z")
    const db = {
      channelConfig: { findMany: vi.fn() },
      voiceCallQueueItem: {
        findFirst: vi.fn().mockResolvedValue({
          id: "item-1",
          queueId: "queue-1",
          status: "waiting_terminal",
          leaseUntil: new Date("2026-08-10T08:10:00.000Z"),
          voiceCallSession: {
            id: "session-1",
            status: "dispatching",
            outcome: null,
            endedAt: null,
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      voiceCallQueue: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      voiceCallSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      $transaction: vi.fn(async (operation: unknown) => (
        Array.isArray(operation) ? Promise.all(operation) : operation
      )),
    }

    await expect(processSequentialVoiceQueueOrganization({
      db: db as never,
      organizationId: "org-1",
      now,
      featureOptions,
    })).resolves.toEqual({ status: "dispatch_uncertain" })
    expect(db.voiceCallQueueItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ["dispatching", "waiting_terminal", "dispatch_uncertain"] },
      }),
      data: { status: "dispatch_uncertain", leaseToken: null, leaseUntil: null },
    }))
    expect(db.voiceCallQueue.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "attention_required" },
    }))
  })

  it("definite provider rejection clears every session/item/queued fence", async () => {
    const { db, now } = dispatchDb()
    const result = await processSequentialVoiceQueueOrganization({
      db: db as never,
      organizationId: "org-1",
      now,
      featureOptions,
      recheckEligibility: vi.fn().mockResolvedValue(eligibleQueueDecision),
      dispatch: vi.fn().mockResolvedValue({
        success: false,
        failureCertainty: "definite_rejection",
      }),
    })

    expect(result).toEqual({ status: "provider_failed" })
    expect(db.voiceCallSession.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        activeOrganizationKey: null,
        activeLeadKey: null,
        activePhoneKey: null,
      }),
    }))
    expect(db.voiceCallQueueItem.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        queuedLeadKey: null,
        queuedPhoneKey: null,
        activeOrganizationKey: null,
        activeOwnerKey: null,
      }),
    }))
  })

  it("unknown delivery stops the queue and retains all no-redial fences", async () => {
    const { db, now } = dispatchDb()
    const result = await processSequentialVoiceQueueOrganization({
      db: db as never,
      organizationId: "org-1",
      now,
      featureOptions,
      recheckEligibility: vi.fn().mockResolvedValue(eligibleQueueDecision),
      dispatch: vi.fn().mockResolvedValue({
        success: false,
        failureCertainty: "unknown_delivery",
      }),
    })

    expect(result).toEqual({ status: "dispatch_uncertain" })
    const itemData = db.voiceCallQueueItem.updateMany.mock.calls.at(-1)?.[0].data
    expect(itemData).toEqual({ status: "dispatch_uncertain", leaseToken: null, leaseUntil: null })
    expect(itemData).not.toHaveProperty("queuedLeadKey")
    expect(itemData).not.toHaveProperty("queuedPhoneKey")
    expect(itemData).not.toHaveProperty("activeOrganizationKey")
    expect(db.voiceCallQueue.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: { status: "attention_required" },
    }))
  })

  it("transient recheck defers without dispatch and retains queued lead/phone fences", async () => {
    const { db, now } = dispatchDb()
    const dispatch = vi.fn()
    const result = await processSequentialVoiceQueueOrganization({
      db: db as never,
      organizationId: "org-1",
      now,
      featureOptions,
      recheckEligibility: vi.fn().mockResolvedValue({
        eligible: false,
        blocker: "provider_unavailable",
        terminal: false,
        retryAt: new Date(now.getTime() + 60_000),
        policySnapshot: {},
      }),
      dispatch,
    })

    expect(result).toEqual({ status: "deferred", blocker: "provider_unavailable" })
    const itemData = db.voiceCallQueueItem.updateMany.mock.calls.at(-1)?.[0].data
    expect(itemData).toMatchObject({
      status: "pending",
      activeOrganizationKey: null,
      activeOwnerKey: null,
      leaseToken: null,
      leaseUntil: null,
    })
    expect(itemData).not.toHaveProperty("queuedLeadKey")
    expect(itemData).not.toHaveProperty("queuedPhoneKey")
    expect(dispatch).not.toHaveBeenCalled()
  })

  it("does not claim from a paused queue", async () => {
    const db = {
      channelConfig: { findMany: vi.fn().mockResolvedValue([enabledChannelConfig()]) },
      voiceCallQueueItem: { findFirst: vi.fn().mockResolvedValue(null) },
      voiceCallQueue: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(db)),
    }
    const dispatch = vi.fn()
    await expect(processSequentialVoiceQueueOrganization({
      db: db as never,
      organizationId: "org-1",
      featureOptions,
      dispatch,
    })).resolves.toEqual({ status: "idle" })
    expect(dispatch).not.toHaveBeenCalled()
    expect(db.voiceCallQueue.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "running" }),
    }))
  })

  it("durably reconciles terminal state and stops before claiming the next item", async () => {
    const now = new Date("2026-08-10T08:00:00.000Z")
    const dispatch = vi.fn()
    const db = {
      channelConfig: { findMany: vi.fn().mockResolvedValue([enabledChannelConfig()]) },
      voiceCallQueueItem: {
        findFirst: vi.fn().mockResolvedValue({
          id: "item-1",
          queueId: "queue-1",
          status: "waiting_terminal",
          leaseUntil: null,
          voiceCallSession: {
            id: "session-1",
            status: "completed",
            outcome: "connected",
            endedAt: now,
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
      },
      voiceCallQueue: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(db)),
    }

    const result = await processSequentialVoiceQueueOrganization({
      db: db as never,
      organizationId: "org-1",
      now,
      featureOptions,
      dispatch,
    })

    expect(result).toEqual({ status: "terminal_reconciled" })
    expect(db.voiceCallQueueItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "completed",
        queuedLeadKey: null,
        queuedPhoneKey: null,
        activeOrganizationKey: null,
        activeOwnerKey: null,
      }),
    }))
    expect(dispatch).not.toHaveBeenCalled()
  })

  it("pauses remaining items after a late terminal resolves attention_required", async () => {
    const now = new Date("2026-08-10T08:00:00.000Z")
    const db = {
      channelConfig: { findMany: vi.fn() },
      voiceCallQueueItem: {
        findFirst: vi.fn().mockResolvedValue({
          id: "item-1",
          queueId: "queue-1",
          status: "dispatch_uncertain",
          leaseUntil: null,
          voiceCallSession: {
            id: "session-1",
            status: "completed",
            outcome: "connected",
            endedAt: now,
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(1),
      },
      voiceCallQueue: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(db)),
    }

    await expect(processSequentialVoiceQueueOrganization({
      db: db as never,
      organizationId: "org-1",
      now,
      featureOptions: { executionEnabled: false, pilotOrganizationId: "org-1" },
    })).resolves.toEqual({ status: "terminal_reconciled" })
    expect(db.voiceCallQueue.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "attention_required" }),
      data: { status: "paused", pausedAt: now },
    }))
  })

  it("reconciles an active terminal item even after future queue execution is disabled", async () => {
    const now = new Date("2026-08-10T08:00:00.000Z")
    const findConfig = vi.fn()
    const dispatch = vi.fn()
    const db = {
      channelConfig: { findMany: findConfig },
      voiceCallQueueItem: {
        findFirst: vi.fn().mockResolvedValue({
          id: "item-1",
          queueId: "queue-1",
          status: "waiting_terminal",
          leaseUntil: null,
          voiceCallSession: {
            id: "session-1",
            status: "completed",
            outcome: "connected",
            endedAt: now,
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
      },
      voiceCallQueue: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(db)),
    }

    await expect(processSequentialVoiceQueueOrganization({
      db: db as never,
      organizationId: "org-1",
      now,
      featureOptions: { executionEnabled: false, pilotOrganizationId: "org-1" },
      dispatch,
    })).resolves.toEqual({ status: "terminal_reconciled" })
    expect(findConfig).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })
})
