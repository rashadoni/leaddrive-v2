import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = {
  connection: {
    id: "cc_org",
    organizationId: "org_1",
    platform: "tiktok",
    surface: "comment",
    provider: "tiktok_organic",
    status: "connected",
    capabilities: { read: true, reply: false, webhook: true, importLead: false },
    settings: { webhookSecret: "organic_secret" },
  },
}

const ingestSpy = vi.fn(async () => ({ id: "mention_1", created: true }))
const { runWithTenant, withTenantFence } = vi.hoisted(() => ({
  runWithTenant: vi.fn((_org: string, fn: () => unknown) => fn()),
  withTenantFence: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConnection: {
      findFirst: vi.fn(async () => state.connection),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  },
}))

vi.mock("@/lib/rls-context", () => ({
  runWithTenant,
  runWithRlsBypass: (fn: () => unknown) => fn(),
}))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: withTenantFence,
}))

vi.mock("@/lib/social/ingest-mention", () => ({
  ingestMentionWithResult: ingestSpy,
}))

function req(body: unknown, token = "organic_secret") {
  return new NextRequest(`http://localhost/api/v1/webhooks/tiktok-organic?token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.connection = {
    id: "cc_org",
    organizationId: "org_1",
    platform: "tiktok",
    surface: "comment",
    provider: "tiktok_organic",
    status: "connected",
    capabilities: { read: true, reply: false, webhook: true, importLead: false },
    settings: { webhookSecret: "organic_secret" },
  }
  ingestSpy.mockResolvedValue({ id: "mention_1", created: true })
  withTenantFence.mockImplementation(async (
    _organizationId: string,
    collect: () => Promise<unknown>,
  ) => ({ allowed: true, value: await collect() }))
})

describe("POST /api/v1/webhooks/tiktok-organic", () => {
  it("creates a TikTok comment SocialMention through the Organic provider boundary", async () => {
    const { POST } = await import("@/app/api/v1/webhooks/tiktok-organic/route")
    const res = await POST(req({
      event: "comment.created",
      data: {
        comment_id: "c_1",
        video_id: "v_1",
        text: "Qiymet nedir?",
        author: { username: "aysel" },
        video_url: "https://www.tiktok.com/@brand/video/1",
        created_at: "2026-06-30T10:00:00Z",
      },
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.ingested).toBe(1)
    expect(ingestSpy).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      platform: "tiktok",
      externalId: "tiktok_organic:comment:c_1",
      sourceType: "comment",
      sourceProvider: "tiktok_organic",
      sourceMetadata: expect.objectContaining({
        platform: "tiktok",
        surface: "comment",
        provider: "tiktok_organic",
        commentId: "c_1",
        videoId: "v_1",
      }),
      text: "Qiymet nedir?",
      authorHandle: "aysel",
      url: "https://www.tiktok.com/@brand/video/1",
    }))
  })

  it("ignores payloads when the Organic connection is missing or webhook disabled", async () => {
    state.connection = { ...state.connection, capabilities: { read: true, reply: false, webhook: false, importLead: false } }
    const { POST } = await import("@/app/api/v1/webhooks/tiktok-organic/route")
    const res = await POST(req({ event: "comment.created", data: { comment_id: "c_1", text: "hi" } }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ignored).toBe("no-connected-tiktok-organic-connection")
    expect(ingestSpy).not.toHaveBeenCalled()
  })

  it("acknowledges provider delivery without ingest when clean-slate collection is blocked", async () => {
    withTenantFence.mockResolvedValueOnce({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })
    const { POST } = await import("@/app/api/v1/webhooks/tiktok-organic/route")

    const res = await POST(req({
      event: "comment.created",
      data: { comment_id: "c_blocked", text: "Do not persist" },
    }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      ignored: "social_monitoring_collection_blocked",
    })
    expect(runWithTenant).toHaveBeenCalledWith("org_1", expect.any(Function))
    expect(ingestSpy).not.toHaveBeenCalled()
  })
})
