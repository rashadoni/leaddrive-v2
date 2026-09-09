// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  prepareBrowserAudio: vi.fn(),
  connectBrowserCall: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}))

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) =>
    createElement("a", { href }, children),
}))

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: {
    children?: ReactNode
    variant?: string
    size?: string
    [key: string]: unknown
  }) => {
    void _variant
    void _size
    return createElement("button", props, children)
  },
}))

vi.mock("@/components/inbox/whatsapp-call-controls", () => ({
  WhatsAppCallControls: () => null,
}))

vi.mock("@/lib/voip/browser-call-audio", () => ({
  prepareBrowserAudio: mocks.prepareBrowserAudio,
  connectBrowserCall: mocks.connectBrowserCall,
}))

import { IncomingCallPopup } from "@/components/incoming-call-popup"

const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
const prepared = { dispose: vi.fn() }
const handle = { hangUp: vi.fn(), isConnected: vi.fn(() => false) }

const call = {
  id: "call-1",
  callSid: "d9539247-9f92-4fc5-a926-758535082d04",
  direction: "inbound",
  fromNumber: "+994501234567",
  toNumber: "100",
  contactId: null,
  contact: null,
  leadId: "lead-1",
  lead: { contactName: "Inbound Lead", companyName: "Acme" },
  status: "ringing",
  provider: "asterisk",
}

describe("incoming Asterisk browser answer", () => {
  let container: HTMLDivElement
  let root: Root
  let connectionOptions: {
    onConnected?: () => void
    onMediaStarted?: () => void
    onEnded?: (reason: string) => void
  } | null
  let requests: Array<{ url: string; method: string; body: unknown }>

  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    connectionOptions = null
    requests = []
    mocks.prepareBrowserAudio.mockResolvedValue(prepared)
    mocks.connectBrowserCall.mockImplementation((_audio, options) => {
      connectionOptions = options
      return handle
    })
    vi.stubGlobal("isSecureContext", true)
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => stream),
      },
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || "GET"
      requests.push({
        url,
        method,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      })
      if (method === "POST") {
        return new Response(JSON.stringify({
          success: true,
          relayUrl: "wss://relay.example/browser",
          parkTicket: "ticket.signature",
          claimToken: "11111111-1111-4111-8111-111111111111",
        }), { status: 200, headers: { "content-type": "application/json" } })
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function render() {
    await act(async () => {
      root.render(createElement(IncomingCallPopup, {
        call,
        browserCallsEnabled: true,
        onDismiss: vi.fn(),
        onChanged: vi.fn(),
      }))
    })
  }

  async function answer() {
    const button = Array.from(container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.includes("inboundCallAnswer"))
    expect(button).toBeTruthy()
    await act(async () => {
      button?.click()
    })
    await vi.waitFor(() => expect(mocks.connectBrowserCall).toHaveBeenCalledTimes(1))
  }

  it("prepares audio before claiming and distinguishes parked from live media", async () => {
    const order: string[] = []
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementationOnce(async () => {
      order.push("microphone")
      return stream
    })
    mocks.prepareBrowserAudio.mockImplementationOnce(async () => {
      order.push("audio")
      return prepared
    })
    vi.mocked(fetch).mockImplementationOnce(async () => {
      order.push("claim")
      requests.push({ url: "/api/v1/calls/call-1/browser-answer", method: "POST", body: null })
      return new Response(JSON.stringify({
        success: true,
        relayUrl: "wss://relay.example/browser",
        parkTicket: "ticket.signature",
        claimToken: "11111111-1111-4111-8111-111111111111",
      }), { status: 200, headers: { "content-type": "application/json" } })
    })

    await render()
    await answer()

    expect(order).toEqual(["microphone", "audio", "claim"])
    expect(mocks.connectBrowserCall).toHaveBeenCalledWith(prepared, expect.objectContaining({
      relayUrl: "wss://relay.example/browser",
      ticket: "ticket.signature",
      onMediaStarted: expect.any(Function),
    }))
    expect(container.textContent).toContain("inboundCallConnecting")

    await act(async () => connectionOptions?.onConnected?.())
    expect(container.textContent).toContain("inboundCallConnecting")
    await act(async () => connectionOptions?.onMediaStarted?.())
    expect(container.textContent).toContain("inboundCallHangUp")
  })

  it("releases the exact claim when the browser disappears before media starts", async () => {
    await render()
    await answer()

    await act(async () => connectionOptions?.onEnded?.("socket_closed"))
    await vi.waitFor(() => expect(requests).toContainEqual({
      url: "/api/v1/calls/call-1/browser-answer",
      method: "DELETE",
      body: { claimToken: "11111111-1111-4111-8111-111111111111" },
    }))
  })

  it("fails a lost queue race without opening a relay socket", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      error: "inbound_call_claimed",
    }), { status: 409, headers: { "content-type": "application/json" } }))

    await render()
    const button = Array.from(container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.includes("inboundCallAnswer"))
    await act(async () => button?.click())
    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("inboundCallClaimed"))

    expect(prepared.dispose).toHaveBeenCalled()
    expect(mocks.connectBrowserCall).not.toHaveBeenCalled()
  })

  it("reports a busy microphone without claiming the inbound call", async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
      new DOMException("Could not start audio source", "NotReadableError"),
    )

    await render()
    const button = Array.from(container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.includes("inboundCallAnswer"))
    expect(button).toBeTruthy()
    await act(async () => button?.click())
    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("micBusy"))

    expect(mocks.prepareBrowserAudio).not.toHaveBeenCalled()
    expect(mocks.connectBrowserCall).not.toHaveBeenCalled()
    expect(requests).toEqual([])
    expect(container.textContent).toContain("inboundCallAnswer")
  })
})
