// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WhatsAppEmbeddedSignup } from "@/components/channels/whatsapp-embedded-signup"
import { WhatsAppSignupWindow } from "@/components/channels/whatsapp-signup-window"
import { WHATSAPP_SIGNUP_RELAY_TYPE } from "@/lib/whatsapp-signup-window"

// zeytun.leaddrivecrm.org, 2026-10-26: Meta refused to start its SDK there («Неизвестный домен
// размещения JSSDK») — only app.leaddrivecrm.org is on the app's allowed-domains list. A tenant host now
// runs the dialog in a window on the app host and finishes the connection with the result it posts back.

const APP = "https://app.leaddrivecrm.org"
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
const relayed = {
  type: WHATSAPP_SIGNUP_RELAY_TYPE,
  result: "connected",
  code: "ONE_TIME_CODE",
  wabaId: "111222333",
  phoneNumberId: "444555666",
  businessId: null,
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete window.FB
  delete process.env.NEXT_PUBLIC_APP_URL
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("channel catalog on a tenant host", () => {
  let popupFrame: HTMLIFrameElement
  let popup: Window
  const onConnected = vi.fn()
  const fetchMock = vi.fn()

  beforeEach(() => {
    // The test page (jsdom's origin) plays the tenant host; the app host is elsewhere.
    process.env.NEXT_PUBLIC_APP_URL = APP
    popupFrame = document.createElement("iframe")
    document.body.appendChild(popupFrame)
    popup = popupFrame.contentWindow!
    vi.spyOn(window, "open").mockReturnValue(popup)
    window.FB = { init: vi.fn(), login: vi.fn() }
    onConnected.mockClear()
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Response.json({ ok: true, channelId: "channel-1", displayPhoneNumber: "+994501234567", registration: "registered" })
      }
      return Response.json({ configured: true, appId: "123456", configId: "456789" })
    })
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => popupFrame.remove())

  async function clickTile() {
    await act(async () => root.render(createElement(WhatsAppEmbeddedSignup, { labels, onConnected })))
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click())
  }

  it("opens the app-host window instead of loading Meta's SDK here", async () => {
    await clickTile()

    expect(window.FB!.login).not.toHaveBeenCalled()
    const opened = new URL(String(vi.mocked(window.open).mock.calls[0][0]))
    expect(opened.origin).toBe(APP)
    expect(opened.pathname).toBe("/connect/whatsapp")
    expect(opened.searchParams.get("origin")).toBe(window.location.origin)
    expect(container.textContent).toContain(labels.working)
  })

  it("finishes the connection on this host with the code the window posts back", async () => {
    await clickTile()
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { origin: APP, data: relayed, source: popup }))
    })

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")
    expect(post?.[0]).toBe("/api/v1/channels/whatsapp/embedded-signup")
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      code: "ONE_TIME_CODE", wabaId: "111222333", phoneNumberId: "444555666", businessId: null,
    })
    expect(onConnected).toHaveBeenCalledExactlyOnceWith("channel-1")
    expect(container.textContent).toContain("Connected: +994501234567")
  })

  it("ignores a lookalike message from another origin or another window", async () => {
    await clickTile()
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { origin: "https://evil.example", data: relayed, source: popup }))
      window.dispatchEvent(new MessageEvent("message", { origin: APP, data: relayed, source: window }))
    })

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false)
    expect(container.textContent).toContain(labels.working)
  })

  it("reports a cancelled connection when the window is closed without a result", async () => {
    vi.useFakeTimers()
    await clickTile()
    Object.defineProperty(popup, "closed", { configurable: true, get: () => true })
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(container.textContent).toContain(labels.cancelled)
    expect(container.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false)
  })
})

describe("signup window on the app host", () => {
  const windowLabels = {
    title: "Connect WhatsApp",
    description: "Meta will ask you to sign in.",
    button: "Continue with Facebook",
    working: "Waiting for Meta…",
    done: "Done",
    cancelled: "Closed before the end",
    failed: "Did not finish",
    notFromCatalog: "Open this from the CRM",
    notConfigured: "Not available",
  }
  const RETURN = "https://zeytun.leaddrivecrm.org"
  let loginCallback: ((response: { authResponse: { code: string } | null }) => void) | undefined
  const opener = { postMessage: vi.fn(), closed: false }

  beforeEach(() => {
    loginCallback = undefined
    opener.postMessage.mockClear()
    window.FB = { init: vi.fn(), login: vi.fn((callback) => { loginCallback = callback }) }
    Object.defineProperty(window, "opener", { configurable: true, writable: true, value: opener })
    vi.spyOn(window, "close").mockImplementation(() => {})
  })

  afterEach(() => {
    Object.defineProperty(window, "opener", { configurable: true, writable: true, value: null })
  })

  async function render(returnOrigin: string | null) {
    await act(async () => root.render(createElement(WhatsAppSignupWindow, {
      config: { appId: "123456", configId: "456789" },
      returnOrigin,
      labels: windowLabels,
    })))
  }

  it("runs Meta's dialog on a click and hands code and number only to the tenant origin", async () => {
    await render(RETURN)
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click())
    expect(loginCallback).toBeTypeOf("function")
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: "https://www.facebook.com",
        data: { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "111222333", phone_number_id: "444555666" } },
      }))
      loginCallback!({ authResponse: { code: "ONE_TIME_CODE" } })
    })

    expect(opener.postMessage).toHaveBeenCalledExactlyOnceWith(
      { type: WHATSAPP_SIGNUP_RELAY_TYPE, result: "connected", code: "ONE_TIME_CODE", wabaId: "111222333", phoneNumberId: "444555666", businessId: null },
      RETURN,
    )
    expect(window.close).toHaveBeenCalled()
  })

  it("tells the tenant tab when the customer closes Meta's dialog", async () => {
    await render(RETURN)
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click())
    await act(async () => loginCallback!({ authResponse: null }))

    expect(opener.postMessage).toHaveBeenCalledExactlyOnceWith({ type: WHATSAPP_SIGNUP_RELAY_TYPE, result: "cancel" }, RETURN)
    expect(container.textContent).toContain(windowLabels.cancelled)
  })

  it("offers no button when the opening origin was refused", async () => {
    await render(null)
    expect(container.querySelector("button")).toBeNull()
    expect(container.textContent).toContain(windowLabels.notFromCatalog)
    expect(window.FB!.login).not.toHaveBeenCalled()
  })
})
