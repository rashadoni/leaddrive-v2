import { describe, it, expect, vi, beforeEach } from "vitest"
import { prisma } from "@/lib/prisma"

/**
 * sendChatwootMessage — outbound reply LeadDrive → Chatwoot → TikTok (Phase 2).
 *
 * Covers:
 *  CWL-1  no Chatwoot ChannelConfig → {success:false}
 *  CWL-2  incomplete config (missing baseUrl) → {success:false}
 *  CWL-3  missing conversationId → {success:false}, no HTTP call
 *  CWL-4  happy path → POST to the right URL with api_access_token + outgoing body
 *  CWL-5  Chatwoot HTTP 4xx → {success:false} with status in the error
 *  CWL-7  a stalled Chatwoot request is aborted instead of blocking the webhook
 *  CWL-9  two active configs in one org → the reply goes out on the routed one
 */

type ChatwootConfig = {
  apiKey: string | null
  settings: Record<string, unknown>
}

/** A stored row, with the columns the lookup filters on. */
type ChatwootConfigRow = ChatwootConfig & {
  id: string
  organizationId: string
  channelType: string
  isActive: boolean
}

type ConfigWhere = {
  id?: string
  organizationId?: string
  channelType?: string
  isActive?: boolean
}

const db: { config: ChatwootConfig | null; configs: ChatwootConfigRow[] | null } = {
  config: null,
  configs: null,
}
const requestOutboundWebhookSpy = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      // Set `db.configs` and this becomes a real lookup: rows are filtered by
      // the where clause the sender built. A mock that returns its single row
      // whatever it is asked cannot tell a routed send from a "first active
      // config wins" fallback — which is the whole bug. `db.config` stays the
      // one-row shortcut the rest of the suite uses.
      findFirst: vi.fn(async (args?: { where?: ConfigWhere }) => {
        if (!db.configs) return db.config
        const where = args?.where ?? {}
        return db.configs.find((row) => (
          row.organizationId === where.organizationId
          && row.channelType === where.channelType
          && row.isActive === where.isActive
          && (where.id === undefined || row.id === where.id)
        )) ?? null
      }),
    },
  },
}))

vi.mock("@/lib/integrations/webhook-url-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/webhook-url-guard")>()
  return { ...actual, requestOutboundWebhook: requestOutboundWebhookSpy }
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  db.config = {
    apiKey: "tok_abc",
    settings: { baseUrl: "https://app.chatwoot.com/", accountId: 171064 },
  }
  db.configs = null
  requestOutboundWebhookSpy.mockReset()
  requestOutboundWebhookSpy.mockResolvedValue({
    ok: true,
    status: 200,
    url: "https://app.chatwoot.com/messages",
    redirects: 0,
  })
})

