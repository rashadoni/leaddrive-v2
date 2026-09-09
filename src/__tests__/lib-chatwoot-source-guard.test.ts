import { describe, expect, it, vi } from "vitest"
import { chatwootSourceStillUnanswered } from "@/lib/inbox/chatwoot-source-guard"

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function input(fetcher: typeof fetch) {
  return {
    organizationId: "org-1",
    channelConfigId: "config-1",
    channelSettings: {
      baseUrl: "https://app.chatwoot.com",
      accountId: "account-1",
      inboxId: "inbox-1",
    },
    chatwootConversationId: "42",
    chatwootInboxId: "inbox-1",
    inboundProviderMessageIds: [103],
    db: {
      channelConfig: {
        findFirst: vi.fn().mockResolvedValue({ apiKey: "token" }),
      },
    } as never,
    fetcher,
  }
}

describe("Chatwoot source pre-send guard", () => {
  it("fails closed when Chatwoot has a later non-failed outgoing reply", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: 42,
        account_id: "account-1",
        inbox_id: "inbox-1",
        status: "open",
        can_reply: true,
      }))
      .mockResolvedValueOnce(jsonResponse({
        payload: [{ id: 104, message_type: "outgoing", status: "sent", private: false }],
      })) as unknown as typeof fetch

    await expect(chatwootSourceStillUnanswered(input(fetcher))).resolves.toBe(false)
  })

  it("allows the exact open source conversation when no later outgoing exists", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: 42,
        account_id: "account-1",
        inbox_id: "inbox-1",
        status: "open",
        can_reply: true,
      }))
      .mockResolvedValueOnce(jsonResponse({
        payload: [
          { id: 103, message_type: "incoming", status: "delivered", private: false },
          { id: 104, message_type: "outgoing", status: "failed", private: false },
        ],
      })) as unknown as typeof fetch

    await expect(chatwootSourceStillUnanswered(input(fetcher))).resolves.toBe(true)
  })
})
