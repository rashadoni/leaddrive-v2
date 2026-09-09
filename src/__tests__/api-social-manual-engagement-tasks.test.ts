import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext) => Promise<Response>

const { findTasks } = vi.hoisted(() => ({
  findTasks: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest) =>
      handler(req, { orgId: "org-1", userId: "manager-1", role: "manager" }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    manualEngagementTask: {
      findMany: findTasks,
    },
    monitoringSubject: {
      findMany: vi.fn(async () => [{ name: "Baku Electronics" }]),
    },
    socialReplyChannelSetting: {
      findMany: vi.fn(async () => [{
        platform: "facebook",
        senderAccountId: "brand-account",
        senderAccount: {
          id: "brand-account",
          handle: "official-brand",
          displayName: "Official Brand",
          isActive: true,
        },
      }]),
    },
  },
}))

import { GET } from "@/app/api/v1/social/manual-engagement-tasks/route"

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    organizationId: "org-1",
    subjectId: "subject-1",
    mentionId: "mention-1",
    draftId: "draft-1",
    status: "OPEN",
    mention: {
      id: "mention-1",
      platform: "facebook",
      text: "I am disappointed",
      sourceType: "comment",
      contentKind: "COMMENT",
      accountId: null,
      sentiment: "negative",
      sourceMetadata: {},
      url: "https://facebook.com/comment/1",
      authorName: "Customer",
      authorHandle: "customer",
      publishedAt: new Date("2026-07-24T10:00:00.000Z"),
      createdAt: new Date("2026-07-24T10:00:00.000Z"),
    },
    subject: {
      id: "subject-1",
      name: "Baku Electronics",
      assignedAgentId: "agent-1",
      replyIdentities: [{ socialAccountId: "brand-account" }],
    },
    draft: {
      id: "draft-1",
      subjectId: "subject-1",
      replyText: "We are sorry. Please contact support.",
      status: "needs_approval",
      engagementMode: "MANUAL_EXTERNAL",
      language: "en",
      tone: "calm",
      reasoning: "Acknowledges the issue without admitting liability.",
      agentSnapshot: {
        id: "agent-1",
        version: 4,
        model: "claude-haiku-4-5-20251001",
        binding: "SUBJECT",
        systemPrompt: "SECRET INTERNAL PROMPT",
      },
      promptSnapshot: {
        version: "social-reply-v4-tenant-responder",
        senderAccountId: "brand-account",
      },
      createdAt: new Date("2026-07-24T10:00:00.000Z"),
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("manual engagement tasks API", () => {
  it("returns harmful comments and media while hiding promotional noise", async () => {
    findTasks.mockResolvedValue([
      task(),
      task({
        id: "task-harmful-video",
        mention: {
          id: "mention-harmful-video",
          platform: "facebook",
          text: "Baku Electronics-dən aldığı iPhone 17 Pro-da donma problemi olduğunu iddia edir.",
          sourceType: "post",
          contentKind: "VIDEO",
          sentiment: "negative",
          sourceMetadata: {},
          url: "https://facebook.com/video/1",
          authorName: "Publisher",
          authorHandle: "publisher",
          publishedAt: new Date("2026-07-24T09:00:00.000Z"),
          createdAt: new Date("2026-07-24T09:00:00.000Z"),
        },
      }),
      task({
        id: "task-promo-video",
        mention: {
          id: "mention-promo-video",
          platform: "tiktok",
          text: "Endirimlər haqqında paylaşımımız üçün təşəkkür edirik! Kampaniyalar barədə məlumat üçün DM yaza bilərsiniz.",
          sourceType: "post",
          contentKind: "VIDEO",
          sentiment: "negative",
          sourceMetadata: {},
          url: "https://tiktok.com/video/1",
          authorName: "Publisher",
          authorHandle: "publisher",
          publishedAt: new Date("2026-07-24T09:00:00.000Z"),
          createdAt: new Date("2026-07-24T09:00:00.000Z"),
        },
      }),
      task({
        id: "task-promo-hurry-video",
        mention: {
          id: "mention-promo-hurry-video",
          platform: "tiktok",
          text: "Təklifləri dəyərləndirmək üçün tələs! Gecikmə, mobil tətbiq və bakuelectronics.az saytında endirimlərdən yararlan.",
          sourceType: "post",
          contentKind: "VIDEO",
          sentiment: "neutral",
          sourceMetadata: {},
          url: "https://tiktok.com/video/2",
          authorName: "Baku Electronics",
          authorHandle: "bakuelectronics",
          publishedAt: new Date("2026-07-24T09:00:00.000Z"),
          createdAt: new Date("2026-07-24T09:00:00.000Z"),
        },
      }),
      task({
        id: "task-positive",
        mention: {
          id: "mention-positive",
          platform: "instagram",
          text: "Thank you, great service",
          sourceType: "comment",
          contentKind: "COMMENT",
          sentiment: "positive",
          sourceMetadata: {},
          url: "https://instagram.com/comment/1",
          authorName: "Happy customer",
          authorHandle: "happy",
          publishedAt: new Date("2026-07-24T08:00:00.000Z"),
          createdAt: new Date("2026-07-24T08:00:00.000Z"),
        },
      }),
      task({
        id: "task-owned",
        mention: {
          id: "mention-owned",
          platform: "facebook",
          text: "We have received a complaint.",
          sourceType: "post",
          contentKind: "POST",
          accountId: "brand-account",
          sentiment: "negative",
          sourceMetadata: { ownership: "owned" },
          url: "https://facebook.com/brand/post/1",
          authorName: "Baku Electronics",
          authorHandle: "baku-electronics",
          publishedAt: new Date("2026-07-24T07:00:00.000Z"),
          createdAt: new Date("2026-07-24T07:00:00.000Z"),
        },
      }),
    ])

    const response = await GET(new NextRequest(
      "http://localhost/api/v1/social/manual-engagement-tasks?status=OPEN",
    ))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data).toHaveLength(2)
    expect(json.data[0]).toMatchObject({
      id: "task-1",
      risk: {
        eligible: true,
        reasons: ["negative_sentiment"],
      },
      integrity: { safe: true },
      officialResponder: {
        accountId: "brand-account",
        name: "Official Brand",
      },
      subject: {
        assignedAgentId: "agent-1",
      },
      draft: {
        language: "en",
        tone: "calm",
        agent: {
          id: "agent-1",
          version: 4,
          model: "claude-haiku-4-5-20251001",
          binding: "SUBJECT",
        },
      },
    })
    expect(json.data[0].draft.agentSnapshot).toBeUndefined()
    expect(JSON.stringify(json.data[0])).not.toContain("SECRET INTERNAL PROMPT")
    expect(json.data[1]).toMatchObject({
      id: "task-harmful-video",
      risk: {
        eligible: true,
        reasons: ["negative_sentiment", "brand_harm_text"],
      },
    })
  })

  it("validates drafts against the subject's current agent or the safe default", async () => {
    const base = task()
    findTasks.mockResolvedValue([
      base,
      task({
        id: "task-safe-default",
        subject: {
          id: "subject-1",
          name: "Baku Electronics",
          assignedAgentId: null,
        },
        draft: {
          ...base.draft,
          id: "draft-safe-default",
          agentSnapshot: {
            binding: "SAFE_DEFAULT",
            version: "social-reply-v4-tenant-responder",
          },
        },
      }),
      task({
        id: "task-stale-agent",
        subject: {
          id: "subject-1",
          name: "Baku Electronics",
          assignedAgentId: "agent-2",
        },
      }),
      task({
        id: "task-legacy-organization",
        subject: {
          id: "subject-1",
          name: "Baku Electronics",
          assignedAgentId: null,
        },
        draft: {
          ...base.draft,
          id: "draft-legacy-organization",
          agentSnapshot: {
            id: "agent-from-another-brand",
            binding: "ORGANIZATION",
            version: 4,
          },
        },
      }),
    ])

    const response = await GET(new NextRequest(
      "http://localhost/api/v1/social/manual-engagement-tasks?status=OPEN",
    ))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data).toHaveLength(4)
    expect(json.data.map((entry: { id: string; integrity: { safe: boolean; reasons: string[] } }) => ({
      id: entry.id,
      safe: entry.integrity.safe,
      reasons: entry.integrity.reasons,
    }))).toEqual([
      { id: "task-1", safe: true, reasons: [] },
      { id: "task-safe-default", safe: true, reasons: [] },
      { id: "task-stale-agent", safe: false, reasons: ["subject_agent_mismatch"] },
      { id: "task-legacy-organization", safe: false, reasons: ["subject_agent_mismatch"] },
    ])
  })
})
