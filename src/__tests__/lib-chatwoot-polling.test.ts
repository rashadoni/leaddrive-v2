import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

const { ingestChatwootInbound, runChatwootInboundAutomation } = vi.hoisted(() => ({
  ingestChatwootInbound: vi.fn(),
  runChatwootInboundAutomation: vi.fn(async () => ({})),
}))

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn(async (_organizationId: string, work: () => unknown) => work()),
}))
vi.mock("@/lib/inbox/chatwoot-inbound", () => ({
  ingestChatwootInbound,
  runChatwootInboundAutomation,
}))

import { pollChatwootTikTokInbounds } from "@/lib/inbox/chatwoot-polling"

const NOW = new Date("2026-08-13T12:00:00.000Z")
const originalAllowedHosts = process.env.CHATWOOT_POLL_ALLOWED_HOSTS

type TestConfig = {
  id: string
  organizationId: string
  channelType: string
  configName: string
  apiKey: string
  isActive: boolean
  settings: Record<string, unknown>
}

type FetchScenario = {
  inboxes?: unknown[]
  conversationPages?: Record<number, unknown[]>
  messages?: Record<string, unknown[]>
}

function config(settings: Record<string, unknown> = {}): TestConfig {
  return {
    id: "cfg-tiktok",
    organizationId: "org-a",
    channelType: "chatwoot",
    configName: "TikTok DM",
    apiKey: "tenant-a-token",
    isActive: true,
    settings: {
      platform: "tiktok",
      baseUrl: "https://chatwoot.example",
      accountId: "42",
      inboxId: "7",
      replyMode: "ai",
      ...settings,
    },
  }
}

function conversation(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    account_id: 42,
    inbox_id: 7,
    status: "open",
    can_reply: true,
    ...overrides,
  }
}

function inbound(
  id: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    message_type: "incoming",
    content: "Salam",
    private: false,
    created_at: Math.floor(NOW.getTime() / 1000),
    sender: { id: 901, name: "Customer" },
    ...overrides,
  }
}

function outbound(
  id: number,
  status: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    message_type: "outgoing",
    content: "Cavab",
    private: false,
    status,
    created_at: Math.floor(NOW.getTime() / 1000),
    ...overrides,
  }
}

function automationContext(input: Record<string, unknown>): Record<string, unknown> {
  const payload = input.payload as Record<string, unknown>
  const payloadConversation = payload.conversation as Record<string, unknown>
  const channelConfig = input.channelConfig as TestConfig
  return {
    organizationId: channelConfig.organizationId,
    channelConfig,
    conversationId: `local-${String(payloadConversation.id)}`,
    chatwootConversationId: String(payloadConversation.id),
    senderName: "Customer",
    contactId: "contact-1",
    messageId: `local-message-${String(payload.id)}`,
    text: String(payload.content ?? ""),
    hasRealText: true,
    messageType: "text",
    mediaUrl: null,
    unsupportedMedia: false,
    metadata: {},
    createdAt: NOW,
    origin: "poller",
  }
}

function database(input: {
  channelConfig?: TestConfig
  cursorIds?: string[]
} = {}) {
  const activeConfig = input.channelConfig ?? config()
  const findManyConfigs = vi.fn(async () => [activeConfig])
  const countConfigs = vi.fn(async () => 1)
  const findManyMessages = vi.fn(async () =>
    (input.cursorIds ?? ["1"]).map((externalId) => ({ externalId })),
  )

  return {
    db: {
      channelConfig: {
        count: countConfigs,
        findMany: findManyConfigs,
      },
      channelMessage: {
        findMany: findManyMessages,
      },
    },
    findManyConfigs,
    countConfigs,
    findManyMessages,
  }
}

function fetchScenario(scenario: FetchScenario) {
  const unexpected: string[] = []
  const calls = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })

    expect(init?.headers).toEqual(expect.objectContaining({
      api_access_token: "tenant-a-token",
    }))
    expect(init?.redirect).toBe("error")

    if (url.pathname === "/api/v1/accounts/42/inboxes") {
      return json({ payload: scenario.inboxes ?? [] })
    }
    if (url.pathname === "/api/v1/accounts/42/conversations") {
      const page = Number(url.searchParams.get("page"))
      return json({ data: { payload: scenario.conversationPages?.[page] ?? [] } })
    }
    const match = url.pathname.match(/^\/api\/v1\/accounts\/42\/conversations\/([^/]+)\/messages$/)
    if (match) {
      return json({ payload: scenario.messages?.[decodeURIComponent(match[1])] ?? [] })
    }

    unexpected.push(url.toString())
    return json({ error: "unexpected request" }, 404)
  })

  return {
    fetcher: calls as unknown as typeof fetch,
    calls,
    unexpected,
  }
}

