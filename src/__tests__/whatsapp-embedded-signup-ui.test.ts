// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WhatsAppEmbeddedSignup } from "@/components/channels/whatsapp-embedded-signup"

const labels = {
  title: "Connect through Meta",
  description: "Choose your business number.",
  working: "Finishing connection…",
  connected: "Connected: {number}",
  paymentHint: "Add a payment method in",
  cancelled: "Connection cancelled",
  failed: "Connection did not finish",
  keepAppButton: "Keep my WhatsApp Business app",
  keepAppHint: "The number keeps working on your phone.",
  moveButton: "Move the number to the API",
  moveHint: "The app stops working with this number.",
  agentBlockedHint: "If Meta says its AI agent holds this number, turn the agent off on your phone.",
  offboardingHint: "If Meta says the account is being released, wait a few minutes and press again.",
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
    // These cases run the dialog in place, as on the app host; tenant hosts are covered in
    // whatsapp-signup-window-ui.test.ts.
    process.env.NEXT_PUBLIC_APP_URL = window.location.origin
    window.FB = {
      init: vi.fn(),
      login: vi.fn((callback) => { loginCallback = callback }),
    }
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    delete window.FB
    delete process.env.NEXT_PUBLIC_APP_URL
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
    // What to do about Meta's refusals is troubleshooting for the step that just succeeded, not a
    // standing instruction: a finished connection says nothing about turning agents off.
    expect(container.textContent).not.toContain(labels.agentBlockedHint)
    expect(container.textContent).not.toContain(labels.offboardingHint)
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

describe("the choice the customer is given when connecting", () => {
  let container: HTMLDivElement
  let root: Root
  let loginOptions: Record<string, unknown> | undefined

  beforeEach(async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    loginOptions = undefined
    process.env.NEXT_PUBLIC_APP_URL = window.location.origin
    window.FB = {
      init: vi.fn(),
      login: vi.fn((_cb: unknown, options: Record<string, unknown>) => { loginOptions = options }),
    } as unknown as typeof window.FB
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ configured: true, appId: "123456", configId: "456789" })))
    await act(async () => root.render(createElement(WhatsAppEmbeddedSignup, { labels })))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("offers keeping the app first, and says what each path costs", () => {
    const buttons = Array.from(container.querySelectorAll("button")).map((b) => b.textContent)

    // Order is the message: for a shop run by one person, losing their WhatsApp ends the
    // conversation before anything is demonstrated, so that path is not the default.
    expect(buttons[0]).toContain(labels.keepAppButton)
    expect(buttons[1]).toContain(labels.moveButton)
    // Neither choice is made silently: both consequences are on screen.
    expect(container.textContent).toContain(labels.keepAppHint)
    expect(container.textContent).toContain(labels.moveHint)
  })

  it("names Meta's two refusals, on the same screen but after the choice", () => {
    // Meta refuses inside its own popup, in its own wording, and hands the dialog no code — so the
    // customer comes back to this screen with the refusal still on theirs, and both answers have
    // to be plainly on it, not folded away. They follow the buttons rather than lead them: this is
    // for the few who were refused, and everyone else should meet the choice first.
    const text = container.textContent || ""
    expect(text).toContain(labels.agentBlockedHint)
    expect(text).toContain(labels.offboardingHint)
    const buttons = Array.from(container.querySelectorAll("button"))
    expect(buttons).toHaveLength(2)
    expect(text.indexOf(labels.agentBlockedHint)).toBeGreaterThan(text.indexOf(buttons[1].textContent || ""))
  })

  it("asks Meta for the WhatsApp Business app path only on the first button", async () => {
    await act(async () => container.querySelectorAll<HTMLButtonElement>("button")[0].click())

    // Meta's one switch for coexistence. Without it the dialog only offers to take the number away.
    expect((loginOptions?.extras as Record<string, unknown>).featureType).toBe("whatsapp_business_app_onboarding")
  })

  it("does not ask for it on the second button, so a pure-API connection is unchanged", async () => {
    await act(async () => container.querySelectorAll<HTMLButtonElement>("button")[1].click())

    expect(loginOptions?.extras as Record<string, unknown>).not.toHaveProperty("featureType")
    // The session info version this page's reader depends on is still requested.
    expect((loginOptions?.extras as Record<string, unknown>).sessionInfoVersion).toBe("3")
  })
})
