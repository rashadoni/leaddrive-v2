import { beforeEach, describe, expect, it, vi } from "vitest"
import crypto from "crypto"
import type { NextRequest } from "next/server"

/**
 * Meta webhook comments must land with the pollers' "c:" externalId prefix and
 * sourceType="comment" via ingestMention — previously they were raw-upserted
 * with no prefix and sourceType left "unknown", so the same comment could exist
 * twice (webhook row + poller row) and never matched monitoring scenarios.
 */

const { ingestMentionWithResult, parentMatchContextsForComments, runWithTenant, withTenantFence } = vi.hoisted(() => ({
  ingestMentionWithResult: vi.fn(async () => ({ id: "mention-1", created: true })),
  parentMatchContextsForComments: vi.fn(),
  runWithTenant: vi.fn((_org: string, fn: () => unknown) => fn()),
  withTenantFence: vi.fn(),
}))
// Full factory (no importOriginal): the real module pulls workflow-engine → next-auth,
// which does not resolve under vitest.
vi.mock("@/lib/social/ingest-mention", () => ({
  ingestMentionWithResult,
  findMatchedKeyword: (text: string, terms: string[]) => terms.find(term => text.toLowerCase().includes(term.toLowerCase())) ?? null,
}))

vi.mock("@/lib/sentiment", () => ({ classifySentiment: vi.fn(async () => "neutral") }))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant,
  runWithRlsBypass: vi.fn((fn: () => unknown) => fn()),
}))
vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: withTenantFence,
}))
vi.mock("@/lib/social/parent-match-context", () => ({
  parentMatchContextsForComments,
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialAccount: { findFirst: vi.fn() },
    monitoringSource: { findMany: vi.fn(async () => []) },
    sourceRoutePlan: { findMany: vi.fn(async () => []) },
    mentionEvidence: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { POST } from "@/app/api/v1/webhooks/meta-social/route"

const findAccount = vi.mocked(prisma.socialAccount.findFirst)

const SECRET = "meta-secret"

function signedRequest(body: unknown): NextRequest {
  const raw = JSON.stringify(body)
  const signature = "sha256=" + crypto.createHmac("sha256", SECRET).update(raw).digest("hex")
  return {
    text: async () => raw,
    headers: { get: (h: string) => (h === "x-hub-signature-256" ? signature : null) },
  } as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.META_WEBHOOK_SECRET = SECRET
  findAccount.mockResolvedValue({ id: "acc-1", organizationId: "org-1", platform: "facebook", handle: "page-1", keywords: ["buy"] } as never)
  parentMatchContextsForComments.mockResolvedValue(new Map())
  withTenantFence.mockImplementation(async (
    _organizationId: string,
    collect: () => Promise<unknown>,
  ) => ({ allowed: true, value: await collect() }))
})

describe("meta-social webhook comment ingestion", () => {
  it("ingests a comment with the c: prefix, sourceType=comment, native provider and matched keyword", async () => {
    const res = await POST(signedRequest({
      object: "page",
      entry: [{
        id: "page-1",
        changes: [{ value: { item: "comment", comment_id: "555_777", message: "Where can I buy this?", from: { name: "Buyer", id: "u9" }, created_time: "2026-07-01T10:00:00Z" } }],
      }],
    }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, ingested: 1 })
    expect(ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      platform: "facebook",
      externalId: "c:555_777",
      sourceType: "comment",
      // "native": a comment on a connected OWN page — same provider the poller writes,
      // so redeliveries don't churn the row between webhook/native classifications.
      sourceProvider: "native",
      matchedTerm: "buy",
      text: "Where can I buy this?",
    }))
  })

  it("parses FB feed epoch-seconds created_time (not as milliseconds → Jan 1970)", async () => {
    await POST(signedRequest({
      object: "page",
      entry: [{
        id: "page-1",
        changes: [{ value: { item: "comment", comment_id: "9", message: "epoch time comment", created_time: 1782209400 } }],
      }],
    }))

    const calls = (ingestMentionWithResult as unknown as { mock: { calls: Array<[{ publishedAt: Date }]> } }).mock.calls
    expect(calls[0][0].publishedAt.getUTCFullYear()).toBeGreaterThanOrEqual(2026)
  })

  it("resolves a negative parent by post ID when the webhook omits its permalink", async () => {
    const parentPostUrl = "https://facebook.com/page-1/posts/123"
    const postExternalId = "page-1_123"
    const storedContext = {
      parentMentionId: "negative-parent",
      matchedTerm: "buy",
      subjectIds: ["subject-1"],
      parentSentiment: "negative",
      inheritAllCommentSubjectIds: ["subject-1"],
    }
    parentMatchContextsForComments.mockResolvedValue(new Map([[postExternalId, storedContext]]))

    await POST(signedRequest({
      object: "page",
      entry: [{
        id: "page-1",
        changes: [{ value: {
          item: "comment",
          comment_id: "negative-parent-comment",
          message: "No keyword in this comment",
          post_id: postExternalId,
          permalink_url: `${parentPostUrl}?comment_id=negative-parent-comment`,
          parentMatchContext: { inheritAllCommentSubjectIds: ["forged-subject"] },
        } }],
      }],
    }))

    expect(parentMatchContextsForComments).toHaveBeenCalledWith("org-1", "facebook", [], [postExternalId])
    expect(ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      postExternalId,
      parentPostUrl: null,
      parentMatchContext: storedContext,
    }))
    expect(ingestMentionWithResult).not.toHaveBeenCalledWith(expect.objectContaining({
      parentMatchContext: expect.objectContaining({ inheritAllCommentSubjectIds: ["forged-subject"] }),
    }))
  })

  it("rejects an unsigned payload", async () => {
    const res = await POST({
      text: async () => "{}",
      headers: { get: () => null },
    } as unknown as NextRequest)
    expect(res.status).toBe(401)
    expect(ingestMentionWithResult).not.toHaveBeenCalled()
  })

  it("acknowledges but does not ingest a signed event when clean-slate collection is blocked", async () => {
    withTenantFence.mockResolvedValueOnce({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })

    const res = await POST(signedRequest({
      object: "page",
      entry: [{
        id: "page-1",
        changes: [{ value: { item: "comment", comment_id: "blocked", message: "Do not persist" } }],
      }],
    }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, ingested: 0, blocked: 1 })
    expect(runWithTenant).toHaveBeenCalledWith("org-1", expect.any(Function))
    expect(withTenantFence).toHaveBeenCalledWith("org-1", expect.any(Function))
    expect(ingestMentionWithResult).not.toHaveBeenCalled()
  })
})
