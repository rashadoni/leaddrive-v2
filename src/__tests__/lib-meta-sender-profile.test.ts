import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Instagram/Messenger webhooks carry only the page-scoped sender id, so the inbox showed
// "1318586653085202" where the customer's @username belongs (prod, 2026-09-11).

const mocks = vi.hoisted(() => ({ findConversation: vi.fn() }))

vi.mock("@/lib/prisma", () => ({
  prisma: { socialConversation: { findUnique: mocks.findConversation } },
}))

import { resolveMetaSenderName } from "@/lib/social/meta-sender-profile"

const fetchMock = vi.fn()
const base = {
  organizationId: "org-fanumsec",
  platform: "instagram" as const,
  senderId: "1318586653085202",
  token: "page-token",
  igLogin: false,
}

function graph(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "warn").mockImplementation(() => {})
  mocks.findConversation.mockResolvedValue(null)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("resolveMetaSenderName", () => {
  it("names a first-time Instagram sender by @username via the page token", async () => {
    fetchMock.mockResolvedValue(graph(200, { name: "Rashad", username: "rashad.az" }))

    await expect(resolveMetaSenderName(base)).resolves.toBe("@rashad.az")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://graph.facebook.com/v20.0/1318586653085202?fields=name,username")
    expect(init.headers).toEqual({ Authorization: "Bearer page-token" })
  })

  it("asks graph.instagram.com for an Instagram-Login channel", async () => {
    fetchMock.mockResolvedValue(graph(200, { username: "rashad.az" }))

    await expect(resolveMetaSenderName({ ...base, igLogin: true })).resolves.toBe("@rashad.az")
    expect(fetchMock.mock.calls[0][0]).toBe("https://graph.instagram.com/v21.0/1318586653085202?fields=name,username")
  })

  it("uses the Messenger display name for a Facebook sender", async () => {
    fetchMock.mockResolvedValue(graph(200, { name: "Rashad Rahimov" }))

    await expect(resolveMetaSenderName({ ...base, platform: "facebook" })).resolves.toBe("Rashad Rahimov")
    expect(fetchMock.mock.calls[0][0]).toBe("https://graph.facebook.com/v20.0/1318586653085202?fields=name")
  })

  it("keeps a name already on the conversation without calling Meta", async () => {
    mocks.findConversation.mockResolvedValue({ contactName: "@rashad.az" })

    await expect(resolveMetaSenderName(base)).resolves.toBe("@rashad.az")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("retries the lookup when the stored name is still the raw sender id", async () => {
    mocks.findConversation.mockResolvedValue({ contactName: "1318586653085202" })
    fetchMock.mockResolvedValue(graph(200, { username: "rashad.az" }))

    await expect(resolveMetaSenderName(base)).resolves.toBe("@rashad.az")
  })

  it.each([
    ["a Graph error", () => fetchMock.mockResolvedValue(graph(400, { error: { message: "no permission" } }))],
    ["a network failure", () => fetchMock.mockRejectedValue(new Error("ECONNRESET"))],
    ["an empty profile", () => fetchMock.mockResolvedValue(graph(200, {}))],
  ])("falls back to the sender id on %s", async (_label, arrange) => {
    arrange()
    await expect(resolveMetaSenderName(base)).resolves.toBe("1318586653085202")
  })

  it("logs Meta's error code and message, not just the HTTP status", async () => {
    fetchMock.mockResolvedValue(graph(400, {
      error: { message: "(#100) Missing feature", type: "OAuthException", code: 100, error_subcode: 2018218 },
    }))

    await expect(resolveMetaSenderName({ ...base, platform: "facebook" })).resolves.toBe("1318586653085202")
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("facebook lookup for sender 1318586653085202 failed (400) code=100 subcode=2018218 type=OAuthException: (#100) Missing feature"),
    )
  })

  it("names a Messenger sender from the conversation when Meta refuses the profile call", async () => {
    // Prod, 2026-09-21: every Messenger profile lookup came back 400. The page's conversation with the sender
    // carries the name in its participants and needs no extra permission.
    fetchMock
      .mockResolvedValueOnce(graph(400, { error: { message: "(#100) Missing feature", code: 100 } }))
      .mockResolvedValueOnce(graph(200, {
        data: [{ participants: { data: [
          { id: "373662722735767", name: "Lead Drive CRM" },
          { id: "1318586653085202", name: "Rashad Rahimov" },
        ] } }],
      }))

    await expect(
      resolveMetaSenderName({ ...base, platform: "facebook", accountId: "373662722735767" }),
    ).resolves.toBe("Rashad Rahimov")
    const url = new URL(String(fetchMock.mock.calls[1][0]))
    expect(url.origin + url.pathname).toBe("https://graph.facebook.com/v20.0/373662722735767/conversations")
    expect(Object.fromEntries(url.searchParams)).toEqual({ platform: "messenger", user_id: "1318586653085202", fields: "participants" })
    expect(fetchMock.mock.calls[1][1].headers).toEqual({ Authorization: "Bearer page-token" })
  })

  it("takes the Instagram @username from the participants, and asks the IG-Login graph for an IG-Login channel", async () => {
    fetchMock
      .mockResolvedValueOnce(graph(200, {}))
      .mockResolvedValueOnce(graph(200, { data: [{ participants: { data: [
        { id: "17841400000000000", username: "zeytun.pharma" },
        { id: "1318586653085202", username: "sev_mova" },
      ] } }] }))

    await expect(resolveMetaSenderName({ ...base, igLogin: true, accountId: "17841400000000000" })).resolves.toBe("@sev_mova")
    const url = new URL(String(fetchMock.mock.calls[1][0]))
    expect(url.origin + url.pathname).toBe("https://graph.instagram.com/v21.0/me/conversations")
    expect(url.searchParams.get("platform")).toBe("instagram")
  })

  it("keeps the sender id when the conversation has no matching participant either", async () => {
    fetchMock
      .mockResolvedValueOnce(graph(400, { error: { message: "nope" } }))
      .mockResolvedValueOnce(graph(200, { data: [{ participants: { data: [{ id: "someone-else", name: "Other" }] } }] }))

    await expect(
      resolveMetaSenderName({ ...base, platform: "facebook", accountId: "373662722735767" }),
    ).resolves.toBe("1318586653085202")
  })

  it("falls back to the sender id when the channel has no token", async () => {
    await expect(resolveMetaSenderName({ ...base, token: null })).resolves.toBe("1318586653085202")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("still names the sender when the conversation read itself fails", async () => {
    mocks.findConversation.mockRejectedValue(new Error("db down"))
    fetchMock.mockResolvedValue(graph(200, { username: "rashad.az" }))

    await expect(resolveMetaSenderName(base)).resolves.toBe("@rashad.az")
  })
})
