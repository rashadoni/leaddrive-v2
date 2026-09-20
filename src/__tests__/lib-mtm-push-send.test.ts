import { afterEach, describe, expect, it, vi } from "vitest"
import { generateKeyPairSync } from "node:crypto"
import {
  pushConfigured,
  pushServiceAccount,
  resetPushAccessToken,
  sendPushMessages,
  serviceAccountAssertion,
  shouldRetireToken,
} from "@/lib/mtm/push-send"

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
})

const account = {
  projectId: "leaddrive-mtm",
  clientEmail: "push@leaddrive-mtm.iam.gserviceaccount.com",
  privateKey,
}

function okResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

afterEach(() => {
  resetPushAccessToken()
  vi.restoreAllMocks()
})

describe("push configuration", () => {
  /**
   * A production that tries to deliver into a service it cannot authenticate
   * with looks like a delivery problem for weeks. Off is off, and it says so.
   */
  it("is off until a service account is in the environment", () => {
    expect(pushConfigured({} as NodeJS.ProcessEnv)).toBe(false)
    expect(pushServiceAccount({ MTM_PUSH_SERVICE_ACCOUNT: "not json" } as NodeJS.ProcessEnv)).toBeNull()
    expect(pushServiceAccount({ MTM_PUSH_SERVICE_ACCOUNT: JSON.stringify({ project_id: "p" }) } as NodeJS.ProcessEnv)).toBeNull()
  })

  it("unescapes the private key the way secret stores hand it back", () => {
    const parsed = pushServiceAccount({
      MTM_PUSH_SERVICE_ACCOUNT: JSON.stringify({
        project_id: "leaddrive-mtm",
        client_email: "push@x.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
      }),
    } as NodeJS.ProcessEnv)
    expect(parsed?.privateKey).toContain("\n")
    expect(parsed?.privateKey).not.toContain("\\n")
  })

  it("signs an assertion for the messaging scope only", () => {
    const assertion = serviceAccountAssertion(account, Date.parse("2026-09-20T18:00:00.000Z"))
    const [, claims] = assertion.split(".")
    const decoded = JSON.parse(Buffer.from(claims, "base64url").toString())
    expect(decoded).toMatchObject({
      iss: account.clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
    })
    expect(decoded.exp - decoded.iat).toBe(3600)
  })
})

describe("what a push carries", () => {
  it("sends a title, a body and routing hints — and nothing about the customer", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url).includes("oauth2")) return okResponse({ access_token: "access-1" })
      return okResponse({ name: "projects/leaddrive-mtm/messages/1" })
    }) as unknown as typeof fetch

    const deliveries = await sendPushMessages({
      account,
      fetchImpl,
      messages: [{ token: "device-token-1", title: "Новое сообщение", body: "Менеджер написал команде", data: { target: "Messages" } }],
    })

    expect(deliveries).toEqual([{ token: "device-token-1", ok: true }])
    const send = calls.find((call) => call.url.includes("messages:send"))
    expect(send?.url).toBe("https://fcm.googleapis.com/v1/projects/leaddrive-mtm/messages:send")
    const payload = JSON.parse(String(send?.init.body))
    expect(payload.message).toMatchObject({
      token: "device-token-1",
      notification: { title: "Новое сообщение", body: "Менеджер написал команде" },
      data: { target: "Messages" },
    })
  })

  it("asks Google for one access token and reuses it across messages", async () => {
    let tokenCalls = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("oauth2")) {
        tokenCalls += 1
        return okResponse({ access_token: "access-1" })
      }
      return okResponse({ name: "ok" })
    }) as unknown as typeof fetch

    await sendPushMessages({
      account,
      fetchImpl,
      messages: [
        { token: "t1", title: "a", body: "b" },
        { token: "t2", title: "a", body: "b" },
      ],
    })
    expect(tokenCalls).toBe(1)
  })
})

describe("when delivery fails", () => {
  it("tells a dead address apart from a bad minute", () => {
    expect(shouldRetireToken(404, "")).toBe(true)
    expect(shouldRetireToken(400, '{"error":{"status":"INVALID_ARGUMENT"}}')).toBe(true)
    expect(shouldRetireToken(403, "SENDER_ID_MISMATCH")).toBe(true)
    expect(shouldRetireToken(500, "internal")).toBe(false)
    expect(shouldRetireToken(429, "quota")).toBe(false)
  })

  it("reports a retirable failure per token instead of throwing", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("oauth2")) return okResponse({ access_token: "access-1" })
      return okResponse({ error: { status: "UNREGISTERED" } }, 404)
    }) as unknown as typeof fetch

    const deliveries = await sendPushMessages({ account, fetchImpl, messages: [{ token: "dead", title: "a", body: "b" }] })
    expect(deliveries).toEqual([{ token: "dead", ok: false, retire: true, error: "HTTP_404" }])
  })

  it("keeps the token when the network is the problem", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("oauth2")) return okResponse({ access_token: "access-1" })
      throw new Error("socket hang up")
    }) as unknown as typeof fetch

    const deliveries = await sendPushMessages({ account, fetchImpl, messages: [{ token: "t1", title: "a", body: "b" }] })
    expect(deliveries).toEqual([{ token: "t1", ok: false, retire: false, error: "NETWORK" }])
  })

  it("does nothing at all when push is not configured", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    expect(await sendPushMessages({ account: null, fetchImpl, messages: [{ token: "t1", title: "a", body: "b" }] })).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
