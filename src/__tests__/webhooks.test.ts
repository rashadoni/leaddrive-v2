import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHmac } from "crypto"

const { dispatchMarketplaceConnectorEvent, mockRequestOutboundWebhook } = vi.hoisted(() => ({
  dispatchMarketplaceConnectorEvent: vi.fn(),
  mockRequestOutboundWebhook: vi.fn(),
}))

// Mock prisma before importing webhooks
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findFirst: vi.fn(),
    },
    apiKey: {
      findFirst: vi.fn(),
    },
    webhook: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/apps/connector-runtime", () => ({
  dispatchMarketplaceConnectorEvent,
}))

vi.mock("@/lib/integrations/webhook-url-guard", () => ({
  OutboundWebhookSecurityError: class OutboundWebhookSecurityError extends Error {},
  requestOutboundWebhook: mockRequestOutboundWebhook,
}))

import { fireWebhooks } from "@/lib/webhooks"
import { prisma } from "@/lib/prisma"
import { OutboundWebhookSecurityError } from "@/lib/integrations/webhook-url-guard"

function genericWebhook(events: string[], url = "https://example.com/hook") {
  return {
    id: "1",
    organizationId: "org1",
    url,
    secret: "s3cret",
    events,
    isActive: true,
    provenance: "generic",
    createdByApiKeyId: null,
    createdAt: new Date(),
  }
}

function zapierWebhook() {
  return {
    ...genericWebhook(["deal.created"]),
    id: "zapier-1",
    provenance: "zapier",
    createdByApiKeyId: "key-1",
  }
}

interface ApiKeyRow {
  id: string
  organizationId: string
  isActive: boolean
  expiresAt: Date | null
}

function mockApiKeyDatabase(row: ApiKeyRow | null) {
  vi.mocked(prisma.apiKey.findFirst).mockImplementation(async ({ where }: any) => {
    if (!row) return null
    if (where.id !== undefined && where.id !== row.id) return null
    if (where.organizationId !== undefined && where.organizationId !== row.organizationId) return null
    if (where.isActive !== undefined && where.isActive !== row.isActive) return null

    const expiryCutoff = where.OR?.[1]?.expiresAt?.gt as Date | undefined
    const unexpired = !expiryCutoff || row.expiresAt === null || row.expiresAt > expiryCutoff
    return unexpired ? ({ id: row.id } as any) : null
  })
}

