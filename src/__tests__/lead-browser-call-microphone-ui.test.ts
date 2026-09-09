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

vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) => createElement("input", props),
}))

vi.mock("@/lib/voip/browser-call-audio", () => ({
  prepareBrowserAudio: mocks.prepareBrowserAudio,
  connectBrowserCall: mocks.connectBrowserCall,
}))

import { LeadBrowserCallAction } from "@/components/leads/lead-browser-call-action"

describe("lead browser-call microphone diagnosis", () => {
  let container: HTMLDivElement
  let root: Root
  let requests: Array<{ url: string; method: string }>

  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    requests = []
    vi.stubGlobal("isSecureContext", true)
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          throw new DOMException("Could not start audio source", "NotReadableError")
        }),
      },
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || "GET"
      requests.push({ url, method })
      if (url === "/api/v1/voip/capabilities" && method === "GET") {
        return new Response(JSON.stringify({ browserCalls: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      throw new Error(`unexpected request: ${method} ${url}`)
    }))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("reports a busy microphone without claiming or dialling the lead", async () => {
    await act(async () => {
      root.render(createElement(LeadBrowserCallAction, {
        leadId: "lead-1",
        phone: "+994501234567",
      }))
    })
    const button = await vi.waitFor(() => {
      const candidate = Array.from(container.querySelectorAll("button"))
        .find((element) => element.textContent?.includes("browserCall"))
      expect(candidate).toBeTruthy()
      return candidate
    })

    await act(async () => button?.click())
    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("micBusy"))

    expect(mocks.prepareBrowserAudio).not.toHaveBeenCalled()
    expect(mocks.connectBrowserCall).not.toHaveBeenCalled()
    expect(requests).toEqual([
      { url: "/api/v1/voip/capabilities", method: "GET" },
    ])
  })
})
