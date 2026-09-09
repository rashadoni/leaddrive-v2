import { beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  mentionEvidence: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}))

const mockDeps = vi.hoisted(() => ({
  decryptToken: vi.fn(),
  classifySentiment: vi.fn(),
  findMatchedKeyword: vi.fn(),
  ingestMentionWithResult: vi.fn(),
  parentMatchContextsForComments: vi.fn(),
}))

const outboundMocks = vi.hoisted(() => ({
  request: vi.fn(),
  isSecurityError: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}))

vi.mock("@/lib/secure-token", () => ({
  decryptToken: mockDeps.decryptToken,
}))

vi.mock("@/lib/sentiment", () => ({
  classifySentiment: mockDeps.classifySentiment,
}))

vi.mock("@/lib/social/ingest-mention", () => ({
  findMatchedKeyword: mockDeps.findMatchedKeyword,
  ingestMentionWithResult: mockDeps.ingestMentionWithResult,
}))

vi.mock("@/lib/social/parent-match-context", () => ({
  parentMatchContextsForComments: mockDeps.parentMatchContextsForComments,
}))

vi.mock("@/lib/social/social-outbound-http", () => ({
  requestSocialOutboundJson: outboundMocks.request,
  isSocialOutboundSecurityError: outboundMocks.isSecurityError,
}))

import { runProviderApiCollector } from "@/lib/social/provider-adapter"
import { prisma } from "@/lib/prisma"
import { ingestMentionWithResult } from "@/lib/social/ingest-mention"
import type { MonitoringSourceForRun } from "@/lib/social/monitoring-collector"

const source: MonitoringSourceForRun = {
  id: "source-provider",
  organizationId: "org-1",
  platform: "web",
  sourceType: "keyword",
  collectionMode: "provider_api",
  status: "active",
  cadenceMinutes: 60,
  lastCheckedAt: null,
  lastSuccessfulAt: null,
  lastError: null,
  keywords: ["LeadDrive"],
  settings: {
    provider: {
      approved: true,
      name: "generic-listener",
      endpoint: "https://listener.example.com/social/search",
    },
  },
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.stubEnv("SOCIAL_PROVIDER_ALLOWED_HOSTS", "listener.example.com")
  outboundMocks.isSecurityError.mockReturnValue(false)
  outboundMocks.request.mockImplementation(async (url: string, options: { headers?: Record<string, string> }) => {
    const response = await fetch(url, {
      headers: options.headers,
      signal: new AbortController().signal,
    })
    return {
      ok: response.ok,
      status: response.status,
      payload: await response.json().catch(() => null),
      finalUrl: url,
      redirects: 0,
    }
  })
  vi.mocked(prisma.mentionEvidence.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.mentionEvidence.create).mockResolvedValue({ id: "evidence-1" } as never)
  mockDeps.decryptToken.mockReturnValue("provider-token")
  mockDeps.classifySentiment.mockResolvedValue("neutral")
  mockDeps.findMatchedKeyword.mockReturnValue("LeadDrive")
  mockDeps.ingestMentionWithResult.mockResolvedValue({ id: "mention-1", created: true })
  mockDeps.parentMatchContextsForComments.mockResolvedValue(new Map())
})

