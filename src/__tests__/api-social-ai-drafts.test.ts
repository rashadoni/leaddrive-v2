import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext, ctx: { params: Promise<{ id: string }> }) => Promise<Response>

const db = {
  mention: null as Record<string, unknown> | null,
  draft: null as Record<string, unknown> | null,
  channelSetting: null as Record<string, unknown> | null,
}

const { draftSocialReply, publishReply, requestSocialReplyEnqueue } = vi.hoisted(() => ({
  draftSocialReply: vi.fn(async () => ({
    reply: "Təşəkkür edirik, sizinlə əlaqə saxlayacağıq.",
    tone: "grateful",
    reasoning: "Thanks the user and keeps the answer concise.",
    snapshot: { model: "claude-haiku-4-5-20251001", temperature: 0.4, promptVersion: "social-reply-v4-tenant-responder", maskedPromptSha256: "hash", inputTokens: 10, outputTokens: 5 },
  })),
  publishReply: vi.fn(
    async (): Promise<{ ok: boolean; externalReplyId?: string; error?: string; retriable?: boolean }> =>
      ({ ok: true, externalReplyId: "ext-reply-1" }),
  ),
  requestSocialReplyEnqueue: vi.fn(async () => ({
    ok: false as const,
    status: 409 as const,
    code: "outbound_queue_not_available" as const,
    error: "External social replies remain disabled until the audited outbound queue is available.",
  })),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: "org-1", userId: "manager-1", role: "manager" }, ctx),
}))

vi.mock("@/lib/ai/social-reply", () => ({
  draftSocialReply,
}))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: async (
    _organizationId: string,
    collect: () => Promise<unknown>,
  ) => ({ allowed: true, value: await collect() }),
}))

vi.mock("@/lib/social/publishers", () => ({
  getSocialReplyPublisher: (platform: string) =>
    platform === "instagram" || platform === "facebook"
      ? { platform, publishReply }
      : null,
}))

vi.mock("@/lib/social/outbound-boundary", () => ({ requestSocialReplyEnqueue }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(async () => ({ name: "LeadDrive" })),
    },
    socialMention: {
      findFirst: vi.fn(async () => db.mention),
      update: vi.fn(async ({ data }) => {
        db.mention = { ...db.mention, ...data }
        return db.mention
      }),
    },
    socialReplyChannelSetting: {
      findFirst: vi.fn(async () => db.channelSetting),
    },
    aiAgentConfig: {
      findMany: vi.fn(async () => [{
        id: "agent-1",
        configName: "Social AI Agent",
        version: 7,
        systemPrompt: "Use the tenant brand voice.",
        model: "claude-haiku-4-5-20251001",
        temperature: 0.2,
        greeting: "",
        escalationEnabled: true,
        isActive: true,
      }]),
      findFirst: vi.fn(async () => ({
        id: "agent-1",
        version: 7,
        systemPrompt: "Use the tenant brand voice.",
        model: "claude-haiku-4-5-20251001",
        temperature: 0.2,
      })),
    },
    socialMentionSubjectMatch: {
      findFirst: vi.fn(async () => ({
        id: "match-1",
        confidence: 0.98,
        subject: {
          id: "subject-1",
          name: "Baku Electronics",
          assignedAgentId: "agent-1",
          replyPolicy: {},
          replyIdentities: [],
        },
      })),
    },
    monitoringSubject: {
      findFirst: vi.fn(async () => ({ name: "Baku Electronics", assignedAgentId: "agent-1" })),
      findMany: vi.fn(async () => [
        { name: "Baku Electronics" },
        { name: "PharmaStore" },
      ]),
    },
    manualEngagementTask: {
      upsert: vi.fn(async ({ create }) => ({ id: "manual-task-1", ...create })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    socialMentionAiDraft: {
      findMany: vi.fn(async () => (db.draft ? [db.draft] : [])),
      findFirst: vi.fn(async () => db.draft),
      create: vi.fn(async ({ data }) => {
        db.draft = {
          id: "draft-1",
          ...data,
          createdAt: new Date("2026-06-29T09:00:00.000Z"),
          updatedAt: new Date("2026-06-29T09:00:00.000Z"),
        }
        return db.draft
      }),
      update: vi.fn(async ({ data }) => {
        db.draft = { ...db.draft, ...data }
        return db.draft
      }),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}))

import { GET, PATCH, POST } from "@/app/api/v1/social/mentions/[id]/ai-drafts/route"
import { draftSocialReply as draftReplyMock } from "@/lib/ai/social-reply"
import { prisma } from "@/lib/prisma"

const params = { params: Promise.resolve({ id: "mention-1" }) }

function req(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/v1/social/mentions/mention-1/ai-drafts", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function mention(overrides: Record<string, unknown> = {}) {
  return {
    id: "mention-1",
    organizationId: "org-1",
    platform: "tiktok",
    text: "Salam, çox bəyəndim",
    authorName: "Aysel",
    authorHandle: "aysel",
    sentiment: "positive",
    externalId: "cw-1",
    sourceType: "comment",
    contentKind: "COMMENT",
    sourceProvider: "tiktok_organic",
    sourceMetadata: {},
    accountId: null,
    contentVersion: 1,
    url: "https://tiktok.com/comment/1",
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.mention = mention()
  db.draft = null
  db.channelSetting = {
    platform: "tiktok",
    senderAccountId: "official-account",
    senderAccount: {
      id: "official-account",
      handle: "official-brand",
      displayName: "Official Brand",
      isActive: true,
    },
  }
  draftSocialReply.mockResolvedValue({
    reply: "Təşəkkür edirik, sizinlə əlaqə saxlayacağıq.",
    tone: "grateful",
    reasoning: "Thanks the user and keeps the answer concise.",
    snapshot: { model: "claude-haiku-4-5-20251001", temperature: 0.4, promptVersion: "social-reply-v4-tenant-responder", maskedPromptSha256: "hash", inputTokens: 10, outputTokens: 5 },
  })
  publishReply.mockResolvedValue({ ok: true, externalReplyId: "ext-reply-1" })
})

function approvedDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    organizationId: "org-1",
    mentionId: "mention-1",
    subjectId: "subject-1",
    status: "approved",
    sendMode: "dry_run",
    replyText: "Cavab mətni",
    promptSnapshot: {
      version: "social-reply-v4-tenant-responder",
      senderAccountId: "official-account",
    },
    agentSnapshot: { id: "agent-1", version: 7, binding: "SUBJECT" },
    mentionContentVersion: 1,
    approvedBy: "manager-1",
    failureReason: null,
    ...overrides,
  }
}

