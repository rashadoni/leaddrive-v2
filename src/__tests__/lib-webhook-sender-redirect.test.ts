/**
 * Slice 7a hardening (2026-06-08): webhook senders must NOT follow redirects.
 * A 30x from an allowlisted host to an internal IP would bypass the pre-flight
 * SSRF guard (assertSafeWebhookUrl validates only the original URL). Both senders
 * pass redirect:"error" to fetch + reject non-allowlisted hosts before fetching.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { sendSlackNotification } from "@/lib/slack"
import { sendTeamsNotification } from "@/lib/integrations/teams"

const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({ ok: true })
})

describe("webhook senders — redirect SSRF hardening", () => {
  it("sendSlackNotification calls fetch with redirect:'error'", async () => {
    await sendSlackNotification("https://hooks.slack.com/services/T/B/x", { text: "hi" })
    expect(mockFetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/T/B/x",
      expect.objectContaining({ redirect: "error" }),
    )
  })

  it("sendTeamsNotification calls fetch with redirect:'error'", async () => {
    await sendTeamsNotification("https://acme.webhook.office.com/webhookb2/x", { summary: "hi" })
    expect(mockFetch).toHaveBeenCalledWith(
      "https://acme.webhook.office.com/webhookb2/x",
      expect.objectContaining({ redirect: "error" }),
    )
  })

  it("rejects a non-allowlisted host before fetching (SSRF guard, returns false)", async () => {
    expect(await sendSlackNotification("https://evil.com/x", { text: "hi" })).toBe(false)
    expect(await sendTeamsNotification("https://evil.attacker.com/x", { summary: "hi" })).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
