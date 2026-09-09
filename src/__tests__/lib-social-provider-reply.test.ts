import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  decryptToken: vi.fn(),
  request: vi.fn(),
  isSecurityError: vi.fn(),
}))

vi.mock("@/lib/secure-token", () => ({
  decryptToken: mocks.decryptToken,
}))

vi.mock("@/lib/social/social-outbound-http", () => ({
  requestSocialOutboundJson: mocks.request,
  isSocialOutboundSecurityError: mocks.isSecurityError,
}))

import { sendProviderReply } from "@/lib/social/provider-reply"

const mention = {
  id: "mention-1",
  organizationId: "org-1",
  platform: "instagram",
  externalId: "comment-1",
  sourceType: "comment",
  sourceProvider: "provider_api",
  sourceMetadata: {
    replyCapability: {
      approved: true,
      provider: "generic-provider",
      endpoint: "https://reply.example.com/comments/reply",
      targetId: "remote-comment-1",
      encryptedToken: "ciphertext",
    },
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.stubEnv("SOCIAL_REPLY_PROVIDER_ALLOWED_HOSTS", "reply.example.com")
  mocks.decryptToken.mockReturnValue("provider-token")
  mocks.isSecurityError.mockReturnValue(false)
})

describe("generic social provider reply transport", () => {
  it("uses the bounded pinned transport and returns only the provider reply id", async () => {
    mocks.request.mockResolvedValueOnce({
      ok: true,
      status: 200,
      payload: { data: { id: "reply-remote-1" }, internal: "not returned" },
      finalUrl: "https://reply.example.com/comments/reply",
      redirects: 0,
    })

    const result = await sendProviderReply(mention, "Thanks", {
      idempotencyKey: "idem-1",
      providerRequestId: "request-1",
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      provider: "generic-provider",
      replyId: "reply-remote-1",
    })
    expect(mocks.request).toHaveBeenCalledWith(
      "https://reply.example.com/comments/reply",
      expect.objectContaining({
        method: "POST",
        allowedHosts: ["reply.example.com"],
        timeoutMs: 10_000,
        maxBodyBytes: 64 * 1024,
        maxResponseBytes: 128 * 1024,
        maxRedirects: 2,
        sensitiveHeaders: ["idempotency-key", "x-request-id"],
        headers: expect.objectContaining({
          authorization: "Bearer provider-token",
          "idempotency-key": "idem-1",
          "x-request-id": "request-1",
        }),
      }),
    )
  })

  it("ignores legacy tokenEnv and never forwards NEXTAUTH_SECRET", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", "session-secret-must-not-be-forwarded")
    mocks.request.mockResolvedValueOnce({
      ok: true,
      status: 200,
      payload: { id: "reply-without-env-token" },
      finalUrl: "https://reply.example.com/comments/reply",
      redirects: 0,
    })
    const legacyMention = {
      ...mention,
      sourceMetadata: {
        replyCapability: {
          ...mention.sourceMetadata.replyCapability,
          encryptedToken: undefined,
          tokenEnv: "NEXTAUTH_SECRET",
        },
      },
    }

    const result = await sendProviderReply(legacyMention, "Thanks")
    const requestOptions = mocks.request.mock.calls[0]?.[1] as {
      headers?: Record<string, string>
    }

    expect(result).toEqual({
      ok: true,
      status: 200,
      provider: "generic-provider",
      replyId: "reply-without-env-token",
    })
    expect(mocks.decryptToken).not.toHaveBeenCalled()
    expect(requestOptions.headers).not.toHaveProperty("authorization")
    expect(JSON.stringify(requestOptions.headers)).not.toContain("session-secret-must-not-be-forwarded")
    expect(JSON.stringify(result)).not.toContain("session-secret-must-not-be-forwarded")
  })

  it("never reflects an arbitrary upstream error body", async () => {
    mocks.request.mockResolvedValueOnce({
      ok: false,
      status: 500,
      payload: { secret: "upstream stack and credentials" },
      finalUrl: "https://reply.example.com/comments/reply",
      redirects: 0,
    })

    const result = await sendProviderReply(mention, "Thanks")

    expect(result).toMatchObject({
      ok: false,
      status: 502,
      code: "provider_reply_fetch_failed",
      error: "provider_reply_fetch_failed",
    })
    expect(JSON.stringify(result)).not.toContain("upstream stack")
    expect(result).not.toHaveProperty("raw")
  })

  it("maps a DNS or redirect policy block to a stable host error", async () => {
    const blocked = new Error("private redirect")
    mocks.request.mockRejectedValueOnce(blocked)
    mocks.isSecurityError.mockImplementationOnce(error => error === blocked)

    const result = await sendProviderReply(mention, "Thanks")

    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: "provider_reply_host_not_allowed",
      error: "provider_reply_host_not_allowed",
    })
  })
})