describe("social mention AI drafts API", () => {
  it("creates a positive TikTok draft for approval without adding it to the risk queue", async () => {
    const res = await POST(req("POST", {}), params)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toMatchObject({
      status: "needs_approval",
      sendMode: "dry_run",
      approvedBy: null,
      engagementMode: "MANUAL_EXTERNAL",
      language: "az",
      replyText: "Təşəkkür edirik, sizinlə əlaqə saxlayacağıq.",
    })
    expect(json.data.sendResult).toMatchObject({
      skippedExternalSend: true,
      requiresApproval: true,
      liveSendAllowed: false,
    })
    expect(draftReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "tiktok" }),
      "Official Brand",
      "az",
      expect.objectContaining({
        id: "agent-1",
        version: 7,
        systemPrompt: "Use the tenant brand voice.",
      }),
      "Baku Electronics",
      ["PharmaStore"],
    )
    expect(prisma.manualEngagementTask.upsert).not.toHaveBeenCalled()
  })

  it("keeps negative drafts in approval until a manager approves and dry-run sends", async () => {
    db.mention = mention({ text: "This was not helpful", sentiment: "negative" })

    const createRes = await POST(req("POST", { regenerateReason: "softer" }), params)
    const createJson = await createRes.json()

    expect(createJson.data).toMatchObject({
      status: "needs_approval",
      regenerateReason: "softer",
      approvedBy: null,
      sentAt: null,
    })

    const approveRes = await PATCH(req("PATCH", { draftId: "draft-1", action: "approve", reason: "ok" }), params)
    const approveJson = await approveRes.json()

    expect(approveRes.status).toBe(200)
    expect(approveJson.data).toMatchObject({
      status: "approved",
      approvedBy: "manager-1",
      reviewReason: "ok",
    })

    const sendRes = await PATCH(req("PATCH", { draftId: "draft-1", action: "send_dry_run" }), params)
    const sendJson = await sendRes.json()

    expect(sendRes.status).toBe(200)
    expect(sendJson.data).toMatchObject({ status: "approved", sentAt: null, sendMode: "dry_run" })
    expect(sendJson.data.sendResult).toMatchObject({ action: "approved_send", skippedExternalSend: true, simulationOnly: true })
    expect(prisma.socialMentionAiDraft.update).toHaveBeenCalledTimes(2)
  })

  it("updates draft text and resets dry-run approval state", async () => {
    db.draft = {
      id: "draft-1",
      organizationId: "org-1",
      mentionId: "mention-1",
      subjectId: "subject-1",
      status: "sent",
      sendMode: "dry_run",
      replyText: "Old reply",
      promptSnapshot: {
        version: "social-reply-v4-tenant-responder",
        senderAccountId: "official-account",
      },
      agentSnapshot: { id: "agent-1", version: 7, binding: "SUBJECT" },
      mentionContentVersion: 1,
      approvedBy: "manager-1",
      approvedAt: new Date("2026-06-29T09:05:00.000Z"),
      sentAt: new Date("2026-06-29T09:06:00.000Z"),
      sendResult: { action: "approved_send", skippedExternalSend: true },
      reviewReason: "ok",
      failureReason: null,
    }

    const res = await PATCH(req("PATCH", {
      draftId: "draft-1",
      action: "update_text",
      replyText: "Updated reply for approval",
    }), params)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toMatchObject({
      replyText: "Updated reply for approval",
      status: "needs_approval",
      approvedBy: null,
      approvedAt: null,
      sentAt: null,
      sendResult: {},
      reviewReason: null,
      failureReason: null,
    })
  })

  it("creates complaint drafts for explicit human approval", async () => {
    db.mention = mention({ text: "Bu rəsmi şikayətdir, cihaz işləmir", sentiment: "negative" })

    const res = await POST(req("POST", {}), params)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toMatchObject({
      status: "needs_approval",
      forbiddenReason: "complaint",
      replyText: "Təşəkkür edirik, sizinlə əlaqə saxlayacağıq.",
      policySnapshot: expect.objectContaining({ humanReviewOnly: true }),
    })
    expect(draftReplyMock).toHaveBeenCalled()
  })

  it("hard-blocks legal topics and skips AI generation", async () => {
    db.mention = mention({ text: "Bu məsələ məhkəmə və vəkil üçündür", sentiment: "negative" })

    const res = await POST(req("POST", {}), params)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toMatchObject({
      status: "blocked",
      forbiddenReason: "legal_or_medical",
      replyText: null,
    })
    expect(draftReplyMock).not.toHaveBeenCalled()
  })

  it("rejects editing a legacy subject-bound draft until it is regenerated", async () => {
    db.draft = approvedDraft({
      status: "needs_approval",
      approvedBy: null,
      promptSnapshot: { version: "social-reply-v3-strict-subject" },
      agentSnapshot: { id: "agent-1", version: 7, binding: "SUBJECT" },
    })

    const res = await PATCH(req("PATCH", {
      draftId: "draft-1",
      action: "update_text",
      replyText: "Updated tenant response.",
    }), params)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json).toMatchObject({
      code: "draft_brand_integrity_failed",
    })
  })

  it("removes the legacy direct send_live action", async () => {
    db.mention = mention({ platform: "instagram" })
    db.draft = approvedDraft()

    const res = await PATCH(req("PATCH", { draftId: "draft-1", action: "send_live" }), params)

    expect(res.status).toBe(400)
    expect(requestSocialReplyEnqueue).not.toHaveBeenCalled()
    expect(publishReply).not.toHaveBeenCalled()
  })

  it("rejects approval when the draft is not bound to the agent assigned to the brand", async () => {
    db.draft = approvedDraft({
      status: "needs_approval",
      approvedBy: null,
      agentSnapshot: { id: "fallback-agent", version: 2, binding: "ORGANIZATION_FALLBACK" },
    })

    const res = await PATCH(req("PATCH", { draftId: "draft-1", action: "approve" }), params)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json).toMatchObject({
      code: "draft_agent_binding_failed",
    })
    expect(prisma.socialMentionAiDraft.update).not.toHaveBeenCalled()
  })

  it("rejects approval when edited text names another monitored brand", async () => {
    db.draft = approvedDraft({
      status: "needs_approval",
      approvedBy: null,
      replyText: "PharmaStore will resolve this for you.",
    })

    const res = await PATCH(req("PATCH", { draftId: "draft-1", action: "approve" }), params)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json).toMatchObject({ code: "draft_foreign_brand_failed" })
    expect(prisma.socialMentionAiDraft.update).not.toHaveBeenCalled()
  })

  it("funnels an approved live request into the fail-closed enqueue boundary", async () => {
    db.mention = mention({ platform: "instagram", externalId: "ig-comment-9", sourceType: "comment" })
    db.draft = approvedDraft()

    const res = await PATCH(req("PATCH", { draftId: "draft-1", action: "enqueue_live" }), params)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe("outbound_queue_not_available")
    expect(requestSocialReplyEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      mentionId: "mention-1",
      draftId: "draft-1",
      externalId: "ig-comment-9",
      replyText: "Cavab mətni",
    }))
    expect(publishReply).not.toHaveBeenCalled()
    expect(prisma.socialMention.update).not.toHaveBeenCalled()
  })

  it("lists drafts only after checking that the mention belongs to the tenant", async () => {
    db.draft = { id: "draft-1", organizationId: "org-1", mentionId: "mention-1" }

    const res = await GET(req("GET"), params)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toEqual([db.draft])
    expect(prisma.socialMention.findFirst).toHaveBeenCalledWith({
      where: { id: "mention-1", organizationId: "org-1" },
      select: { id: true },
    })
  })

  it("does not expose the stored system prompt in draft history", async () => {
    db.draft = {
      id: "draft-1",
      organizationId: "org-1",
      mentionId: "mention-1",
      agentSnapshot: {
        id: "agent-1", name: "Araz agent", version: 7, model: "model-1", binding: "SUBJECT",
        systemPrompt: "internal brand instructions",
      },
    }

    const res = await GET(req("GET"), params)
    const json = await res.json()

    expect(json.data[0].agentSnapshot).toEqual({
      id: "agent-1", name: "Araz agent", version: 7, model: "model-1", binding: "SUBJECT",
    })
    expect(json.data[0].agentSnapshot.systemPrompt).toBeUndefined()
  })
})
