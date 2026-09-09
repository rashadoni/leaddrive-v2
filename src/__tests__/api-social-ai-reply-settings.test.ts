import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext) => Promise<Response>

const db = {
  channelSettings: [] as Record<string, unknown>[],
  accounts: [] as Record<string, unknown>[],
  outboundPolicy: {
    id: "policy-1",
    organizationId: "org-1",
    liveEnabled: false,
    emergencyStopped: true,
    allowedPlatforms: [] as string[],
    maxPerHour: 10,
    quietHoursStart: null,
    quietHoursEnd: null,
    timeZone: "UTC",
    requireSeparateApprover: true,
    policyVersion: 1,
    releaseReviewedAt: null as Date | null,
  },
}

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(),
    },
    socialReplyChannelSetting: {
      findMany: vi.fn(async () => db.channelSettings),
      findFirst: vi.fn(async () => db.channelSettings[0] ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "setting-1", ...data })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...db.channelSettings[0], ...data })),
    },
    socialAccount: {
      findMany: vi.fn(async () => db.accounts),
      findFirst: vi.fn(async ({ where }: { where: { id?: string; platform?: string } }) =>
        db.accounts.find(a => a.id === where.id && a.platform === where.platform) ?? null),
      update: vi.fn(),
    },
    socialOutboundPolicy: { upsert: vi.fn(async () => db.outboundPolicy) },
    socialProviderCapabilityProof: { findFirst: vi.fn() },
  },
}))

import { GET, PUT } from "@/app/api/v1/social/ai-reply-settings/route"
import { prisma } from "@/lib/prisma"

const findOrg = vi.mocked(prisma.organization.findUnique)

function request() {
  return new NextRequest("http://localhost/api/v1/social/ai-reply-settings")
}

function putRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v1/social/ai-reply-settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  db.channelSettings = []
  db.accounts = []
  db.outboundPolicy = {
    ...db.outboundPolicy,
    liveEnabled: false,
    emergencyStopped: true,
    allowedPlatforms: [],
    releaseReviewedAt: null,
  }
})

