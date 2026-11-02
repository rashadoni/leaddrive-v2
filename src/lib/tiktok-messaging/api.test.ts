import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { exchangeMessagingCode, refreshMessagingToken, sendMessagingText, verifyMessagingGrant } from "./api"
const request = vi.fn()
beforeEach(() => {
  vi.stubGlobal("fetch", request); request.mockReset()
  vi.stubEnv("TIKTOK_MESSAGING_CLIENT_ID", "app1"); vi.stubEnv("TIKTOK_MESSAGING_CLIENT_SECRET", "fixture-secret")
  vi.stubEnv("TIKTOK_MESSAGING_AUTHORIZATION_URL", "https://www.tiktok.com/auth/authorize/")
  vi.stubEnv("TIKTOK_MESSAGING_REDIRECT_URI", "https://crm.example/api/v1/channels/tiktok-messaging/oauth/callback/")
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data }), { status: 200 })
const grant = { access_token: "access-fixture", refresh_token: "refresh-fixture", open_id: "account1", expires_in: 86400, refresh_token_expires_in: 100000, scope: "message.list.read,message.list.send,message.list.manage,user.account.type" }

describe("TikTok API contract", () => {
  it("exchanges callback code and respects the returned refresh expiry", async () => {
    request.mockResolvedValueOnce(ok(grant))
    expect(await exchangeMessagingCode("one-time-code")).toMatchObject({ openId: "account1", refreshExpiresIn: 100000 })
    const [url, options] = request.mock.calls[0]
    expect(url).toBe("https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/token/")
    expect(JSON.parse(options.body)).toMatchObject({ grant_type: "authorization_code", auth_code: "one-time-code", redirect_uri: "https://crm.example/api/v1/channels/tiktok-messaging/oauth/callback/" })
    expect(options.redirect).toBe("error")
    request.mockResolvedValueOnce(ok({ ...grant, refresh_token: "rotated", refresh_token_expires_in: 90000 }))
    expect(await refreshMessagingToken("old")).toMatchObject({ refreshToken: "rotated", refreshExpiresIn: 90000 })
  })
  it("rejects incomplete tokens and cross-app/account token-info", async () => {
    request.mockResolvedValueOnce(ok({ ...grant, refresh_token_expires_in: undefined }))
    await expect(exchangeMessagingCode("code")).rejects.toMatchObject({ reason: "tiktok_invalid_token_response" })
    request.mockResolvedValueOnce(ok({ app_id: "app1", creator_id: "someone-else", scope: grant.scope }))
    await expect(verifyMessagingGrant("access", "account1")).rejects.toMatchObject({ reason: "tiktok_account_binding_mismatch" })
  })
  it("sends native text to an opaque conversation and reads nested message ID", async () => {
    request.mockResolvedValueOnce(ok({ message: { message_id: "m1" } }))
    expect(await sendMessagingText("access", "account1", "opaque+id=", "Hello")).toBe("m1")
    const [url, options] = request.mock.calls[0]
    expect(url).toContain("/business/message/send/")
    expect(JSON.parse(options.body)).toEqual({ business_id: "account1", recipient_type: "CONVERSATION", recipient: "opaque+id=", message_type: "TEXT", text: { body: "Hello" } })
  })
  it("distinguishes explicit rejection from an uncertain send, never automatically retries", async () => {
    for (const response of [new Response("oops", { status: 503 }), ok({}), new Response("not-json", { status: 200 })]) {
      request.mockResolvedValueOnce(response)
      await expect(sendMessagingText("a", "b", "c", "Hello")).rejects.toMatchObject({ deliveryUnknown: true })
    }
    request.mockRejectedValueOnce(new Error("timeout"))
    await expect(sendMessagingText("a", "b", "c", "Hello")).rejects.toMatchObject({ deliveryUnknown: true })
    request.mockResolvedValueOnce(new Response(JSON.stringify({ code: 40001 }), { status: 400 }))
    await expect(sendMessagingText("a", "b", "c", "Hello")).rejects.toMatchObject({ deliveryUnknown: false })
    expect(request).toHaveBeenCalledTimes(5)
  })
})