function urls(calls: ReturnType<typeof vi.fn>): URL[] {
  return calls.mock.calls.map((call) => new URL(String(call[0])))
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CHATWOOT_POLL_ALLOWED_HOSTS = "chatwoot.example"
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  ingestChatwootInbound.mockImplementation(async (input: Record<string, unknown>) => {
    const blocked = Boolean(input.sourceReplyCoverage || input.suppressAutomationReason)
    return {
      ok: true,
      ingested: true,
      ...(blocked ? {} : { automation: automationContext(input) }),
    }
  })
})

afterAll(() => {
  vi.useRealTimers()
  if (originalAllowedHosts === undefined) delete process.env.CHATWOOT_POLL_ALLOWED_HOSTS
  else process.env.CHATWOOT_POLL_ALLOWED_HOSTS = originalAllowedHosts
})

describe("pollChatwootTikTokInbounds", () => {
  it("pins reads and canonical ingest to the configured account and exact inbox", async () => {
    const { db } = database()
    const api = fetchScenario({
      conversationPages: {
        1: [
          conversation("valid"),
          conversation("wrong-account", { account_id: 43 }),
          conversation("wrong-inbox", { inbox_id: 8 }),
        ],
      },
      messages: { valid: [inbound(101)] },
    })

    const result = await pollChatwootTikTokInbounds(db as never, { fetcher: api.fetcher })

    expect(result).toEqual(expect.objectContaining({
      configurations: 1,
      conversations: 1,
      messagesSeen: 1,
      ignored: 2,
    }))
    const requested = urls(api.calls)
    const listRequest = requested.find((url) => url.pathname.endsWith("/conversations"))
    expect(listRequest?.pathname).toBe("/api/v1/accounts/42/conversations")
    expect(Object.fromEntries(listRequest?.searchParams ?? [])).toEqual(expect.objectContaining({
      inbox_id: "7",
      status: "all",
      assignee_type: "all",
      sort_by: "last_activity_at_desc",
      page: "1",
    }))
    const messagesRequest = requested.find((url) => url.pathname.endsWith("/messages"))
    expect(messagesRequest?.pathname).toBe("/api/v1/accounts/42/conversations/valid/messages")
    expect(messagesRequest?.searchParams.get("filter_internal_messages")).toBe("true")
    expect(requested.some((url) => url.pathname.includes("wrong-account"))).toBe(false)
    expect(requested.some((url) => url.pathname.includes("wrong-inbox"))).toBe(false)
    expect(ingestChatwootInbound).toHaveBeenCalledWith(expect.objectContaining({
      expectedInboxId: "7",
      origin: "poller",
      deferAutomation: true,
      channelConfig: expect.objectContaining({
        organizationId: "org-a",
        settings: expect.objectContaining({ accountId: "42", inboxId: "7" }),
      }),
      payload: expect.objectContaining({
        id: 101,
        account_id: 42,
        inbox_id: 7,
        conversation: expect.objectContaining({ id: "valid", account_id: 42, inbox_id: 7 }),
      }),
    }))
    expect(api.unexpected).toEqual([])
  })

  it("fails closed when an unpinned config discovers more than one TikTok inbox", async () => {
    const activeConfig = config({ inboxId: undefined })
    delete activeConfig.settings.inboxId
    const { db } = database({ channelConfig: activeConfig })
    const api = fetchScenario({
      inboxes: [
        { id: 7, channel_type: "Channel::Tiktok" },
        { id: 8, channel_type: "Channel::Tiktok" },
      ],
    })

    const result = await pollChatwootTikTokInbounds(db as never, { fetcher: api.fetcher })

    expect(result.skipped).toEqual({ "inbox-unresolved": 1 })
    expect(api.calls).toHaveBeenCalledOnce()
    expect(urls(api.calls)[0].pathname).toBe("/api/v1/accounts/42/inboxes")
    expect(ingestChatwootInbound).not.toHaveBeenCalled()
    expect(runChatwootInboundAutomation).not.toHaveBeenCalled()
  })

  it("canonical-ingests two rapid same-text messages with distinct ids, then runs one automation batch", async () => {
    const { db } = database({ cursorIds: ["99"] })
    const api = fetchScenario({
      conversationPages: { 1: [conversation("rapid")] },
      messages: {
        rapid: [
          inbound(100, { content: "same text" }),
          inbound(101, { content: "same text" }),
        ],
      },
    })

    const result = await pollChatwootTikTokInbounds(db as never, { fetcher: api.fetcher })

    expect(result.messagesSeen).toBe(2)
    expect(ingestChatwootInbound).toHaveBeenCalledTimes(2)
    expect(ingestChatwootInbound.mock.calls.map(([input]) => input.payload.id)).toEqual([100, 101])
    expect(runChatwootInboundAutomation).toHaveBeenCalledOnce()
    expect(runChatwootInboundAutomation).toHaveBeenCalledWith([
      expect.objectContaining({ messageId: "local-message-100" }),
      expect.objectContaining({ messageId: "local-message-101" }),
    ])
  })

  it("records the provider's refusal on the very reply that carries its id", async () => {
    // The page the poller already reads for coverage also carries the verdict
    // on our own replies. Before this, a refused reply kept its double tick.
    const update = vi.fn(async () => ({}))
    const findMany = vi.fn(async (args: { where?: { externalId?: { in?: string[] } } }) => (
      args?.where?.externalId?.in
        ? [{ id: "row-1", externalId: "900", metadata: { deliveryIdempotencyKey: "chatbot:k" } }]
        : [{ externalId: "99" }]
    ))
    const db = {
      channelConfig: { count: vi.fn(async () => 1), findMany: vi.fn(async () => [config()]) },
      channelMessage: { findMany, update },
    }
    const api = fetchScenario({
      conversationPages: { 1: [conversation("broken")] },
      messages: {
        broken: [
          inbound(100),
          outbound(900, "failed", {
            content_attributes: {
              external_error: "40002: Direct message error: User is not eligible for the Advanced Access tier.",
            },
          }),
        ],
      },
    })

    const result = await pollChatwootTikTokInbounds(db as never, { fetcher: api.fetcher })

    expect(result.deliveryFailuresRecorded).toBe(1)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "row-1" },
      data: expect.objectContaining({
        status: "failed",
        metadata: expect.objectContaining({
          deliveryIdempotencyKey: "chatbot:k",
          providerError: expect.stringContaining("40002"),
        }),
      }),
    }))
  })

  it("reconciles a recent-page older-id hole even when the stored provider cursor is newer", async () => {
    const { db, findManyMessages } = database({ cursorIds: ["500"] })
    const api = fetchScenario({
      conversationPages: { 1: [conversation("hole")] },
      messages: { hole: [inbound(499)] },
    })

    await pollChatwootTikTokInbounds(db as never, { fetcher: api.fetcher })

    expect(findManyMessages).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-a" }),
    }))
    expect(ingestChatwootInbound).toHaveBeenCalledOnce()
    expect(ingestChatwootInbound.mock.calls[0][0].payload.id).toBe(499)
  })

  it.each([
    { status: "sent", coverage: "covered", shouldAutomate: false },
    { status: "pending", coverage: "uncertain", shouldAutomate: false },
    { status: "failed", coverage: null, shouldAutomate: true },
  ])("treats a later source reply with status $status safely", async ({ status, coverage, shouldAutomate }) => {
    const { db } = database({ cursorIds: ["9"] })
    const api = fetchScenario({
      conversationPages: { 1: [conversation(`reply-${status}`)] },
      messages: {
        [`reply-${status}`]: [inbound(10), outbound(11, status)],
      },
    })

    await pollChatwootTikTokInbounds(db as never, { fetcher: api.fetcher })

    expect(ingestChatwootInbound).toHaveBeenCalledOnce()
    const input = ingestChatwootInbound.mock.calls[0][0]
    if (coverage) {
      expect(input.sourceReplyCoverage).toEqual({
        state: coverage,
        sourceMessageId: "11",
      })
    } else {
      expect(input.sourceReplyCoverage).toBeNull()
    }
    expect(runChatwootInboundAutomation).toHaveBeenCalledTimes(shouldAutomate ? 1 : 0)
  })

  it("mirrors old bootstrap history with a durable no-automation marker", async () => {
    const { db } = database({ cursorIds: [] })
    const old = Math.floor((NOW.getTime() - 11 * 60 * 1000) / 1000)
    const api = fetchScenario({
      conversationPages: { 1: [conversation("bootstrap-old")] },
      messages: { "bootstrap-old": [inbound(10, { created_at: old })] },
    })

    const result = await pollChatwootTikTokInbounds(db as never, { fetcher: api.fetcher })

    expect(result.messagesSeen).toBe(1)
    expect(ingestChatwootInbound).toHaveBeenCalledOnce()
    expect(ingestChatwootInbound).toHaveBeenCalledWith(expect.objectContaining({
      suppressAutomationReason: "source-too-old",
    }))
    expect(runChatwootInboundAutomation).not.toHaveBeenCalled()
  })

  it("leaves attachment and blank-message recovery to the live webhook path", async () => {
    const { db } = database({ cursorIds: ["9"] })
    const api = fetchScenario({
      conversationPages: { 1: [conversation("media")] },
      messages: {
        media: [
          inbound(10, { content: "caption", attachments: [{ data_url: "https://cdn.example/file" }] }),
          inbound(11, { content: "" }),
        ],
      },
    })

    const result = await pollChatwootTikTokInbounds(db as never, { fetcher: api.fetcher })

    expect(result.messagesSeen).toBe(2)
    expect(result.skipped).toEqual({ "non-text-inbound": 2 })
    expect(ingestChatwootInbound).not.toHaveBeenCalled()
    expect(runChatwootInboundAutomation).not.toHaveBeenCalled()
  })

  it("mirrors a non-open source conversation without starting AI", async () => {
    const { db } = database({ cursorIds: ["9"] })
    const api = fetchScenario({
      conversationPages: { 1: [conversation("resolved", { status: "resolved" })] },
      messages: { resolved: [inbound(10)] },
    })

    await pollChatwootTikTokInbounds(db as never, { fetcher: api.fetcher })

    expect(ingestChatwootInbound).toHaveBeenCalledOnce()
    expect(ingestChatwootInbound.mock.calls[0][0]).toEqual(expect.objectContaining({
      sourceReplyCoverage: expect.objectContaining({ state: "uncertain" }),
    }))
    expect(runChatwootInboundAutomation).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: "can_reply=false",
      conversationOverrides: { can_reply: false },
    },
    {
      label: "can_reply missing",
      conversationOverrides: { can_reply: undefined },
    },
    {
      label: "AgentBot assigned",
      conversationOverrides: {
        can_reply: true,
        meta: { assignee: { type: "AgentBot", id: 77 } },
      },
    },
  ])("mirrors $label without starting AI", async ({ conversationOverrides }) => {
    const { db } = database({ cursorIds: ["9"] })
    const api = fetchScenario({
      conversationPages: { 1: [conversation("source-unsafe", conversationOverrides)] },
      messages: { "source-unsafe": [inbound(10)] },
    })

    await pollChatwootTikTokInbounds(db as never, { fetcher: api.fetcher })

    expect(ingestChatwootInbound).toHaveBeenCalledOnce()
    expect(ingestChatwootInbound.mock.calls[0][0]).toEqual(expect.objectContaining({
      sourceReplyCoverage: expect.objectContaining({ state: "uncertain" }),
    }))
    expect(runChatwootInboundAutomation).not.toHaveBeenCalled()
  })

  it("walks another bounded conversation page only when the previous page is full", async () => {
    const { db } = database({ cursorIds: ["9"] })
    const fullWrongTenantPage = Array.from({ length: 25 }, (_, index) =>
      conversation(`wrong-${index}`, { account_id: 999 }),
    )
    const api = fetchScenario({
      conversationPages: {
        1: fullWrongTenantPage,
        2: [conversation("page-two")],
      },
      messages: { "page-two": [inbound(10)] },
    })

    await pollChatwootTikTokInbounds(db as never, { fetcher: api.fetcher })

    const listPages = urls(api.calls)
      .filter((url) => url.pathname.endsWith("/conversations"))
      .map((url) => url.searchParams.get("page"))
    expect(listPages).toEqual(["1", "2"])
    expect(ingestChatwootInbound).toHaveBeenCalledOnce()
    expect(ingestChatwootInbound.mock.calls[0][0].payload.id).toBe(10)
  })
})
