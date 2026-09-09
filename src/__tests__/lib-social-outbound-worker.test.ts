import { beforeEach, describe, expect, it, vi } from "vitest"

const { evaluateOutboundReplyGates } = vi.hoisted(() => ({
  evaluateOutboundReplyGates: vi.fn(),
}))

vi.mock("@/lib/social/outbound-service", () => ({
  evaluateOutboundReplyGates,
  isTerminalOutboundInvalidation: vi.fn(() => false),
}))

const tx = {
  outboundSocialReply: { updateMany: vi.fn() },
  socialMention: { updateMany: vi.fn() },
  outboundSocialReplyEvent: { create: vi.fn() },
}

const mockPrisma = vi.hoisted(() => ({
  outboundSocialReply: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  outboundSocialReplyEvent: { create: vi.fn() },
  $transaction: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))

import { processOutboundSocialReplies, reconcileOutboundSocialReplies } from "@/lib/social/outbound-worker"
import type { OutboundPublisherAdapter } from "@/lib/social/outbound-publisher"

const publishRecord = {
  id: "outbound-1",
  organizationId: "org-1",
  platform: "instagram",
  adapterType: "DIRECT",
  targetExternalId: "comment-1",
  replyText: "Thank you",
  idempotencyKey: "idem-1",
  providerRequestId: "request-1",
  externalReplyId: null,
  mention: {
    id: "mention-1",
    organizationId: "org-1",
    platform: "instagram",
    externalId: "comment-1",
    sourceType: "comment",
    sourceProvider: "native",
    sourceMetadata: {},
  },
  senderAccount: {
    id: "account-1",
    platform: "instagram",
    handle: "brand",
    displayName: "Brand",
    accessToken: "encrypted",
  },
}

const dbRecord = {
  ...publishRecord,
  mention: { ...publishRecord.mention, text: "Source" },
  senderAccount: publishRecord.senderAccount,
}

function adapterWith(publishResult: Awaited<ReturnType<OutboundPublisherAdapter["publish"]>>): OutboundPublisherAdapter {
  return {
    publish: vi.fn(async () => publishResult),
    reconcile: vi.fn(async () => ({ outcome: "UNKNOWN" as const, evidence: {} })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.outboundSocialReply.findMany.mockResolvedValue([{ id: "outbound-1", organizationId: "org-1" }])
  mockPrisma.outboundSocialReply.findFirst.mockResolvedValue(dbRecord)
  mockPrisma.outboundSocialReply.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.outboundSocialReplyEvent.create.mockResolvedValue({})
  evaluateOutboundReplyGates.mockResolvedValue({ allowed: true, reason: "allowed", retryable: false, terminal: false, snapshot: { policyVersion: 1 } })
  tx.outboundSocialReply.updateMany.mockResolvedValue({ count: 1 })
  tx.socialMention.updateMany.mockResolvedValue({ count: 1 })
  tx.outboundSocialReplyEvent.create.mockResolvedValue({})
  mockPrisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx))
})

describe("social outbound worker", () => {
  it("moves an ambiguous provider result to reconciliation without retrying", async () => {
    const adapter = adapterWith({ outcome: "UNKNOWN", error: "network_timeout_after_request", provider: "instagram" })

    const result = await processOutboundSocialReplies({ adapter, now: new Date("2026-07-12T10:00:00Z") })

    expect(result).toMatchObject({ claimed: 1, reconciliationRequired: 1, sent: 0 })
    expect(adapter.publish).toHaveBeenCalledTimes(1)
    expect(mockPrisma.outboundSocialReply.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: "RECONCILIATION_REQUIRED", nextAttemptAt: null }),
    }))
    expect(mockPrisma.outboundSocialReplyEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: "OUTBOUND_RESULT_UNKNOWN" }),
    }))
  })

  it("marks SENT only after a conclusive publisher response", async () => {
    const adapter = adapterWith({ outcome: "SENT", externalReplyId: "reply-123", provider: "instagram" })

    const result = await processOutboundSocialReplies({ adapter, now: new Date("2026-07-12T10:00:00Z") })

    expect(result.sent).toBe(1)
    expect(tx.outboundSocialReply.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ state: "SENDING" }),
      data: expect.objectContaining({ state: "SENT", externalReplyId: "reply-123" }),
    }))
    expect(tx.socialMention.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "replied" }),
    }))
  })

  it("does not publish when another worker already owns the CAS claim", async () => {
    mockPrisma.outboundSocialReply.updateMany.mockResolvedValueOnce({ count: 0 })
    const adapter = adapterWith({ outcome: "SENT", externalReplyId: "reply-123", provider: "instagram" })

    const result = await processOutboundSocialReplies({ adapter })

    expect(result).toMatchObject({ claimed: 0, skipped: 1 })
    expect(adapter.publish).not.toHaveBeenCalled()
  })

  it("normalizes a non-finite cron limit before querying Prisma", async () => {
    mockPrisma.outboundSocialReply.findMany.mockResolvedValue([])

    await processOutboundSocialReplies({ limit: Number.NaN, adapter: adapterWith({ outcome: "DEFINITE_FAILURE", error: "unused", retriable: false, provider: "test" }) })

    expect(mockPrisma.outboundSocialReply.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }))
  })

  it("keeps reconciliation UNKNOWN when no contract-tested readback exists", async () => {
    const adapter: OutboundPublisherAdapter = {
      publish: vi.fn(),
      reconcile: vi.fn(async () => ({ outcome: "UNKNOWN" as const, evidence: { automaticRetryAllowed: false } })),
    }

    const result = await reconcileOutboundSocialReplies({ adapter })

    expect(result).toEqual({ scanned: 1, sent: 0, notSent: 0, unknown: 1 })
    expect(mockPrisma.outboundSocialReply.updateMany).not.toHaveBeenCalled()
  })
})
