import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  isSocialBrandProtectionOnly: vi.fn(),
  publishReply: vi.fn(),
  sendProviderReply: vi.fn(),
}))

vi.mock("@/lib/social/brand-protection", () => ({
  isSocialBrandProtectionOnly: mocks.isSocialBrandProtectionOnly,
  SOCIAL_BRAND_PROTECTION_OUTBOUND_BLOCK_CODE: "brand_protection_only",
}))

vi.mock("@/lib/social/publishers", () => ({
  getSocialReplyPublisher: vi.fn(() => ({ publishReply: mocks.publishReply })),
}))

vi.mock("@/lib/social/provider-reply", () => ({
  sendProviderReply: mocks.sendProviderReply,
}))

import { getOutboundPublisherAdapter, type OutboundPublishRecord } from "@/lib/social/outbound-publisher"

const record: OutboundPublishRecord = {
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
    tokenExpiresAt: null,
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isSocialBrandProtectionOnly.mockResolvedValue(false)
})

describe("social outbound publisher", () => {
  it.each(["DIRECT", "PROVIDER"])(
    "does not call the %s publisher in Brand Protection mode",
    async (adapterType) => {
      mocks.isSocialBrandProtectionOnly.mockResolvedValue(true)

      const result = await getOutboundPublisherAdapter().publish({ ...record, adapterType })

      expect(result).toEqual({
        outcome: "DEFINITE_FAILURE",
        error: "brand_protection_only",
        retriable: false,
        provider: "brand_protection",
      })
      expect(mocks.publishReply).not.toHaveBeenCalled()
      expect(mocks.sendProviderReply).not.toHaveBeenCalled()
    },
  )
})
