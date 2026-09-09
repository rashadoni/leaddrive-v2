import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteContext = { params: Promise<{ id: string }> }
type RouteHandler = (req: NextRequest, auth: AuthContext, ctx: RouteContext) => Promise<Response>

const { requestSocialReplyEnqueue } = vi.hoisted(() => ({
  requestSocialReplyEnqueue: vi.fn(async () => ({
    ok: false as const,
    status: 409 as const,
    code: "outbound_queue_not_available" as const,
    error: "External social replies remain disabled until the audited outbound queue is available.",
  })),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest, ctx: RouteContext) => handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }, ctx),
}))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: async (
    _organizationId: string,
    mutate: () => Promise<unknown>,
  ) => ({ allowed: true, value: await mutate() }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialMention: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/social/outbound-boundary", () => ({ requestSocialReplyEnqueue }))

import { POST } from "@/app/api/v1/social/mentions/[id]/reply/route"
import { logAudit, prisma } from "@/lib/prisma"

const findMention = vi.mocked(prisma.socialMention.findFirst)
const updateMention = vi.mocked(prisma.socialMention.update)
const audit = vi.mocked(logAudit)

function request(body: unknown) {
  return new NextRequest("http://localhost/api/v1/social/mentions/mention-1/reply", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

function ctx(id = "mention-1"): RouteContext {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.stubGlobal("fetch", vi.fn())
})

describe("POST /api/v1/social/mentions/[id]/reply", () => {
  it("rejects unsupported providers without reaching the enqueue boundary", async () => {
    findMention.mockResolvedValue({
      id: "mention-1",
      organizationId: "org-1",
      platform: "tiktok",
      externalId: "cw-comment-1",
      sourceType: "comment",
      sourceProvider: "tiktok_organic",
      sourceMetadata: {},
      text: "Thanks",
      sentiment: "neutral",
      account: null,
    })

    const res = await POST(request({ text: "Thanks" }), ctx())
    const json = await res.json()

    expect(res.status).toBe(501)
    expect(json.error).toContain("not supported")
    expect(requestSocialReplyEnqueue).not.toHaveBeenCalled()
    expect(updateMention).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      "org-1",
      "social_reply_blocked",
      "social_mention",
      "mention-1",
      "tiktok",
      expect.objectContaining({
        newValue: expect.objectContaining({ reason: "unsupported_provider" }),
      }),
    )
  })

  it("funnels an official reply request into the outbox even while live delivery remains gated", async () => {
    findMention.mockResolvedValue({
      id: "mention-1",
      organizationId: "org-1",
      platform: "twitter",
      externalId: "tweet-1",
      sourceType: "mention",
      sourceProvider: "native",
      sourceMetadata: {},
      text: "Safe neutral mention",
      sentiment: "neutral",
      account: { accessToken: "encrypted-token" },
    })

    const res = await POST(request({ text: "Thanks" }), ctx())
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe("outbound_queue_not_available")
    expect(requestSocialReplyEnqueue).toHaveBeenCalled()
    expect(updateMention).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("keeps search-index mentions as open-original/draft-only even with live enabled", async () => {
    findMention.mockResolvedValue({
      id: "mention-1",
      organizationId: "org-1",
      platform: "instagram",
      externalId: "ig-1",
      sourceType: "mention",
      sourceProvider: "search_index",
      sourceMetadata: {},
      text: "Please contact me",
      sentiment: "neutral",
      account: { accessToken: "encrypted-token" },
    })

    const res = await POST(request({ text: "Thanks" }), ctx())
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe("source_requires_human_action")
    expect(json.data.replyPolicy.openOriginalRequired).toBe(true)
    expect(requestSocialReplyEnqueue).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(updateMention).not.toHaveBeenCalled()
  })

  it("funnels a policy-approved request into the disabled outbox boundary without fetching", async () => {
    findMention.mockResolvedValue({
      id: "mention-1",
      organizationId: "org-1",
      platform: "twitter",
      externalId: "tweet-1",
      sourceType: "mention",
      sourceProvider: "native",
      sourceMetadata: {},
      text: "Safe neutral mention",
      sentiment: "neutral",
      account: { accessToken: "encrypted-token" },
    })

    const res = await POST(request({ text: "Thanks", approvedPolicy: true }), ctx())
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe("outbound_queue_not_available")
    expect(requestSocialReplyEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      mentionId: "mention-1",
      requestedBy: "user-1",
      replyText: "Thanks",
      externalId: "tweet-1",
    }))
    expect(fetch).not.toHaveBeenCalled()
    expect(updateMention).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      "org-1",
      "social_reply_blocked",
      "social_mention",
      "mention-1",
      "twitter",
      expect.objectContaining({
        newValue: expect.objectContaining({
          reason: "outbound_queue_not_available",
          boundary: "outbound_social_reply_queue",
        }),
      }),
    )
  })

  it("returns a pending approval item when the durable outbox accepts the request", async () => {
    requestSocialReplyEnqueue.mockResolvedValueOnce({
      ok: true,
      status: 201,
      code: "outbound_pending_approval",
      data: { id: "outbound-1", state: "PENDING" },
    } as never)
    findMention.mockResolvedValue({
      id: "mention-1",
      organizationId: "org-1",
      platform: "instagram",
      externalId: "comment-1",
      sourceType: "comment",
      sourceProvider: "native",
      sourceMetadata: { ownership: "owned" },
      text: "Safe neutral mention",
      sentiment: "neutral",
      account: { accessToken: "encrypted-token" },
    })

    const res = await POST(request({ text: "Thanks", approvedPolicy: true }), ctx())
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json).toMatchObject({ success: true, code: "outbound_pending_approval", data: { id: "outbound-1", state: "PENDING" } })
    expect(audit).toHaveBeenCalledWith("org-1", "social_reply_outbox_created", "social_mention", "mention-1", "instagram", expect.anything())
    expect(fetch).not.toHaveBeenCalled()
  })
})
