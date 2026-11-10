// @vitest-environment jsdom
/**
 * The inbox asks about a conversation's WhatsApp call permission once, not on
 * every re-render. On 2026-11-09 one browser checked one conversation 276
 * times in a day, in pairs every ~15 s: the control sits twice on the screen
 * (thread header and contact card), and the inbox's 15-second list refresh
 * handed each copy a new `onStatus`, which re-ran the check — each one a 1–3 s
 * round trip to Meta.
 */
import { act, createElement, Fragment } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/whatsapp-call-rtc", () => ({ createWhatsAppCallOffer: vi.fn() }))

import { WhatsAppOutboundCallControl } from "@/components/inbox/whatsapp-outbound-call-control"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let checks: string[]

beforeEach(() => {
  checks = []
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    checks.push(String(url))
    await new Promise((resolve) => setTimeout(resolve, 5))
    return new Response(JSON.stringify({
      error: "Calling API not enabled",
      data: { permission: { status: "unknown", canRequest: false, canStartCall: false, lastError: "Calling API not enabled" }, provider: { success: false, error: "Calling API not enabled" } },
    }), { status: 502, headers: { "Content-Type": "application/json" } })
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })

/** The inbox as it renders: two copies, fresh callbacks on every render. */
function renderInbox(conversationId: string, statuses: string[]) {
  const headers = { "x-org": "org_1" }
  const props = () => ({
    conversationId,
    headers,
    locale: "ru",
    onStatus: (message: string) => { statuses.push(message) },
    onChanged: async () => {},
  })
  return act(async () => {
    root.render(createElement(Fragment, null,
      createElement(WhatsAppOutboundCallControl, props()),
      createElement(WhatsAppOutboundCallControl, props()),
    ))
  })
}

describe("WhatsApp call permission check in the inbox", () => {
  it("asks once for both copies of the control", async () => {
    const statuses: string[] = []
    await renderInbox("sc_1", statuses)
    await settle()
    expect(checks).toEqual(["/api/v1/calls/whatsapp/permissions?conversationId=sc_1"])
    expect(statuses).toEqual(["Calling API not enabled", "Calling API not enabled"])
  })

  it("does not ask again when the inbox re-renders with new callbacks", async () => {
    const statuses: string[] = []
    await renderInbox("sc_1", statuses)
    await settle()
    for (let refresh = 0; refresh < 4; refresh += 1) {
      await renderInbox("sc_1", statuses)
      await settle()
    }
    expect(checks).toHaveLength(1)
  })

  it("asks again when another conversation is opened", async () => {
    await renderInbox("sc_1", [])
    await settle()
    await renderInbox("sc_2", [])
    await settle()
    expect(checks).toEqual([
      "/api/v1/calls/whatsapp/permissions?conversationId=sc_1",
      "/api/v1/calls/whatsapp/permissions?conversationId=sc_2",
    ])
  })
})
