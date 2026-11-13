import { afterEach, describe, expect, it, vi } from "vitest"
import { registerPush } from "@/lib/push-client"

const SUBSCRIPTION = { toJSON: () => ({ endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } }) }

function browser(existing: typeof SUBSCRIPTION | null) {
  const subscribe = vi.fn(async () => SUBSCRIPTION)
  const urls: string[] = []
  vi.stubGlobal("window", { PushManager: class {}, Notification: { permission: "granted" } })
  vi.stubGlobal("Notification", { permission: "granted" })
  vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: async () => existing, subscribe } }) } })
  vi.stubGlobal("atob", (value: string) => Buffer.from(value, "base64").toString("binary"))
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url)
    return new Response(JSON.stringify(url.includes("vapid-key") ? { success: true, data: { publicKey: "AQID" } } : { success: true }), { status: 200 })
  }))
  return { subscribe, urls }
}

afterEach(() => vi.unstubAllGlobals())

/**
 * The server's public key is needed only to create a subscription. A browser that already had
 * one asked for it on every page load (prod, 2026-11-13) and threw the answer away.
 */
describe("the push key is fetched only when a subscription has to be made", () => {
  it("a browser that is already subscribed registers without asking for the key", async () => {
    const { subscribe, urls } = browser(SUBSCRIPTION)
    expect(await registerPush()).toEqual({ ok: true })
    expect(urls).toEqual(["/api/v1/push/subscribe"])
    expect(subscribe).not.toHaveBeenCalled()
  })

  it("a browser without a subscription asks for the key, subscribes, then registers", async () => {
    const { subscribe, urls } = browser(null)
    expect(await registerPush()).toEqual({ ok: true })
    expect(urls).toEqual(["/api/v1/push/vapid-key", "/api/v1/push/subscribe"])
    expect(subscribe).toHaveBeenCalledOnce()
  })

  it("no key from the server — no subscription and nothing registered", async () => {
    const { subscribe } = browser(null)
    const urls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { urls.push(url); return new Response(JSON.stringify({ success: false }), { status: 503 }) }))
    expect(await registerPush()).toEqual({ ok: false, error: "no-vapid-key" })
    expect(urls).toEqual(["/api/v1/push/vapid-key"])
    expect(subscribe).not.toHaveBeenCalled()
  })
})