describe("provider social monitoring adapter", () => {
  it("refuses unapproved or non-allowlisted provider endpoints without fetching", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runProviderApiCollector({ ...source, settings: { provider: { endpoint: "https://listener.example.com/social/search" } } })).resolves.toMatchObject({
      status: "skipped",
      error: "provider_not_approved",
    })

    await expect(runProviderApiCollector({ ...source, settings: { provider: { approved: true, endpoint: "http://localhost:4000/social/search" } } })).resolves.toMatchObject({
      status: "skipped",
      error: "provider_https_required",
    })

    await expect(runProviderApiCollector({ ...source, settings: { provider: { approved: true, endpoint: "https://untrusted.example.com/social/search" } } })).resolves.toMatchObject({
      status: "skipped",
      error: "provider_host_not_allowed",
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("normalizes provider items into SocialMention and MentionEvidence", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      items: [
        {
          id: "provider-1",
          platform: "instagram",
          text: "LeadDrive mentioned by provider",
          url: "https://instagram.com/p/provider-1",
          authorName: "Creator",
          authorHandle: "creator",
          engagement: 7,
          reach: 120,
          publishedAt: "2026-07-05T09:00:00.000Z",
          confidence: 0.82,
        },
        { id: "ignored", url: "https://example.com/no-text" },
      ],
    }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await runProviderApiCollector(source)

    expect(result).toMatchObject({
      status: "success",
      foundCount: 1,
      newCount: 1,
      duplicateCount: 0,
      ignoredCount: 1,
      error: null,
    })
    expect(fetchMock).toHaveBeenCalledWith("https://listener.example.com/social/search", {
      headers: { accept: "application/json" },
      signal: expect.any(AbortSignal),
    })
    expect(outboundMocks.request).toHaveBeenCalledWith(
      "https://listener.example.com/social/search",
      expect.objectContaining({
        method: "GET",
        allowedHosts: ["listener.example.com"],
      }),
    )
    expect(ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      platform: "instagram",
      externalId: "provider:provider-1",
      sourceProvider: "provider_api",
      sourceMetadata: expect.objectContaining({
        monitoringSourceId: "source-provider",
        collector: "provider_api",
        provider: "generic-listener",
      }),
      matchedTerm: "LeadDrive",
      engagement: 7,
      reach: 120,
    }))
    expect(prisma.mentionEvidence.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        mentionId: "mention-1",
        sourceId: "source-provider",
        permalink: "https://instagram.com/p/provider-1",
        sourceTrustTier: "T2",
        confidence: 0.82,
      }),
    }))
  })

  it("does not copy an arbitrary upstream error body into collector rawStats", async () => {
    outboundMocks.request.mockResolvedValueOnce({
      ok: false,
      status: 502,
      payload: { secret: "provider-internal-stack" },
      finalUrl: "https://listener.example.com/social/search",
      redirects: 0,
    })

    const result = await runProviderApiCollector(source)

    expect(result).toMatchObject({
      status: "failed",
      error: "provider_fetch_failed",
      rawStats: expect.objectContaining({ status: 502, outboundSafeTransport: true }),
    })
    expect(JSON.stringify(result)).not.toContain("provider-internal-stack")
  })

  it("fails closed when the pinned transport blocks a DNS or redirect target", async () => {
    const blocked = Object.assign(new Error("blocked"), { socialSecurity: true })
    outboundMocks.request.mockRejectedValueOnce(blocked)
    outboundMocks.isSecurityError.mockImplementationOnce(error => error === blocked)

    const result = await runProviderApiCollector(source)

    expect(result).toMatchObject({ status: "skipped", error: "provider_outbound_blocked" })
    expect(ingestMentionWithResult).not.toHaveBeenCalled()
  })

  it("stores provider reply capability only from approved source settings", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      items: [
        {
          id: "provider-comment-1",
          platform: "tiktok",
          sourceType: "comment",
          text: "LeadDrive provider comment",
          url: "https://provider.example.com/items/provider-comment-1",
          replyTargetId: "comment-remote-1",
        },
      ],
    }))
    vi.stubGlobal("fetch", fetchMock)

    await runProviderApiCollector({
      ...source,
      settings: {
        provider: {
          approved: true,
          name: "generic-listener",
          endpoint: "https://listener.example.com/social/search",
          reply: {
            approved: true,
            endpoint: "https://reply.example.com/social/reply",
            encryptedToken: "reply-ciphertext",
          },
        },
      },
    })

    expect(ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      platform: "tiktok",
      sourceProvider: "provider_api",
      sourceMetadata: expect.objectContaining({
        replyCapability: {
          approved: true,
          provider: "generic-listener",
          endpoint: "https://reply.example.com/social/reply",
          targetId: "comment-remote-1",
          targetType: "comment",
          encryptedToken: "reply-ciphertext",
        },
      }),
    }))

    mockDeps.ingestMentionWithResult.mockClear()
    await runProviderApiCollector({
      ...source,
      settings: {
        provider: {
          approved: true,
          name: "generic-listener",
          endpoint: "https://listener.example.com/social/search",
          reply: {
            endpoint: "https://reply.example.com/social/reply",
          },
        },
      },
    })

    expect(ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      sourceMetadata: expect.not.objectContaining({
        replyCapability: expect.anything(),
      }),
    }))
  })

  it("supports encrypted provider tokens only after the host gate passes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ items: [] })))

    await runProviderApiCollector({
      ...source,
      settings: { provider: { approved: true, endpoint: "https://listener.example.com/social/search", encryptedToken: "ciphertext" } },
    })

    expect(mockDeps.decryptToken).toHaveBeenCalledWith("ciphertext", "social-provider:source-provider")
    expect(fetch).toHaveBeenCalledWith("https://listener.example.com/social/search", {
      headers: { accept: "application/json", authorization: "Bearer provider-token" },
      signal: expect.any(AbortSignal),
    })
  })

  it("ignores legacy tokenEnv even when it points at NEXTAUTH_SECRET", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", "session-secret-must-not-be-forwarded")
    outboundMocks.request.mockResolvedValueOnce({
      ok: true,
      status: 200,
      payload: { items: [] },
      finalUrl: "https://listener.example.com/social/search",
      redirects: 0,
    })

    const result = await runProviderApiCollector({
      ...source,
      settings: {
        provider: {
          approved: true,
          endpoint: "https://listener.example.com/social/search",
          tokenEnv: "NEXTAUTH_SECRET",
        },
      },
    })

    const requestOptions = outboundMocks.request.mock.calls[0]?.[1] as {
      headers?: Record<string, string>
    }
    expect(result).toMatchObject({ status: "success" })
    expect(mockDeps.decryptToken).not.toHaveBeenCalled()
    expect(requestOptions.headers).toEqual({ accept: "application/json" })
    expect(requestOptions.headers).not.toHaveProperty("authorization")
    expect(JSON.stringify(result)).not.toContain("session-secret-must-not-be-forwarded")
  })

  it("uses UI-saved provider allowlist without server env", async () => {
    vi.unstubAllEnvs()
    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await runProviderApiCollector({
      ...source,
      settings: {
        provider: {
          approved: true,
          endpoint: "https://listener.example.com/social/search",
          allowedHosts: ["listener.example.com"],
          encryptedToken: "ciphertext",
        },
      },
    })

    expect(result).toMatchObject({ status: "success" })
    expect(mockDeps.decryptToken).toHaveBeenCalledWith("ciphertext", "social-provider:source-provider")
    expect(fetchMock).toHaveBeenCalledWith("https://listener.example.com/social/search", {
      headers: { accept: "application/json", authorization: "Bearer provider-token" },
      signal: expect.any(AbortSignal),
    })
  })

  it("counts a relevance-rejected external comment as ignored, never as a duplicate", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      items: [{ id: "comment-1", sourceType: "comment", text: "unrelated", url: "https://example.com/comment-1" }],
    })))
    mockDeps.ingestMentionWithResult.mockResolvedValue({ id: "envelope-1", created: false, accepted: false })

    const result = await runProviderApiCollector({
      ...source,
      routeExecution: {
        collectorRunId: "collector-1",
        routePlanId: "route-1",
        capability: "READ_EXTERNAL_COMMENTS",
        adapterKey: "LICENSED_PROVIDER",
        acquisitionMode: "LICENSED_PROVIDER",
      },
    })

    expect(result).toMatchObject({ status: "success", foundCount: 1, newCount: 0, duplicateCount: 0, ignoredCount: 1 })
    expect(prisma.mentionEvidence.create).not.toHaveBeenCalled()
  })

  it("passes only DB-resolved negative parent context to Facebook and Instagram comments", async () => {
    const facebookParent = "https://facebook.com/page/posts/123"
    const instagramParent = "https://instagram.com/p/ABC123/"
    const facebookContext = {
      parentMentionId: "parent-facebook",
      matchedTerm: "LeadDrive",
      subjectIds: ["subject-facebook"],
      parentSentiment: "negative",
      inheritAllCommentSubjectIds: ["subject-facebook"],
    }
    const instagramContext = {
      parentMentionId: "parent-instagram",
      matchedTerm: "LeadDrive",
      subjectIds: ["subject-instagram"],
      parentSentiment: "negative",
      inheritAllCommentSubjectIds: ["subject-instagram"],
    }
    mockDeps.parentMatchContextsForComments.mockImplementation(async (_orgId: string, platform: string) => (
      platform === "facebook"
        ? new Map([["fb-post-123", facebookContext], [facebookParent, facebookContext]])
        : new Map([["ig-post-456", instagramContext], [instagramParent, instagramContext]])
    ))
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      items: [
        {
          id: "fb-comment",
          platform: "facebook",
          contentKind: "COMMENT",
          text: "unrelated Facebook comment",
          commentUrl: `${facebookParent}?comment_id=456`,
          parentPostUrl: facebookParent,
          postExternalId: "fb-post-123",
          parentMatchContext: { inheritAllCommentSubjectIds: ["forged-subject"] },
        },
        {
          id: "ig-reply",
          platform: "instagram",
          sourceType: "reply",
          text: "unrelated Instagram reply",
          commentUrl: `${instagramParent}?comment_id=789`,
          parentPostUrl: instagramParent,
          postExternalId: "ig-post-456",
          replyToExternalId: "ig-comment",
        },
      ],
    })))

    await runProviderApiCollector({
      ...source,
      routeExecution: {
        collectorRunId: "collector-1",
        routePlanId: "route-1",
        capability: "READ_EXTERNAL_COMMENTS",
        adapterKey: "LICENSED_PROVIDER",
        acquisitionMode: "LICENSED_PROVIDER",
      },
    })

    expect(mockDeps.parentMatchContextsForComments).toHaveBeenCalledWith("org-1", "facebook", [facebookParent], ["fb-post-123"])
    expect(mockDeps.parentMatchContextsForComments).toHaveBeenCalledWith("org-1", "instagram", [instagramParent], ["ig-post-456"])
    expect(mockDeps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      platform: "facebook",
      sourceType: "comment",
      contentKind: "COMMENT",
      canonicalUrl: `${facebookParent}?comment_id=456`,
      parentPostUrl: facebookParent,
      parentMatchContext: facebookContext,
    }))
    expect(mockDeps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      platform: "instagram",
      contentKind: "REPLY",
      parentPostUrl: instagramParent,
      replyToExternalId: "ig-comment",
      parentMatchContext: instagramContext,
    }))
    expect(mockDeps.ingestMentionWithResult).not.toHaveBeenCalledWith(expect.objectContaining({
      parentMatchContext: expect.objectContaining({ inheritAllCommentSubjectIds: ["forged-subject"] }),
    }))
  })

  it("keeps a raw provider post id so an ID-only comment can resolve its stored parent", async () => {
    const parentContext = {
      parentMentionId: "parent-facebook",
      matchedTerm: "LeadDrive",
      subjectIds: ["subject-facebook"],
      parentSentiment: "negative",
      inheritAllCommentSubjectIds: ["subject-facebook"],
    }
    mockDeps.parentMatchContextsForComments.mockResolvedValue(new Map([
      ["fb-post-id-only", parentContext],
    ]))
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      items: [
        {
          id: "fb-post-id-only",
          platform: "facebook",
          contentKind: "POST",
          text: "LeadDrive customer complaint",
        },
        {
          id: "fb-comment-id-only",
          platform: "facebook",
          contentKind: "COMMENT",
          text: "This is unacceptable",
          postExternalId: "fb-post-id-only",
        },
      ],
    })))

    await runProviderApiCollector({
      ...source,
      routeExecution: {
        collectorRunId: "collector-1",
        routePlanId: "route-1",
        capability: "READ_EXTERNAL_COMMENTS",
        adapterKey: "LICENSED_PROVIDER",
        acquisitionMode: "LICENSED_PROVIDER",
      },
    })

    expect(mockDeps.parentMatchContextsForComments).toHaveBeenCalledWith(
      "org-1",
      "facebook",
      [],
      ["fb-post-id-only"],
    )
    expect(mockDeps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      platform: "facebook",
      externalId: "provider:fb-post-id-only",
      contentKind: "POST",
      postExternalId: "fb-post-id-only",
    }))
    expect(mockDeps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      platform: "facebook",
      externalId: "provider:fb-comment-id-only",
      contentKind: "COMMENT",
      postExternalId: "fb-post-id-only",
      parentMatchContext: parentContext,
    }))
  })

  it("marks malformed provider payloads as failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true })))

    const result = await runProviderApiCollector(source)

    expect(result).toMatchObject({
      status: "failed",
      error: "provider_payload_invalid",
    })
  })
})
