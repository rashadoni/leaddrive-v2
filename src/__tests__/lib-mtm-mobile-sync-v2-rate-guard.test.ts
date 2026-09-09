import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/public-abuse-guard", () => ({
  consumePublicRateLimitBatch: vi.fn(),
}))

import { consumeMtmMobileSyncV2RateLimit } from "@/lib/mtm/mobile-sync-v2-rate-guard"
import { consumePublicRateLimitBatch } from "@/lib/public-abuse-guard"

const input = {
  stream: "routes" as const,
  phase: "pull" as const,
  organizationId: "org-1",
  agentId: "agent-1",
  userId: "user-1",
  deviceId: "device-1",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(consumePublicRateLimitBatch).mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    unavailable: false,
  })
})

describe("mobile sync v2 shared rate guard", () => {
  it("atomically checks exact device, user and tenant budgets per stream", async () => {
    await expect(consumeMtmMobileSyncV2RateLimit(input)).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
      unavailable: false,
    })

    expect(consumePublicRateLimitBatch).toHaveBeenCalledWith([
      {
        scope: "mtm-mobile-sync-v2:routes:pull:device",
        identifier: "org-1:agent-1:device-1",
        policy: { maxRequests: 60, windowSeconds: 60 },
        identifierMode: "exact",
        redisHashTag: "mtm-mobile-sync-v2:org-1",
      },
      {
        scope: "mtm-mobile-sync-v2:routes:pull:user",
        identifier: "org-1:user-1",
        policy: { maxRequests: 60, windowSeconds: 60 },
        identifierMode: "exact",
        redisHashTag: "mtm-mobile-sync-v2:org-1",
      },
      {
        scope: "mtm-mobile-sync-v2:routes:pull:tenant",
        identifier: "org-1",
        policy: { maxRequests: 180, windowSeconds: 60 },
        identifierMode: "exact",
        redisHashTag: "mtm-mobile-sync-v2:org-1",
      },
    ])
  })

  it("propagates one atomic denial without a sequential fallback", async () => {
    vi.mocked(consumePublicRateLimitBatch).mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 17,
      unavailable: false,
    })

    await expect(consumeMtmMobileSyncV2RateLimit(input)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 17,
      unavailable: false,
    })
    expect(consumePublicRateLimitBatch).toHaveBeenCalledTimes(1)
  })

  it("uses a separate lower initial-snapshot budget without sharing pull keys", async () => {
    await consumeMtmMobileSyncV2RateLimit({ ...input, stream: "workforce", phase: "initial-snapshot" })

    expect(consumePublicRateLimitBatch).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        scope: "mtm-mobile-sync-v2:workforce:initial-snapshot:device",
        policy: { maxRequests: 3, windowSeconds: 60 },
      }),
      expect.objectContaining({
        scope: "mtm-mobile-sync-v2:workforce:initial-snapshot:user",
        policy: { maxRequests: 3, windowSeconds: 60 },
      }),
      expect.objectContaining({
        scope: "mtm-mobile-sync-v2:workforce:initial-snapshot:tenant",
        policy: { maxRequests: 30, windowSeconds: 60 },
      }),
    ]))
  })
})
