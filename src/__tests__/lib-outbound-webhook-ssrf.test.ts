import { describe, expect, it, vi } from "vitest"
import {
  connectionCandidatesForOutboundRequest,
  downloadOutboundResource,
  requestOutboundWebhook,
  validateOutboundWebhookUrl,
  type OutboundWebhookResolver,
  type OutboundWebhookTransport,
} from "@/lib/integrations/webhook-url-guard"

const PUBLIC_V4 = "93.184.216.34"
const PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946"

function resolverFor(
  answers: Record<string, Array<{ address: string; family: 4 | 6 }>>,
): OutboundWebhookResolver {
  return vi.fn(async (hostname: string) => answers[hostname] ?? [])
}

describe("validateOutboundWebhookUrl", () => {
  it.each([
    "https://127.0.0.1/hook",
    "https://2130706433/hook",       // single-integer IPv4
    "https://0177.0.0.1/hook",       // octal IPv4
    "https://0x7f000001/hook",       // hexadecimal IPv4
    "https://%31%32%37.0.0.1/hook", // percent-encoded loopback
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/hook",
    "https://[::ffff:127.0.0.1]/hook",
    "https://[64:ff9b::7f00:1]/hook",   // well-known NAT64
    "https://[64:ff9b:1::7f00:1]/hook", // local-use NAT64
    "https://[fc00::1]/hook",
    "https://[fe80::1]/hook",
  ])("rejects unsafe literal/encoded target %s", async (url) => {
    await expect(validateOutboundWebhookUrl(url)).rejects.toThrow()
  })

  it("allows a public IP literal without performing DNS", async () => {
    const resolver = vi.fn<OutboundWebhookResolver>()
    const result = await validateOutboundWebhookUrl(
      "https://8.8.8.8/webhook",
      { resolver },
    )

    expect(result.addresses).toEqual([{ address: "8.8.8.8", family: 4 }])
    expect(resolver).not.toHaveBeenCalled()
  })

  it("requires HTTPS unless public HTTP webhook support is explicitly enabled", async () => {
    const resolver = resolverFor({
      "hooks.example.com": [{ address: PUBLIC_V4, family: 4 }],
    })

    await expect(
      validateOutboundWebhookUrl("http://hooks.example.com/cb", { resolver }),
    ).rejects.toThrow(/https/i)
    const allowed = await validateOutboundWebhookUrl(
      "http://hooks.example.com/cb",
      {
        resolver,
        allowHttp: true,
      },
    )
    expect(allowed.url.protocol).toBe("http:")
  })

  it("rejects a hostname when any A/AAAA answer is private", async () => {
    const resolver = resolverFor({
      "mixed.example.com": [
        { address: PUBLIC_V4, family: 4 },
        { address: "10.20.30.40", family: 4 },
      ],
    })

    await expect(
      validateOutboundWebhookUrl("https://mixed.example.com/cb", { resolver }),
    ).rejects.toThrow(/private|reserved/i)
  })

  it("accepts public A and AAAA answers and returns both for pinned delivery", async () => {
    const resolver = resolverFor({
      "hooks.example.com": [
        { address: PUBLIC_V4, family: 4 },
        { address: PUBLIC_V6, family: 6 },
      ],
    })

    const result = await validateOutboundWebhookUrl(
      "https://hooks.example.com/cb#ignored",
      { resolver },
    )

    expect(result.url.toString()).toBe("https://hooks.example.com/cb")
    expect(result.addresses).toEqual([
      { address: PUBLIC_V4, family: 4 },
      { address: PUBLIC_V6, family: 6 },
    ])
  })

  it("enforces an exact normalized hostname allowlist before DNS", async () => {
    const resolver = vi.fn<OutboundWebhookResolver>()

    await expect(validateOutboundWebhookUrl(
      "https://redirector.example.com/hook",
      { allowedHosts: ["api.example.com"], resolver },
    )).rejects.toThrow(/not allowlisted/i)

    expect(resolver).not.toHaveBeenCalled()
  })
})