describe("sendChatwootMessage (Phase 2 outbound)", () => {
  it("CWL-1: no config → failure, no HTTP", async () => {
    db.config = null
    const { sendChatwootMessage } = await import("../lib/chatwoot")
    const r = await sendChatwootMessage({ conversationId: "42", content: "hi", organizationId: "org_1" })
    expect(r.success).toBe(false)
    expect(requestOutboundWebhookSpy).not.toHaveBeenCalled()
  })

  it("CWL-2: incomplete config (no baseUrl) → failure", async () => {
    db.config = { apiKey: "tok_abc", settings: { accountId: 171064 } }
    const { sendChatwootMessage } = await import("../lib/chatwoot")
    const r = await sendChatwootMessage({ conversationId: "42", content: "hi", organizationId: "org_1" })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/incomplete/i)
    expect(requestOutboundWebhookSpy).not.toHaveBeenCalled()
  })

  it("CWL-3: missing conversationId → failure, no HTTP", async () => {
    const { sendChatwootMessage } = await import("../lib/chatwoot")
    const r = await sendChatwootMessage({ conversationId: "", content: "hi", organizationId: "org_1" })
    expect(r.success).toBe(false)
    expect(requestOutboundWebhookSpy).not.toHaveBeenCalled()
  })

  it("CWL-4: happy path → POST to messages endpoint with api_access_token + outgoing body", async () => {
    const { sendChatwootMessage } = await import("../lib/chatwoot")
    const r = await sendChatwootMessage({ conversationId: "42", content: "Salam", organizationId: "org_1" })

    expect(r.success).toBe(true)
    expect(requestOutboundWebhookSpy).toHaveBeenCalledOnce()
    const [url, opts] = requestOutboundWebhookSpy.mock.calls[0]
    // trailing slash on baseUrl is trimmed
    expect(url).toBe("https://app.chatwoot.com/api/v1/accounts/171064/conversations/42/messages")
    expect(opts.method).toBe("POST")
    // Redirects are the guard's own business now: it revalidates every hop and
    // strips the credential headers named below. Asserting a fetch-level
    // `redirect` option here tests a layer this call no longer speaks to.
    expect(opts.sensitiveHeaders).toContain("api_access_token")
    expect(opts.headers.api_access_token).toBe("tok_abc")
    expect(opts.allowHttp).toBe(false)
    expect(opts.timeoutMs).toBe(15_000)
    expect(opts.sensitiveHeaders).toContain("api_access_token")
    expect(opts.maxResponseBytes).toBe(16 * 1024)
    const sent = JSON.parse(opts.body)
    expect(sent).toMatchObject({ content: "Salam", message_type: "outgoing", private: false })
  })

  it("CWL-4c: returns Chatwoot's message id so a later provider refusal can be pinned to this row", async () => {
    requestOutboundWebhookSpy.mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://app.chatwoot.com/messages",
      redirects: 0,
      bodyText: JSON.stringify({ id: 803712345, content: "Salam", message_type: 1 }),
    })
    const { sendChatwootMessage } = await import("../lib/chatwoot")

    const r = await sendChatwootMessage({ conversationId: "42", content: "Salam", organizationId: "org_1" })

    expect(r).toMatchObject({ success: true, messageId: "803712345" })
  })

  it("CWL-4d: an unreadable success body costs the id, never the send", async () => {
    requestOutboundWebhookSpy.mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://app.chatwoot.com/messages",
      redirects: 0,
      bodyText: "<html>proxy said ok</html>",
    })
    const { sendChatwootMessage } = await import("../lib/chatwoot")

    const r = await sendChatwootMessage({ conversationId: "42", content: "Salam", organizationId: "org_1" })

    expect(r.success).toBe(true)
    expect(r.messageId).toBeUndefined()
  })

  it("CWL-4b: an explicit channelConfigId pins the lookup to that active config and tenant", async () => {
    const { sendChatwootMessage } = await import("../lib/chatwoot")

    const result = await sendChatwootMessage({
      conversationId: "42",
      content: "Salam",
      organizationId: "org_1",
      channelConfigId: "cfg_exact",
    })

    expect(result.success).toBe(true)
    expect(prisma.channelConfig.findFirst).toHaveBeenCalledWith({
      where: {
        id: "cfg_exact",
        organizationId: "org_1",
        channelType: "chatwoot",
        isActive: true,
      },
      select: { apiKey: true, settings: true },
    })
  })

  it("CWL-4c: callers omitting channelConfigId preserve the organization-scoped lookup", async () => {
    const { sendChatwootMessage } = await import("../lib/chatwoot")

    await sendChatwootMessage({ conversationId: "42", content: "Salam", organizationId: "org_1" })

    expect(prisma.channelConfig.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org_1", channelType: "chatwoot", isActive: true },
      select: { apiKey: true, settings: true },
    })
  })

  it.each([
    "http://app.chatwoot.com",
    "https://evil.example",
    "https://user:pass@app.chatwoot.com",
  ])("CWL-4d: refuses untrusted Chatwoot base URL %s without dispatch", async (baseUrl) => {
    db.config = { apiKey: "tok_abc", settings: { baseUrl, accountId: 171064 } }
    const { sendChatwootMessage } = await import("../lib/chatwoot")

    const result = await sendChatwootMessage({ conversationId: "42", content: "hi", organizationId: "org_1" })

    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/not trusted/i) })
    expect(requestOutboundWebhookSpy).not.toHaveBeenCalled()
  })

  it("CWL-4e: permits an exact HTTPS self-hosted origin from CHATWOOT_POLL_ALLOWED_HOSTS", async () => {
    vi.stubEnv("CHATWOOT_POLL_ALLOWED_HOSTS", "support.example:8443")
    db.config = {
      apiKey: "tok_abc",
      settings: { baseUrl: "https://support.example:8443/some/path?ignored=yes", accountId: 171064 },
    }
    const { sendChatwootMessage } = await import("../lib/chatwoot")

    const result = await sendChatwootMessage({ conversationId: "42", content: "hi", organizationId: "org_1" })

    expect(result.success).toBe(true)
    // The path prefix is KEPT (22bda1339 added it on purpose, so a self-hosted
    // Chatwoot can live under a subpath); the query string is still dropped.
    // Only the host is allowlisted, and a path on an allowlisted host is not a
    // boundary — this used to expect the prefix stripped, which was the older
    // origin-only behaviour.
    expect(requestOutboundWebhookSpy).toHaveBeenCalledWith(
      "https://support.example:8443/some/path/api/v1/accounts/171064/conversations/42/messages",
      expect.objectContaining({ method: "POST", allowHttp: false }),
    )
  })

  it("CWL-5: Chatwoot HTTP error → failure with status", async () => {
    requestOutboundWebhookSpy.mockResolvedValue({
      ok: false,
      status: 401,
      url: "https://app.chatwoot.com/messages",
      redirects: 0,
      bodyText: "unauthorized",
    })
    const { sendChatwootMessage } = await import("../lib/chatwoot")
    const r = await sendChatwootMessage({ conversationId: "42", content: "hi", organizationId: "org_1" })
    expect(r.success).toBe(false)
    expect(r.error).toContain("401")
    expect(r.deliveryUnknown).toBeUndefined()
  })

  it.each([408, 500, 502, 503, 504])(
    "CWL-5b: Chatwoot HTTP %i is ambiguous after dispatch",
    async (status) => {
      requestOutboundWebhookSpy.mockResolvedValue({
        ok: false,
        status,
        url: "https://app.chatwoot.com/messages",
        redirects: 0,
        bodyText: "upstream error",
      })
      const { sendChatwootMessage } = await import("../lib/chatwoot")

      const result = await sendChatwootMessage({ conversationId: "42", content: "hi", organizationId: "org_1" })

      expect(result).toMatchObject({ success: false, deliveryUnknown: true })
    },
  )

  it("CWL-6: path segments are URL-encoded (locks in the encode hardening)", async () => {
    db.config = { apiKey: "tok_abc", settings: { baseUrl: "https://app.chatwoot.com", accountId: "acc/1" } }
    const { sendChatwootMessage } = await import("../lib/chatwoot")
    await sendChatwootMessage({ conversationId: "a b/2", content: "hi", organizationId: "org_1" })
    const [url] = requestOutboundWebhookSpy.mock.calls[0]
    // reserved chars in accountId + conversationId must be percent-encoded, not split the path
    expect(url).toBe("https://app.chatwoot.com/api/v1/accounts/acc%2F1/conversations/a%20b%2F2/messages")
  })

  it("CWL-7: treats a bounded transport timeout as delivery-unknown", async () => {
    requestOutboundWebhookSpy.mockRejectedValue(new Error("Webhook request timed out"))
    const { sendChatwootMessage } = await import("../lib/chatwoot")

    await expect(sendChatwootMessage({ conversationId: "42", content: "hi", organizationId: "org_1" })).resolves.toEqual({
      success: false,
      error: "Chatwoot request timed out",
      deliveryUnknown: true,
    })
  })

  describe("CWL-9: an organization running two active Chatwoot accounts", () => {
    // The reason `channelConfigId` exists. `findFirst` with no id and no
    // orderBy returns whichever active chatwoot row the database hands back
    // first, so an unrouted send answers the customer from whichever account
    // that happens to be — the reply lands in the other inbox, signed with the
    // other token, and the thread the customer is looking at stays silent.
    // Two accounts on the hosted service is the ordinary shape of this: same
    // trusted host, different account id and different agent token, so a
    // mis-routed send is visible in both the URL and the header.
    const ACCOUNT_A: ChatwootConfigRow = {
      id: "cfg_a",
      organizationId: "org_1",
      channelType: "chatwoot",
      isActive: true,
      apiKey: "tok_a",
      settings: { baseUrl: "https://app.chatwoot.com", accountId: 111 },
    }
    const ACCOUNT_B: ChatwootConfigRow = {
      id: "cfg_b",
      organizationId: "org_1",
      channelType: "chatwoot",
      isActive: true,
      apiKey: "tok_b",
      settings: { baseUrl: "https://app.chatwoot.com", accountId: 222 },
    }

    beforeEach(() => {
      db.configs = [ACCOUNT_A, ACCOUNT_B]
    })

    it("sends on the config the conversation arrived on, not the first active one", async () => {
      const { sendChatwootMessage } = await import("../lib/chatwoot")

      const result = await sendChatwootMessage({
        conversationId: "42",
        content: "Salam",
        organizationId: "org_1",
        channelConfigId: ACCOUNT_B.id,
      })

      expect(result.success).toBe(true)
      const [url, opts] = requestOutboundWebhookSpy.mock.calls[0]
      expect(url).toBe("https://app.chatwoot.com/api/v1/accounts/222/conversations/42/messages")
      expect(opts.headers.api_access_token).toBe("tok_b")
    })

    it("an unrouted send still resolves an account — just not a chosen one", async () => {
      const { sendChatwootMessage } = await import("../lib/chatwoot")

      await sendChatwootMessage({ conversationId: "42", content: "Salam", organizationId: "org_1" })

      // Which account this lands on is not a guarantee. The real query has no
      // orderBy, so Postgres is free to return either row and the answer can
      // change between two identical requests; the fixture's array order only
      // makes that arbitrariness observable. What the assertion fixes is that
      // an omitted id resolves an account NOBODY picked — which is why the
      // caller-side suites assert the id is forwarded rather than trusting
      // this layer to guess right.
      const [url, opts] = requestOutboundWebhookSpy.mock.calls[0]
      expect(url).toContain(`/accounts/${ACCOUNT_A.settings.accountId}/`)
      expect(opts.headers.api_access_token).toBe(ACCOUNT_A.apiKey)
    })

    it("a config id belonging to another tenant sends nothing", async () => {
      db.configs = [ACCOUNT_A, { ...ACCOUNT_B, organizationId: "org_2" }]
      const { sendChatwootMessage } = await import("../lib/chatwoot")

      const result = await sendChatwootMessage({
        conversationId: "42",
        content: "Salam",
        organizationId: "org_1",
        channelConfigId: "cfg_b",
      })

      // The org predicate stays in the where alongside the id, so a stale or
      // foreign id resolves nothing instead of reading another tenant's token.
      expect(result).toMatchObject({ success: false, error: "Chatwoot not configured" })
      expect(requestOutboundWebhookSpy).not.toHaveBeenCalled()
    })

    it("an id naming a deactivated config sends nothing", async () => {
      db.configs = [ACCOUNT_A, { ...ACCOUNT_B, isActive: false }]
      const { sendChatwootMessage } = await import("../lib/chatwoot")

      const result = await sendChatwootMessage({
        conversationId: "42",
        content: "Salam",
        organizationId: "org_1",
        channelConfigId: ACCOUNT_B.id,
      })

      // Falling back to the org's other live account here would be worse than
      // failing: the operator turned this one off.
      expect(result.success).toBe(false)
      expect(requestOutboundWebhookSpy).not.toHaveBeenCalled()
    })
  })

  it("CWL-8: treats a transport exception after dispatch as delivery-unknown", async () => {
    requestOutboundWebhookSpy.mockRejectedValue(new TypeError("connection reset"))
    const { sendChatwootMessage } = await import("../lib/chatwoot")

    const result = await sendChatwootMessage({ conversationId: "42", content: "hi", organizationId: "org_1" })

    expect(result).toEqual({
      success: false,
      error: "Chatwoot transport result unknown",
      deliveryUnknown: true,
    })
  })
})
