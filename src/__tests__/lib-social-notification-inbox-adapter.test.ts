import { beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  mentionEvidence: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}))

const mockDeps = vi.hoisted(() => ({
  classifySentiment: vi.fn(),
  findMatchedKeyword: vi.fn(),
  ingestMentionWithResult: vi.fn(),
}))

const outboundMocks = vi.hoisted(() => ({
  request: vi.fn(),
  isSecurityError: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/sentiment", () => ({ classifySentiment: mockDeps.classifySentiment }))
vi.mock("@/lib/social/ingest-mention", () => ({
  findMatchedKeyword: mockDeps.findMatchedKeyword,
  ingestMentionWithResult: mockDeps.ingestMentionWithResult,
}))
vi.mock("@/lib/social/social-outbound-http", () => ({
  requestSocialOutboundJson: outboundMocks.request,
  isSocialOutboundSecurityError: outboundMocks.isSecurityError,
}))

import { parseSocialNotificationEmail, runNotificationInboxCollector } from "@/lib/social/notification-inbox-adapter"
import { prisma } from "@/lib/prisma"
import { ingestMentionWithResult } from "@/lib/social/ingest-mention"
import type { MonitoringSourceForRun } from "@/lib/social/monitoring-collector"

const source: MonitoringSourceForRun = {
  id: "source-inbox",
  organizationId: "org-1",
  platform: "instagram",
  sourceType: "notification_inbox",
  collectionMode: "notification_inbox",
  status: "active",
  cadenceMinutes: 60,
  lastCheckedAt: null,
  lastSuccessfulAt: null,
  lastError: null,
  keywords: ["LeadDrive"],
  settings: {
    notificationInbox: {
      approved: true,
      endpoint: "https://mailbox.example.com/social-notifications",
      address: "alerts@example.com",
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
  vi.stubEnv("SOCIAL_NOTIFICATION_INBOX_ALLOWED_HOSTS", "mailbox.example.com")
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
  mockDeps.classifySentiment.mockResolvedValue("neutral")
  mockDeps.findMatchedKeyword.mockReturnValue("LeadDrive")
  mockDeps.ingestMentionWithResult.mockResolvedValue({ id: "mention-1", created: true })
})

describe("notification inbox social monitoring adapter", () => {
  it("parses social notification emails into review-aware mention candidates", () => {
    const parsed = parseSocialNotificationEmail({
      id: "email-1",
      from: "notifications@mail.instagram.com",
      subject: "New comment from Aysel:",
      text: 'Aysel commented “LeadDrive price?” https://instagram.com/p/abc',
    })

    expect(parsed).toMatchObject({
      platform: "instagram",
      externalId: "notification:email-1",
      text: "LeadDrive price?",
      permalink: "https://instagram.com/p/abc",
      authorName: "Aysel",
      reviewRequired: false,
    })
  })

  it("ignores non-social notification emails", () => {
    expect(parseSocialNotificationEmail({ subject: "Weekly digest", text: "No social platform here" })).toBeNull()
  })

  it("ingests parsed notifications with T4 evidence and manual-only metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      messages: [
        {
          id: "email-1",
          from: "notifications@mail.instagram.com",
          subject: "New comment from Aysel:",
          text: 'Aysel commented “LeadDrive price?” https://instagram.com/p/abc',
          receivedAt: "2026-07-05T09:00:00.000Z",
        },
        { id: "email-2", subject: "Weekly digest", text: "No social platform here" },
      ],
    })))

    const result = await runNotificationInboxCollector(source)

    expect(result).toMatchObject({
      status: "success",
      foundCount: 1,
      newCount: 1,
      ignoredCount: 1,
    })
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("address=alerts%40example.com")
    expect(vi.mocked(fetch).mock.calls[0][1]).toEqual(expect.objectContaining({
      signal: expect.any(AbortSignal),
    }))
    expect(outboundMocks.request).toHaveBeenCalledWith(
      expect.stringContaining("https://mailbox.example.com/social-notifications"),
      expect.objectContaining({
        method: "GET",
        allowedHosts: ["mailbox.example.com"],
      }),
    )
    expect(ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      platform: "instagram",
      externalId: "notification:email-1",
      sourceProvider: "notification_inbox",
      sourceMetadata: expect.objectContaining({
        monitoringSourceId: "source-inbox",
        collector: "notification_inbox",
        replyPolicy: "manual_only",
      }),
      matchedTerm: "LeadDrive",
    }))
    expect(prisma.mentionEvidence.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        mentionId: "mention-1",
        sourceId: "source-inbox",
        sourceTrustTier: "T4",
      }),
    }))
  })

  it("fails closed for unsafe endpoints and malformed payloads", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    await expect(runNotificationInboxCollector({ ...source, settings: { notificationInbox: { approved: true, endpoint: "http://localhost:3000/mail" } } })).resolves.toMatchObject({
      status: "skipped",
      error: "notification_inbox_https_required",
    })
    expect(fetchMock).not.toHaveBeenCalled()

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true })))
    await expect(runNotificationInboxCollector(source)).resolves.toMatchObject({
      status: "failed",
      error: "notification_inbox_payload_invalid",
    })
  })

  it("fails closed when DNS or a redirect is blocked by the pinned transport", async () => {
    const blocked = new Error("private redirect")
    outboundMocks.request.mockRejectedValueOnce(blocked)
    outboundMocks.isSecurityError.mockImplementationOnce(error => error === blocked)

    const result = await runNotificationInboxCollector(source)

    expect(result).toMatchObject({
      status: "skipped",
      error: "notification_inbox_outbound_blocked",
    })
    expect(ingestMentionWithResult).not.toHaveBeenCalled()
  })
})