describe("requestOutboundWebhook redirects", () => {
  it("returns bounded binary resource bytes through the pinned transport", async () => {
    const transport = vi.fn<OutboundWebhookTransport>().mockResolvedValue({
      status: 200,
      headers: { "content-type": "audio/mpeg" },
      bodyBytes: new Uint8Array([1, 2, 3]),
    })

    await expect(downloadOutboundResource("https://8.8.8.8/audio.mp3", {
      maxResponseBytes: 3,
      transport,
    })).resolves.toEqual({
      ok: true,
      status: 200,
      url: "https://8.8.8.8/audio.mp3",
      redirects: 0,
      headers: { "content-type": "audio/mpeg" },
      bodyBytes: new Uint8Array([1, 2, 3]),
    })

    expect(transport.mock.calls[0][1]).toMatchObject({
      method: "GET",
      maxResponseBytes: 3,
      responseBodyMode: "bytes",
    })
  })

  it("never fails over a non-idempotent request to a second DNS address", () => {
    const target = {
      addresses: [
        { address: PUBLIC_V4, family: 4 as const },
        { address: PUBLIC_V6, family: 6 as const },
      ],
    }

    expect(connectionCandidatesForOutboundRequest(target, { method: "POST", body: "{}" }))
      .toEqual([{ address: PUBLIC_V4, family: 4 }])
    expect(connectionCandidatesForOutboundRequest(target, { method: "DELETE" }))
      .toEqual([{ address: PUBLIC_V4, family: 4 }])
    expect(connectionCandidatesForOutboundRequest(target, { method: "GET" }))
      .toEqual(target.addresses)
  })

  it.each([
    "Host",
    "Connection",
    "Transfer-Encoding",
    "Upgrade",
    "Proxy-Authorization",
    "Proxy-Connection",
  ])("rejects caller-controlled hop/proxy header %s", async (header) => {
    const transport = vi.fn<OutboundWebhookTransport>()

    await expect(
      requestOutboundWebhook("https://8.8.8.8/hook", {
        headers: { [header]: "attacker-controlled" },
        transport,
      }),
    ).rejects.toThrow(/header is not allowed/i)

    expect(transport).not.toHaveBeenCalled()
  })

  it("rejects an oversized body before DNS or transport", async () => {
    const resolver = vi.fn<OutboundWebhookResolver>()
    const transport = vi.fn<OutboundWebhookTransport>()

    await expect(
      requestOutboundWebhook("https://8.8.8.8/hook", {
        body: "four",
        maxBodyBytes: 3,
        resolver,
        transport,
      }),
    ).rejects.toThrow(/body exceeds/i)

    expect(resolver).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  })

  it("re-resolves and rejects a redirect whose hostname becomes private", async () => {
    const resolver = resolverFor({
      "public.example.com": [{ address: PUBLIC_V4, family: 4 }],
      "internal.example.com": [{ address: "10.0.0.7", family: 4 }],
    })
    const transport = vi.fn<OutboundWebhookTransport>()
      .mockResolvedValueOnce({
        status: 302,
        location: "https://internal.example.com/admin",
      })

    await expect(
      requestOutboundWebhook("https://public.example.com/cb", {
        resolver,
        transport,
      }),
    ).rejects.toThrow(/private|reserved/i)

    // The unsafe second hop is rejected before a socket can be opened.
    expect(transport).toHaveBeenCalledTimes(1)
    expect(resolver).toHaveBeenCalledWith("public.example.com")
    expect(resolver).toHaveBeenCalledWith("internal.example.com")
  })

  it("applies the exact host allowlist again before a redirect hop", async () => {
    const resolver = resolverFor({
      "api.example.com": [{ address: PUBLIC_V4, family: 4 }],
      "public-but-unapproved.example.com": [{ address: PUBLIC_V6, family: 6 }],
    })
    const transport = vi.fn<OutboundWebhookTransport>().mockResolvedValueOnce({
      status: 307,
      location: "https://public-but-unapproved.example.com/collect",
    })

    await expect(requestOutboundWebhook("https://api.example.com/start", {
      allowedHosts: ["api.example.com"],
      resolver,
      transport,
    })).rejects.toThrow(/not allowlisted/i)

    expect(transport).toHaveBeenCalledTimes(1)
    expect(resolver).not.toHaveBeenCalledWith("public-but-unapproved.example.com")
  })

  it("follows a safe redirect manually and revalidates the next A/AAAA set", async () => {
    const resolver = resolverFor({
      "old.example.com": [{ address: PUBLIC_V4, family: 4 }],
      "new.example.com": [{ address: PUBLIC_V6, family: 6 }],
    })
    const transport = vi.fn<OutboundWebhookTransport>()
      .mockResolvedValueOnce({
        status: 307,
        location: "https://new.example.com/hooks/final",
      })
      .mockResolvedValueOnce({ status: 204 })

    const response = await requestOutboundWebhook(
      "https://old.example.com/hooks",
      {
        method: "POST",
        body: "{}",
        resolver,
        transport,
      },
    )

    expect(response).toEqual({
      ok: true,
      status: 204,
      url: "https://new.example.com/hooks/final",
      redirects: 1,
    })
    expect(transport).toHaveBeenCalledTimes(2)
    expect(transport.mock.calls[1][0].addresses).toEqual([
      { address: PUBLIC_V6, family: 6 },
    ])
    expect(transport.mock.calls[1][1]).toMatchObject({
      method: "POST",
      body: "{}",
    })
  })

  it("strips credentials before following a cross-origin redirect", async () => {
    const resolver = resolverFor({
      "old.example.com": [{ address: PUBLIC_V4, family: 4 }],
      "new.example.com": [{ address: PUBLIC_V6, family: 6 }],
    })
    const transport = vi.fn<OutboundWebhookTransport>()
      .mockResolvedValueOnce({
        status: 307,
        location: "https://new.example.com/final",
      })
      .mockResolvedValueOnce({ status: 204 })

    await requestOutboundWebhook("https://old.example.com/start", {
      method: "POST",
      body: "{}",
      headers: {
        Authorization: "Bearer secret",
        Cookie: "session=secret",
        "X-API-Key": "custom-secret",
        "X-Trace-Id": "trace-1",
      },
      sensitiveHeaders: ["x-api-key"],
      resolver,
      transport,
    })

    expect(transport.mock.calls[0][1].headers).toMatchObject({
      Authorization: "Bearer secret",
      Cookie: "session=secret",
      "X-API-Key": "custom-secret",
    })
    expect(transport.mock.calls[1][1].headers).not.toHaveProperty(
      "Authorization",
    )
    expect(transport.mock.calls[1][1].headers).not.toHaveProperty("Cookie")
    expect(transport.mock.calls[1][1].headers).not.toHaveProperty("X-API-Key")
    expect(transport.mock.calls[1][1].headers).toMatchObject({
      "X-Trace-Id": "trace-1",
    })
  })

  it("keeps credentials on a same-origin redirect", async () => {
    const transport = vi.fn<OutboundWebhookTransport>()
      .mockResolvedValueOnce({
        status: 307,
        location: "/final",
      })
      .mockResolvedValueOnce({ status: 204 })

    await requestOutboundWebhook("https://8.8.8.8/start", {
      headers: {
        authorization: "Bearer secret",
        cookie: "session=secret",
      },
      transport,
    })

    expect(transport.mock.calls[1][1].headers).toMatchObject({
      authorization: "Bearer secret",
      cookie: "session=secret",
    })
  })

  it("preserves HEAD across a 303 redirect", async () => {
    const transport = vi.fn<OutboundWebhookTransport>()
      .mockResolvedValueOnce({ status: 303, location: "/final" })
      .mockResolvedValueOnce({ status: 204 })

    await requestOutboundWebhook("https://8.8.8.8/start", {
      method: "HEAD",
      transport,
    })

    expect(transport.mock.calls[1][1]).toMatchObject({ method: "HEAD" })
  })

  it("returns an explicitly bounded response body to integrations that need it", async () => {
    const transport = vi.fn<OutboundWebhookTransport>().mockResolvedValue({
      status: 200,
      bodyText: JSON.stringify({ id: "ERP-42" }),
    })

    const response = await requestOutboundWebhook(
      "https://8.8.8.8/invoices",
      {
        method: "POST",
        body: "{}",
        maxResponseBytes: 64 * 1024,
        transport,
      },
    )

    expect(response.bodyText).toBe(JSON.stringify({ id: "ERP-42" }))
    expect(transport.mock.calls[0][1]).toMatchObject({
      maxResponseBytes: 64 * 1024,
    })
  })

  it("enforces a bounded redirect count", async () => {
    const resolver = resolverFor({
      "loop.example.com": [{ address: PUBLIC_V4, family: 4 }],
    })
    const transport = vi.fn<OutboundWebhookTransport>().mockResolvedValue({
      status: 307,
      location: "/again",
    })

    await expect(
      requestOutboundWebhook("https://loop.example.com/start", {
        resolver,
        transport,
        maxRedirects: 2,
      }),
    ).rejects.toThrow(/redirect limit/i)
    expect(transport).toHaveBeenCalledTimes(3)
  })
})
