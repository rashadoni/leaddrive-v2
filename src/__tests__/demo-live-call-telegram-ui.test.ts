// @vitest-environment jsdom
/**
 * The prospect's side of proving the phone through Telegram
 * (src/components/demo-center/journey/demo-live-call.tsx): agreement first,
 * then a real t.me link (a tap, not a popup opened after an await, which
 * phones block), the page waits for the bot and moves on by itself, and the
 * SMS code stays one tap away for anyone without Telegram.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DemoLiveCall } from "@/components/demo-center/journey/demo-live-call"
import { DEMO_JOURNEY_STRINGS as S } from "@/components/demo-center/journey/strings"

const LINK = "https://t.me/LeadDrivebot?start=d_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
let container: HTMLDivElement
let root: Root
const requests: Array<{ url: string; method: string; body: unknown }> = []
let verified = false
let linkIssued = false
const posts = () => requests.filter((request) => request.method === "POST")

beforeEach(() => {
  vi.useFakeTimers()
  requests.length = 0
  verified = false
  linkIssued = false
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET"
    requests.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined })
    if (url.endsWith("/phone/telegram") && method === "POST") {
      linkIssued = true
      return new Response(JSON.stringify({ success: true, state: "link", url: LINK, qr: "data:image/png;base64,AAAA" }))
    }
    if (url.endsWith("/phone/telegram")) return new Response(JSON.stringify({ success: true, verified, linkOpen: linkIssued && !verified }))
    if (url.endsWith("/phone")) return new Response(JSON.stringify({ success: true, state: "code_sent" }))
    return new Response(JSON.stringify({ success: false }))
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ""
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function render(telegramAvailable: boolean) {
  await act(async () => {
    root.render(createElement(DemoLiveCall, {
      token: "t".repeat(64),
      initial: { enabled: true, requestPhoneUsable: true, phoneVerified: false, telegramAvailable },
      onOutcome: vi.fn(),
    }))
  })
}

const button = (text: string) => Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes(text))

describe("proving the phone through Telegram", () => {
  it("asks for the agreement before making a link", async () => {
    await render(true)
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="demo-live-call-telegram"]')!.click())
    expect(container.textContent).toContain(S.liveCallConsentRequired)
    expect(posts()).toEqual([])
  })

  it("gives a real link to tap, waits for the bot, and moves on by itself", async () => {
    await render(true)
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="demo-live-call-telegram"]')!.click())

    expect(posts()[0]).toMatchObject({ method: "POST", body: { consent: true } })
    expect(JSON.stringify(posts()[0].body)).not.toMatch(/\d{9}/)
    const link = container.querySelector<HTMLAnchorElement>('[data-testid="demo-live-call-telegram-link"] a')
    expect(link?.getAttribute("href")).toBe(LINK)
    expect(link?.textContent).toContain(S.liveCallTelegramOpen)
    expect(container.textContent).toContain(S.liveCallTelegramWaiting)

    await act(async () => { await vi.advanceTimersByTimeAsync(3_100) })
    expect(container.textContent).not.toContain(S.liveCallVerified)

    verified = true
    await act(async () => { await vi.advanceTimersByTimeAsync(3_100) })
    expect(container.textContent).toContain(S.liveCallVerified)
    expect(button(S.liveCallCallNow)).toBeDefined()
  })

  it("keeps the SMS code one tap away", async () => {
    await render(true)
    await act(async () => button(S.liveCallSmsInstead)!.click())
    expect(posts()[0]).toMatchObject({ method: "POST", body: { useRequestPhone: true } })
    expect(container.querySelector('input[autocomplete="one-time-code"]')).not.toBeNull()
  })

  it("picks up an open link after the tab was reloaded, and moves on when the bot accepts", async () => {
    linkIssued = true
    await render(true)
    expect(container.textContent).toContain(S.liveCallTelegramResume)
    // Only the hash is stored, so no link can be shown again — the button in Telegram is the way on.
    expect(container.querySelector('[data-testid="demo-live-call-telegram-link"] a')).toBeNull()
    verified = true
    await act(async () => { await vi.advanceTimersByTimeAsync(3_100) })
    expect(container.textContent).toContain(S.liveCallVerified)
    expect(document.activeElement?.textContent).toContain(S.liveCallCallNow)
  })

  it("comes back proven when the bot accepted the number while the tab was away", async () => {
    verified = true
    await render(true)
    expect(container.textContent).toContain(S.liveCallVerified)
  })

  it("offers only the SMS code when there is no bot", async () => {
    await render(false)
    expect(container.querySelector('[data-testid="demo-live-call-telegram"]')).toBeNull()
    expect(button(S.liveCallUseRequestPhone)).toBeDefined()
  })
})
