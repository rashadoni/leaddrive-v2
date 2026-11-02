import { createHmac } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const m = vi.hoisted(() => ({ ingest: vi.fn() }))
vi.mock("@/lib/tiktok-messaging/ingest", () => ({ ingestMessagingInbound: m.ingest }))
import { POST } from "./route"

const now = 1_800_000_000_000
const secret = "fixture-only-webhook-secret"
const inner = {
  from: "Customer", conversation_id: "opaque-conversation", message_id: "message1", timestamp: now,
  from_user: { role: "personal_account", id: "person1" },
  to_user: { role: "business_account", id: "business1" }, type: "text", text: { body: "Hello" },
}
const envelope = { client_key: "app1", event: "im_receive_msg", user_openid: "business1", content: JSON.stringify(inner) }
const signature = (value: unknown, timestamp = now / 1000) =>
  `t=${timestamp},s=${createHmac("sha256", secret).update(`${timestamp}.${JSON.stringify(value)}`).digest("hex")}`
const request = (value: unknown, header?: string) => new NextRequest("https://crm.example/api/v1/webhooks/tiktok-messaging", {
  method: "POST", body: JSON.stringify(value), headers: header ? { "tiktok-signature": header } : {},
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(Date, "now").mockReturnValue(now)
  vi.stubEnv("TIKTOK_MESSAGING_CLIENT_ID", "app1")
  vi.stubEnv("TIKTOK_MESSAGING_CLIENT_SECRET", secret)
  vi.stubEnv("TIKTOK_MESSAGING_AUTHORIZATION_URL", "https://www.tiktok.com/auth/authorize/")
  vi.stubEnv("TIKTOK_MESSAGING_REDIRECT_URI", "https://crm.example/api/v1/channels/tiktok-messaging/oauth/callback/")
  vi.stubEnv("NEXTAUTH_SECRET", "fixture-only-installation-secret")
  m.ingest.mockResolvedValue(undefined)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe("native TikTok public webhook boundary", () => {
  it("rejects missing, tampered and stale signatures before tenant ingestion", async () => {
    expect((await POST(request(envelope))).status).toBe(401)
    expect((await POST(request({ ...envelope, user_openid: "another" }, signature(envelope)))).status).toBe(401)
    expect((await POST(request(envelope, signature(envelope, now / 1000 - 301)))).status).toBe(401)
    expect(m.ingest).not.toHaveBeenCalled()
  })

  it("rejects another signed app and ignores a recipient that does not match the signed account", async () => {
    const wrongApp = { ...envelope, client_key: "another-app" }
    expect((await POST(request(wrongApp, signature(wrongApp)))).status).toBe(401)
    const wrongRecipient = { ...envelope, content: JSON.stringify({ ...inner, to_user: { role: "business_account", id: "another-business" } }) }
    const response = await POST(request(wrongRecipient, signature(wrongRecipient)))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, ignored: true })
    expect(m.ingest).not.toHaveBeenCalled()
  })

  it("routes only the verified business identity and acknowledges a durable write", async () => {
    const response = await POST(request(envelope, signature(envelope)))
    expect(response.status).toBe(200)
    expect(m.ingest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      businessId: "business1", conversationId: "opaque-conversation", senderId: "person1", body: "Hello",
    }), "app1")
  })

  it("does not acknowledge a failed durable write or expose its error", async () => {
    m.ingest.mockRejectedValueOnce(new Error("private database detail"))
    const response = await POST(request(envelope, signature(envelope)))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain("private database detail")
  })

  it("fails closed without configured credentials and bounds chunked request bodies", async () => {
    vi.stubEnv("TIKTOK_MESSAGING_CLIENT_SECRET", "")
    expect((await POST(request(envelope, signature(envelope)))).status).toBe(503)
    vi.stubEnv("TIKTOK_MESSAGING_CLIENT_SECRET", secret)
    const oversized = new NextRequest("https://crm.example/api/v1/webhooks/tiktok-messaging", {
      method: "POST", body: "x".repeat(1_048_577),
    })
    expect((await POST(oversized)).status).toBe(413)
    expect(m.ingest).not.toHaveBeenCalled()
  })
})
