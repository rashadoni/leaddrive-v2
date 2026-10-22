// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WhatsAppEmbeddedSignup } from "@/components/channels/whatsapp-embedded-signup"

const labels = {
  title: "Connect through Meta",
  description: "Choose your business number.",
  button: "Connect WhatsApp",
  working: "Finishing connection…",
  connected: "Connected: {number}",
  paymentHint: "Add a payment method in",
  cancelled: "Connection cancelled",
  failed: "Connection did not finish",
}
const sessionMessage = {
  type: "WA_EMBEDDED_SIGNUP",
  event: "FINISH",
  data: { waba_id: "111222333", phone_number_id: "444555666" },
}

describe("WhatsApp Embedded Signup registration result", () => {
  let container: HTMLDivElement
  let root: Root
  let loginCallback: ((response: { authResponse: { code: string } }) => void) | undefined
  const onConnected = vi.fn()

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    loginCallback = undefined
    onConnected.mockClear()
    window.FB = {
      init: vi.fn(),
      login: vi.fn((callback) => { loginCallback = callback }),
    }
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    delete window.FB
    vi.unstubAllGlobals()
  })

  async function start(postResult: Promise<Response>) {
    vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return postResult
      return Response.json({ configured: true, appId: "123456", configId: "456789" })
    }))
    await act(async () => root.render(createElement(WhatsAppEmbeddedSignup, { labels, onConnected })))
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click())
    expect(loginCallback).toBeTypeOf("function")
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { origin: "https://www.facebook.com", data: sessionMessage }))
      loginCallback!({ authResponse: { code: "ONE_TIME_CODE" } })
    })
  }

  it.each(["registered", "already_connected"])("completes a confirmed %s connection", async (registration) => {
    await start(Promise.resolve(Response.json({ ok: true, channelId: "channel-1", displayPhoneNumber: "+994501234567", registration })))
    expect(onConnected).toHaveBeenCalledExactlyOnceWith("channel-1")
    expect(container.textContent).toContain("Connected: +994501234567")
    expect(container.querySelector('a[href="https://business.facebook.com/wa/manage/home/"]')).not.toBeNull()
  })

  it.each([
    { body: { ok: false, step: "register", error: "Meta refused registration" }, status: 400, message: "Meta refused registration" },
    { body: { ok: true, channelId: "old-server-row", registration: "failed", registrationError: "Number verification is incomplete" }, status: 200, message: "Number verification is incomplete" },
    { body: { ok: true, channelId: "unconfirmed-row", registration: "pending" }, status: 200, message: labels.failed },
  ])("keeps the form open without a connected claim for $body.registration $body.step", async ({ body, status, message }) => {
    await start(Promise.resolve(Response.json(body, { status })))
    expect(onConnected).not.toHaveBeenCalled()
    expect(container.textContent).toContain(message)
    expect(container.textContent).not.toContain("Connected:")
    expect(container.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false)
    expect(container.querySelector("a")).toBeNull()
  })

  it("shows progress while the server is registering, then shows its failure without a success callback", async () => {
    let resolveResponse: (response: Response) => void = () => { throw new Error("Response resolver not initialized") }
    const pending = new Promise<Response>((resolve) => { resolveResponse = resolve })
    await start(pending)
    expect(container.textContent).toContain(labels.working)
    expect(container.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true)
    expect(onConnected).not.toHaveBeenCalled()
    await act(async () => resolveResponse(Response.json({ ok: false, step: "register", error: "Registration incomplete" }, { status: 400 })))
    expect(container.textContent).toContain("Registration incomplete")
    expect(container.textContent).not.toContain("Connected:")
    expect(onConnected).not.toHaveBeenCalled()
  })
})