describe("social AI reply settings API", () => {
  it("reports positive auto dry-run mode when the social reply live flag is enabled", async () => {
    findOrg.mockResolvedValue({ features: ["ai_auto_social_reply"] })

    const res = await GET(request())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toMatchObject({
      mode: "drafts_need_approval",
      positiveAutoReplyEnabled: false,
      negativeApprovalRequired: true,
      sendMode: "dry_run",
      liveExternalSendEnabled: false,
      requiresLiveConfirmation: true,
      features: { live: true, shadow: false },
    })
    expect(json.data.channels).toHaveLength(6)
    expect(json.data.channels.every((c: { liveReady: boolean }) => !c.liveReady)).toBe(true)
  })

  it("reports drafts-only mode when only the shadow flag is enabled", async () => {
    findOrg.mockResolvedValue({ features: ["ai_auto_social_reply_shadow"] })

    const res = await GET(request())
    const json = await res.json()

    expect(json.data).toMatchObject({
      mode: "drafts_need_approval",
      positiveAutoReplyEnabled: false,
      features: { live: false, shadow: true },
    })
  })

  it("reports off mode when social reply flags are absent", async () => {
    findOrg.mockResolvedValue({ features: ["ai_auto_social_viral_shadow"] })

    const res = await GET(request())
    const json = await res.json()

    expect(json.data).toMatchObject({
      mode: "off",
      positiveAutoReplyEnabled: false,
      features: { live: false, shadow: false },
    })
  })

  it("defaults brandProtectionOnly to false and surfaces it when the flag is set", async () => {
    findOrg.mockResolvedValue({ features: [] })
    expect((await (await GET(request())).json()).data.brandProtectionOnly).toBe(false)

    findOrg.mockResolvedValue({ features: ["social_brand_protection_only"] })
    expect((await (await GET(request())).json()).data.brandProtectionOnly).toBe(true)
  })

  it("marks a platform live-ready when live send is on and the sender account is connected", async () => {
    vi.stubEnv("SOCIAL_OUTBOUND_LIVE_ENABLED", "1")
    findOrg.mockResolvedValue({ features: [] })
    db.outboundPolicy = {
      ...db.outboundPolicy,
      liveEnabled: true,
      emergencyStopped: false,
      allowedPlatforms: ["instagram"],
      releaseReviewedAt: new Date("2026-07-12T00:00:00Z"),
    }
    db.channelSettings = [{
      platform: "instagram",
      sendMode: "approval",
      liveEnabled: true,
      senderAccountId: "acc-1",
      senderAccount: {
        id: "acc-1", handle: "1789", displayName: "LeadDrive", accessToken: "v1:enc", isActive: true,
        outboundLiveEnabled: true, outboundEmergencyStopped: false, outboundCapability: "DIRECT",
        outboundVerifiedAt: new Date("2026-07-12T00:00:00Z"),
      },
    }]

    const res = await GET(request())
    const json = await res.json()

    const ig = json.data.channels.find((c: { platform: string }) => c.platform === "instagram")
    expect(ig).toMatchObject({ liveReady: true, liveSupported: true, liveEnabled: true })
    expect(json.data.liveExternalSendEnabled).toBe(true)
    expect(json.data.sendMode).toBe("per_channel")
  })

  it("reports every live gate as disabled in Brand Protection mode even when stale settings are enabled", async () => {
    vi.stubEnv("SOCIAL_OUTBOUND_LIVE_ENABLED", "1")
    findOrg.mockResolvedValue({ features: ["social_brand_protection_only"] })
    db.outboundPolicy = {
      ...db.outboundPolicy,
      liveEnabled: true,
      emergencyStopped: false,
      allowedPlatforms: ["instagram"],
      releaseReviewedAt: new Date("2026-07-12T00:00:00Z"),
    }
    db.channelSettings = [{
      platform: "instagram",
      sendMode: "approval",
      liveEnabled: true,
      senderAccountId: "acc-1",
      senderAccount: {
        id: "acc-1", handle: "1789", displayName: "LeadDrive", accessToken: "v1:enc", isActive: true,
        outboundLiveEnabled: true, outboundEmergencyStopped: false, outboundCapability: "DIRECT",
        outboundVerifiedAt: new Date("2026-07-12T00:00:00Z"),
      },
    }]

    const json = await (await GET(request())).json()

    expect(json.data).toMatchObject({
      brandProtectionOnly: true,
      liveExternalSendEnabled: false,
      sendMode: "dry_run",
      outboundPolicy: {
        liveEnabled: false,
        emergencyStopped: true,
        globalLiveEnabled: false,
        globalKillSwitch: true,
      },
    })
    expect(json.data.channels.every((channel: { liveReady: boolean }) => !channel.liveReady)).toBe(true)
    expect(json.data.channels.find((channel: { platform: string }) => channel.platform === "instagram"))
      .toMatchObject({ sendMode: "dry_run", liveEnabled: false, liveReady: false })
  })

  it("rejects attempts to enable live delivery settings in Brand Protection mode", async () => {
    findOrg.mockResolvedValue({ features: ["social_brand_protection_only"] })

    const res = await PUT(putRequest({ platform: "instagram", liveEnabled: true }))
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe("brand_protection_only")
    expect(prisma.socialReplyChannelSetting.create).not.toHaveBeenCalled()
    expect(prisma.socialReplyChannelSetting.update).not.toHaveBeenCalled()
  })

  it("refuses to enable live send without a connected sender account", async () => {
    db.channelSettings = []
    const res = await PUT(putRequest({ platform: "instagram", liveEnabled: true }))

    expect(res.status).toBe(409)
  })

  it("upserts per-platform sender account and send mode", async () => {
    db.accounts = [{ id: "acc-1", platform: "facebook", handle: "page-1", displayName: "Page", accessToken: "v1:enc", isActive: true }]
    db.channelSettings = []

    const res = await PUT(putRequest({ platform: "facebook", senderAccountId: "acc-1", sendMode: "approval" }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toMatchObject({
      organizationId: "org-1",
      platform: "facebook",
      senderAccountId: "acc-1",
      sendMode: "approval",
      updatedBy: "user-1",
    })
  })
})
