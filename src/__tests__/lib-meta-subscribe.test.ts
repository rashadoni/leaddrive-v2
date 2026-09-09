import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Meta page → app webhook subscription for inbox DMs (FB/IG multi-tenant). The token must go in the
 * POST body (never the URL) so it can't leak into logs.
 */
const fetchMock = vi.fn()
global.fetch = fetchMock as unknown as typeof fetch

import { subscribePageToMessages } from "@/lib/social/meta-subscribe"

beforeEach(() => vi.clearAllMocks())

describe("subscribePageToMessages", () => {
  it("POSTs to /{pageId}/subscribed_apps with messages fields + the token in the BODY (not the URL)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true }) })
    const r = await subscribePageToMessages("PAGE123", "PAGE_TOKEN")
    expect(r.success).toBe(true)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(String(url)).toContain("/PAGE123/subscribed_apps")
    expect(String(url)).not.toContain("PAGE_TOKEN") // token must NOT be in the URL
    const body = String((opts as { body: URLSearchParams }).body)
    expect(body).toContain("subscribed_fields=messages")
    expect(body).toContain("access_token=PAGE_TOKEN")
  })

  it("returns failure on a Meta API error", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { message: "Invalid OAuth token" } }) })
    const r = await subscribePageToMessages("P", "T")
    expect(r.success).toBe(false)
    expect(r.error).toContain("Invalid OAuth token")
  })

  it("returns failure when the body reports success:false", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: false }) })
    expect((await subscribePageToMessages("P", "T")).success).toBe(false)
  })

  it("no-ops (no fetch) without a pageId or token", async () => {
    expect((await subscribePageToMessages("", "T")).success).toBe(false)
    expect((await subscribePageToMessages("P", "")).success).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("never throws on a network error → fail-soft", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"))
    expect((await subscribePageToMessages("P", "T")).success).toBe(false)
  })
})
