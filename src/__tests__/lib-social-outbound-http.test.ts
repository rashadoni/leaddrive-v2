import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  validate: vi.fn(),
  request: vi.fn(),
}))

vi.mock("@/lib/integrations/webhook-url-guard", () => ({
  OutboundWebhookSecurityError: class OutboundWebhookSecurityError extends Error {},
  validateOutboundWebhookUrl: mocks.validate,
  requestOutboundWebhook: mocks.request,
}))

import {
  requestSocialOutboundJson,
  validateMonitoringSourceOutboundEndpoints,
  validateSocialOutboundEndpointForWrite,
} from "@/lib/social/social-outbound-http"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.validate.mockImplementation(async (url: string) => ({
    url: new URL(url),
    addresses: [{ address: "93.184.216.34", family: 4 }],
  }))
})

describe("social outbound HTTP boundary", () => {
  it("DNS-validates every nested monitoring endpoint before persistence", async () => {
    await validateMonitoringSourceOutboundEndpoints({
      searchIndex: { endpoint: "https://search.example.com/query" },
      notificationInbox: { endpoint: "https://mailbox.example.com/messages" },
      provider: {
        endpoint: "https://provider.example.com/collect",
        reply: { endpoint: "https://reply.example.com/send" },
      },
    })

    expect(mocks.validate).toHaveBeenCalledTimes(4)
    expect(mocks.validate).toHaveBeenCalledWith(
      "https://mailbox.example.com/messages",
      { allowHttp: false },
    )
    expect(mocks.validate).toHaveBeenCalledWith(
      "https://search.example.com/query",
      { allowHttp: false },
    )
    expect(mocks.validate).toHaveBeenCalledWith(
      "https://provider.example.com/collect",
      { allowHttp: false },
    )
    expect(mocks.validate).toHaveBeenCalledWith(
      "https://reply.example.com/send",
      { allowHttp: false },
    )
  })

  it("rejects non-HTTPS endpoints before DNS validation", async () => {
    await expect(validateSocialOutboundEndpointForWrite(
      "http://provider.example.com/collect",
      "Provider endpoint",
    )).rejects.toThrow("Provider endpoint must use HTTPS")

    expect(mocks.validate).not.toHaveBeenCalled()
  })

  it("passes exact hosts and strict response/time bounds to the pinned transport", async () => {
    mocks.request.mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: "https://api.example.com/final",
      redirects: 1,
      bodyText: JSON.stringify({ items: [{ id: "one" }] }),
    })

    const result = await requestSocialOutboundJson("https://api.example.com/start", {
      method: "GET",
      headers: { authorization: "Bearer secret" },
      allowedHosts: ["API.EXAMPLE.COM", "redirect.example.com"],
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      payload: { items: [{ id: "one" }] },
      finalUrl: "https://api.example.com/final",
      redirects: 1,
    })
    expect(mocks.request).toHaveBeenCalledWith(
      "https://api.example.com/start",
      expect.objectContaining({
        method: "GET",
        allowHttp: false,
        allowedHosts: ["api.example.com", "redirect.example.com"],
        timeoutMs: 20_000,
        maxResponseBytes: 1024 * 1024,
        maxRedirects: 2,
      }),
    )
  })

  it("blocks a non-allowlisted initial host before opening the transport", async () => {
    await expect(requestSocialOutboundJson("https://untrusted.example.com/start", {
      allowedHosts: ["api.example.com"],
    })).rejects.toThrow(/not allowlisted/i)

    expect(mocks.request).not.toHaveBeenCalled()
  })

  it("drops provider-controlled error bodies at the transport boundary", async () => {
    mocks.request.mockResolvedValueOnce({
      ok: false,
      status: 500,
      url: "https://api.example.com/start",
      redirects: 0,
      bodyText: JSON.stringify({ secret: "upstream stack" }),
    })

    const result = await requestSocialOutboundJson("https://api.example.com/start", {
      allowedHosts: ["api.example.com"],
    })

    expect(result).toMatchObject({ ok: false, status: 500, payload: null })
    expect(JSON.stringify(result)).not.toContain("upstream stack")
  })
})