describe("webhooks", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    dispatchMarketplaceConnectorEvent.mockResolvedValue(undefined)
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: "org1" } as any)
    mockRequestOutboundWebhook.mockResolvedValue({
      ok: true,
      status: 204,
      url: "https://example.com/hook",
      redirects: 0,
    })
  })

  it("dispatches to matching webhooks", async () => {
    vi.mocked(prisma.webhook.findMany).mockResolvedValue([
      genericWebhook(["deal.created"]),
    ] as any)

    await fireWebhooks("org1", "deal.created", { id: "deal-1" })

    // Wait for fire-and-forget dispatch
    await new Promise(r => setTimeout(r, 100))

    expect(mockRequestOutboundWebhook).toHaveBeenCalledTimes(1)
    const [url, opts] = mockRequestOutboundWebhook.mock.calls[0]
    expect(url).toBe("https://example.com/hook")
    expect(opts.headers["X-Webhook-Event"]).toBe("deal.created")
    expect(opts.headers["X-Webhook-Signature"]).toBeTruthy()
    expect(opts.headers["X-Webhook-Delivery-Id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(opts.headers["X-Webhook-Attempt"]).toBe("1")
    expect(opts.sensitiveHeaders).toEqual(["x-webhook-signature"])

    // Verify HMAC signature
    const body = opts.body
    const expectedSig = createHmac("sha256", "s3cret").update(body).digest("hex")
    expect(opts.headers["X-Webhook-Signature"]).toBe(expectedSig)

  })

  it("does not dispatch marketplace or custom webhooks for an inactive organization", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.webhook.findMany).mockResolvedValue([
      genericWebhook(["deal.created"]),
    ] as any)

    await fireWebhooks("org1", "deal.created", { id: "deal-1" }, { awaitDelivery: true })

    expect(dispatchMarketplaceConnectorEvent).not.toHaveBeenCalled()
    expect(prisma.webhook.findMany).not.toHaveBeenCalled()
    expect(mockRequestOutboundWebhook).not.toHaveBeenCalled()
  })

  it("skips webhooks that don't match the event", async () => {
    vi.mocked(prisma.webhook.findMany).mockResolvedValue([
      genericWebhook(["ticket.created"]),
    ] as any)

    await fireWebhooks("org1", "deal.created", { id: "deal-1" })
    await new Promise(r => setTimeout(r, 100))

    expect(mockRequestOutboundWebhook).not.toHaveBeenCalled()
  })

  it("blocks SSRF to private URLs", async () => {
    mockRequestOutboundWebhook.mockRejectedValue(
      new OutboundWebhookSecurityError("private address"),
    )

    vi.mocked(prisma.webhook.findMany).mockResolvedValue([
      genericWebhook(["deal.created"], "http://127.0.0.1:8080/internal"),
    ] as any)

    await fireWebhooks("org1", "deal.created", { id: "deal-1" })
    await new Promise(r => setTimeout(r, 100))

    // Security policy failures are terminal; no retries are attempted.
    expect(mockRequestOutboundWebhook).toHaveBeenCalledTimes(1)
  })

  it("retries on server error with exponential backoff", async () => {
    mockRequestOutboundWebhook
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 502 })
      .mockResolvedValueOnce({ ok: true, status: 204 })

    vi.mocked(prisma.webhook.findMany).mockResolvedValue([
      genericWebhook(["deal.created"]),
    ] as any)

    await fireWebhooks("org1", "deal.created", { id: "deal-1" })
    // Wait enough for retries (1s + 4s backoff)
    await new Promise(r => setTimeout(r, 6000))

    expect(mockRequestOutboundWebhook).toHaveBeenCalledTimes(3)
    const attempts = mockRequestOutboundWebhook.mock.calls.map(([, options]) => options.headers)
    expect(attempts.map(headers => headers["X-Webhook-Attempt"])).toEqual(["1", "2", "3"])
    expect(new Set(attempts.map(headers => headers["X-Webhook-Delivery-Id"])).size).toBe(1)
  }, 10000)

  it("does not retry when a transport exception leaves the POST outcome unknown", async () => {
    mockRequestOutboundWebhook
      .mockRejectedValueOnce(new Error("socket reset after request write"))
      .mockResolvedValueOnce({ ok: true, status: 204 })

    vi.mocked(prisma.webhook.findMany).mockResolvedValue([
      genericWebhook(["deal.created"]),
    ] as any)

    await fireWebhooks("org1", "deal.created", { id: "deal-1" }, { awaitDelivery: true })

    expect(mockRequestOutboundWebhook).toHaveBeenCalledTimes(1)
    expect(mockRequestOutboundWebhook.mock.calls[0][1].headers["X-Webhook-Attempt"]).toBe("1")
  })

  it("never copies a credential-bearing callback URL into logs", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const secretUrl = "https://example.com/hooks/bearer-secret?token=query-secret"
    mockRequestOutboundWebhook.mockResolvedValue({ ok: false, status: 400 })
    vi.mocked(prisma.webhook.findMany).mockResolvedValue([
      genericWebhook(["deal.created"], secretUrl),
    ] as any)

    await fireWebhooks("org1", "deal.created", { id: "deal-1" }, { awaitDelivery: true })

    expect(consoleError.mock.calls.flat().join(" ")).not.toContain(secretUrl)
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("bearer-secret")
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("query-secret")
  })

  it("does not retry on 4xx client errors", async () => {
    mockRequestOutboundWebhook.mockResolvedValue({ ok: false, status: 404 })

    vi.mocked(prisma.webhook.findMany).mockResolvedValue([
      genericWebhook(["deal.created"]),
    ] as any)

    await fireWebhooks("org1", "deal.created", { id: "deal-1" })
    await new Promise(r => setTimeout(r, 500))

    expect(mockRequestOutboundWebhook).toHaveBeenCalledTimes(1)
  })

  it("awaits marketplace and custom deliveries when requested", async () => {
    let releaseConnector!: () => void
    const connectorPending = new Promise<void>((resolve) => {
      releaseConnector = resolve
    })
    dispatchMarketplaceConnectorEvent.mockReturnValueOnce(connectorPending)

    let releaseWebhook!: () => void
    const webhookPending = new Promise<Record<string, unknown>>((resolve) => {
      releaseWebhook = () => resolve({
        ok: true,
        status: 204,
        url: "https://example.com/hook",
        redirects: 0,
      })
    })
    mockRequestOutboundWebhook.mockReturnValueOnce(webhookPending)
    vi.mocked(prisma.webhook.findMany).mockResolvedValue([
      genericWebhook(["social_mention.updated"]),
    ] as any)

    let settled = false
    const delivery = fireWebhooks(
      "org1",
      "social_mention.updated",
      { id: "mention-1" },
      { awaitDelivery: true },
    ).finally(() => {
      settled = true
    })

    await vi.waitFor(() => expect(mockRequestOutboundWebhook).toHaveBeenCalledTimes(1))
    expect(settled).toBe(false)

    releaseWebhook()
    await Promise.resolve()
    expect(settled).toBe(false)

    releaseConnector()
    await delivery
    expect(settled).toBe(true)
  })

  it("dispatches a Zapier subscription only while its creator key is active and unexpired", async () => {
    mockApiKeyDatabase({
      id: "key-1",
      organizationId: "org1",
      isActive: true,
      expiresAt: null,
    })
    vi.mocked(prisma.webhook.findMany).mockResolvedValue([
      zapierWebhook(),
    ] as any)

    await fireWebhooks("org1", "deal.created", { id: "deal-1" }, { awaitDelivery: true })

    expect(mockRequestOutboundWebhook).toHaveBeenCalledTimes(1)
    expect(prisma.apiKey.findFirst).toHaveBeenCalledWith({
      where: {
        id: "key-1",
        organizationId: "org1",
        isActive: true,
        organization: { isActive: true },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: expect.any(Date) } },
        ],
      },
      select: { id: true },
    })
  })

  it.each(
    [
      ["revoked", { id: "key-1", organizationId: "org1", isActive: false, expiresAt: null }],
      ["disabled", { id: "key-1", organizationId: "org1", isActive: false, expiresAt: null }],
      ["expired", { id: "key-1", organizationId: "org1", isActive: true, expiresAt: new Date("2020-01-01T00:00:00Z") }],
      ["cross-tenant", { id: "key-1", organizationId: "org2", isActive: true, expiresAt: null }],
      ["deleted", null],
    ] satisfies Array<[string, ApiKeyRow | null]>,
  )("does not deliver after the creator key is %s", async (_state, creator) => {
    mockApiKeyDatabase(creator)
    vi.mocked(prisma.webhook.findMany).mockResolvedValue([
      zapierWebhook(),
    ] as any)

    await fireWebhooks("org1", "deal.created", { id: "deal-1" }, { awaitDelivery: true })

    expect(mockRequestOutboundWebhook).not.toHaveBeenCalled()
  })
})
