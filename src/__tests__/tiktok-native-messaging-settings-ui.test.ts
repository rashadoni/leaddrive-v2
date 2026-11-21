// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const context = vi.hoisted(() => ({ role: "admin", locale: "en", result: "" }))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "authenticated", data: { user: { role: context.role, organizationId: "org-1" } } }),
}))
vi.mock("next-intl", () => ({ useLocale: () => context.locale }))
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(context.result ? { result: context.result } : {}),
}))
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => createElement("a", props, children),
}))

import { TikTokNativeMessagingSettings } from "@/components/channels/tiktok-native-messaging-settings"

const ready = {
  configured: true, status: "connected",
  capabilities: { read: true, reply: true, webhook: true },
  webhookSubscribed: true, lastInboundAt: null, tokenExpiresAt: "2026-10-20T06:00:00Z",
}

describe("native TikTok connection settings", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    context.role = "admin"
    context.locale = "en"
    context.result = ""
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function render() {
    await act(async () => { root.render(createElement(TikTokNativeMessagingSettings)) })
    await act(async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() })
  }
  function button(label: string) {
    const found = [...container.querySelectorAll("button")].find(item => item.textContent === label)
    expect(found, label).toBeDefined()
    return found!
  }
  const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

  it("does not fetch credentials or offer mutations to a non-admin", async () => {
    context.role = "agent"
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    await render()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.textContent).toContain("An administrator must sign in")
    expect(container.querySelectorAll("button")).toHaveLength(0)
  })

  it("never treats an OAuth success query as proof when the server is unconfigured", async () => {
    context.result = "connected"
    vi.stubGlobal("fetch", vi.fn(async () => response({ ...ready, configured: false })))
    await render()
    expect(container.textContent).toContain("Setup required")
    expect(container.textContent).not.toContain("Connection configured")
    expect(button("Reconnect TikTok").disabled).toBe(true)
    expect(container.textContent).toContain("Business Messaging API approval")
  })

  it("shows a pending webhook honestly and retries only after the administrator clicks", async () => {
    let subscribed = false
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        expect(JSON.parse(String(options.body))).toEqual({ action: "subscribe" })
        expect(options.headers).toMatchObject({ "x-organization-id": "org-1" })
        subscribed = true
        return response({ success: true })
      }
      return response({ ...ready, webhookSubscribed: subscribed, capabilities: { ...ready.capabilities, webhook: subscribed } })
    })
    vi.stubGlobal("fetch", fetchMock)
    await render()
    expect(container.textContent).toContain("Message delivery setup incomplete")
    expect(container.textContent).not.toContain("Connection configured")
    expect(fetchMock.mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true)
    await act(async () => { button("Retry message delivery setup").click() })
    expect(container.textContent).toContain("Connection configured")
    expect(container.textContent).toContain("Verify a real incoming message and a reply")
  })

  it("disconnects only the native connection and verifies the resulting status", async () => {
    let disconnected = false
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        expect(JSON.parse(String(options.body))).toEqual({ action: "disconnect" })
        disconnected = true
        return response({ success: true, revokeConfirmed: false })
      }
      return response(disconnected ? { ...ready, status: "disabled", capabilities: {}, tokenExpiresAt: null } : ready)
    })
    vi.stubGlobal("fetch", fetchMock)
    await render()
    await act(async () => { button("Disconnect").click() })
    expect(container.textContent).toContain("disconnected from this workspace")
    expect(container.textContent).toContain("Disconnected")
    expect(button("Disconnect").disabled).toBe(true)
    // Still a guard against a stray endpoint: only the connection status and its readiness read.
    expect(fetchMock.mock.calls.every(([url]) =>
      url === "/api/v1/channels/tiktok-messaging" || url === "/api/v1/channels/tiktok-messaging/readiness")).toBe(true)
  })

  const readiness = (items: { id: string; state: string; value?: string | null }[], over: Record<string, unknown> = {}) => ({
    ready: items.every(item => item.state === "ok"),
    items: items.map(item => ({ value: null, ...item })),
    facts: { profileReadFailed: false, ...over },
  })
  /** Routes the two GETs the page makes, so a readiness assertion cannot pass on the status body. */
  function routed(status: unknown, readinessBody: unknown) {
    return vi.fn(async (url: string) => response(String(url).endsWith("/readiness") ? readinessBody : status))
  }

  it("tells the administrator which requirement is theirs and which waits on TikTok", async () => {
    vi.stubGlobal("fetch", routed({ ...ready, status: "needs_access", capabilities: {} }, readiness([
      { id: "account", state: "ok", value: "@gobustone" },
      { id: "advancedAccess", state: "warn" },
      { id: "messagingApproval", state: "blocked" },
    ])))
    await render()
    const list = container.querySelector('[data-testid="tiktok-readiness"]')
    expect(list).not.toBeNull()
    const text = list!.textContent ?? ""
    expect(text).toContain("@gobustone")
    expect(text).toContain("Your move")
    expect(text).toContain("Waiting on TikTok")
    // The unmet requirement explains itself; the met one does not repeat advice nobody needs.
    expect(text).toContain("Raise it in TikTok")
    expect(text).not.toContain("Connect the business account from the social monitoring page")
  })

  it("does not read an unanswered entitlement as a refusal", async () => {
    vi.stubGlobal("fetch", routed(ready, readiness([
      { id: "account", state: "ok", value: "@gobustone" },
      { id: "advancedAccess", state: "warn" },
      { id: "messagingApproval", state: "ok" },
    ], { profileReadFailed: true })))
    await render()
    expect(container.textContent).toContain("That is not a refusal")
  })

  it("falls back to the static requirement when readiness cannot be read", async () => {
    vi.stubGlobal("fetch", routed(ready, { error: "nope" }))
    await render()
    expect(container.querySelector('[data-testid="tiktok-readiness"]')).toBeNull()
    expect(container.textContent).toContain("Could not check readiness")
    expect(container.textContent).toContain("Business Messaging API approval")
  })

  it("hides server error details and blocks mutations when status cannot be verified", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ error: "secret-provider-detail" }, 403)))
    await render()
    expect(container.textContent).toContain("does not have access to channel settings")
    expect(container.textContent).not.toContain("secret-provider-detail")
    expect(button("Connect TikTok").disabled).toBe(true)
    expect(button("Disconnect").disabled).toBe(true)
  })

  it.each([
    ["en", "Required messaging permissions were not granted"],
    ["ru", "Не предоставлены необходимые разрешения"],
    ["az", "Mesajlar üçün tələb olunan icazələr verilməyib"],
  ])("explains actual callback failures in %s", async (locale, expected) => {
    context.locale = locale
    context.result = "tiktok_required_scopes_missing"
    vi.stubGlobal("fetch", vi.fn(async () => response({ ...ready, status: "needs_access", capabilities: {} })))
    await render()
    expect(container.textContent).toContain(expected)
    expect(container.textContent).not.toContain("tiktok_required_scopes_missing")
  })
})
