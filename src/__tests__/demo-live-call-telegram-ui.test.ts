// @vitest-environment jsdom
/**
 * The prospect's side of proving the phone (src/components/demo-center/
 * journey/demo-live-call.tsx), Telegram only (owner, 2026-09-22: no SMS in
 * the demo — «пусть немного повозятся»): agreement first, a real t.me link
 * (a tap, not a popup opened after an await, which phones block), the bot's
 * code typed back on the page, then «Zəng et». The next control always
 * carries the arrow.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DemoLiveCall } from "@/components/demo-center/journey/demo-live-call"
import { findDemoTarget } from "@/components/demo-center/journey/demo-target"
import { DEMO_JOURNEY_STRINGS as S } from "@/components/demo-center/journey/strings"

const LINK = "https://t.me/LeadDrivebot?start=d_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
let container: HTMLDivElement
let root: Root
const requests: Array<{ url: string; method: string; body: unknown }> = []
let linkIssued = false
let codeSent = false
let verified = false
let exhausted = false
let verifyAnswer: { status: number; body: Record<string, unknown> } | null = null
const posts = () => requests.filter((request) => request.method === "POST")

beforeEach(() => {
  vi.useFakeTimers()
  requests.length = 0
  linkIssued = false
  codeSent = false
  verified = false
  exhausted = false
  verifyAnswer = null
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET"
    const body = init?.body ? JSON.parse(init.body) : undefined
    requests.push({ url, method, body })
    if (url.endsWith("/phone/telegram") && method === "POST") {
      linkIssued = true
      return new Response(JSON.stringify({ success: true, state: "link", url: LINK, qr: "data:image/png;base64,AAAA" }))
    }
    if (url.endsWith("/phone/telegram")) return new Response(JSON.stringify({ success: true, verified, linkOpen: linkIssued && !verified, codeSent: codeSent && !verified, exhausted }))
    if (url.endsWith("/phone/verify") && verifyAnswer) return new Response(JSON.stringify(verifyAnswer.body), { status: verifyAnswer.status })
    if (url.endsWith("/phone/verify")) {
      const ok = (body as { code?: string }).code === "123456"
      if (ok) verified = true
      return new Response(JSON.stringify(ok ? { success: true, state: "verified" } : { success: false, error: "Kod düzgün deyil" }), { status: ok ? 200 : 401 })
    }
    return new Response(JSON.stringify({ success: false }), { status: 404 })
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

async function render(telegramAvailable: boolean, requestPhoneUsable = true) {
  await act(async () => {
    root.render(createElement(DemoLiveCall, {
      token: "t".repeat(64),
      initial: { enabled: true, requestPhoneUsable, phoneVerified: false, telegramAvailable },
      onOutcome: vi.fn(),
    }))
  })
}

const button = (text: string) => Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes(text))
const codeBox = () => container.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')
const arrowAt = () => findDemoTarget("ai-call-live")
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(3_100) })

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("proving the phone through Telegram", () => {
  it("asks for the agreement first, and the arrow says so", async () => {
    await render(true)
    expect(arrowAt()?.getAttribute("data-demo-label")).toBe(S.liveCallConsentHere)
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="demo-live-call-telegram"]')!.click())
    expect(container.textContent).toContain(S.liveCallConsentRequired)
    expect(posts()).toEqual([])
  })

  it("link → code from the bot → typed here → «Zəng et», with the arrow on each next control", async () => {
    await render(true)
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    expect(arrowAt()?.getAttribute("data-testid")).toBe("demo-live-call-telegram")
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="demo-live-call-telegram"]')!.click())

    expect(posts()[0]).toMatchObject({ body: { consent: true } })
    expect(JSON.stringify(posts()[0].body)).not.toMatch(/\d{9}/)
    const link = container.querySelector<HTMLAnchorElement>('[data-testid="demo-live-call-telegram-link"] a')
    expect(link?.getAttribute("href")).toBe(LINK)
    expect(arrowAt()).toBe(link)

    // The bot has not written yet.
    await tick()
    expect(container.textContent).toContain(S.liveCallTelegramWaiting)

    codeSent = true
    await tick()
    expect(container.textContent).toContain(S.liveCallCodeArrived)
    expect(document.activeElement).toBe(codeBox())
    expect(arrowAt()).toBe(codeBox())

    await type(codeBox()!, "123456")
    expect(arrowAt()?.textContent).toContain(S.liveCallVerify)
    await act(async () => button(S.liveCallVerify)!.click())
    expect(posts().at(-1)).toMatchObject({ url: expect.stringContaining("/phone/verify"), body: { code: "123456", consent: true } })
    expect(container.textContent).toContain(S.liveCallVerified)
    expect(arrowAt()?.textContent).toContain(S.liveCallCallNow)
  })

  it("offers no SMS anywhere", async () => {
    await render(true)
    expect(container.textContent).not.toMatch(/SMS/)
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="demo-live-call-telegram"]')!.click())
    expect(container.textContent).not.toMatch(/SMS/)
    expect(requests.some((request) => request.url.endsWith("/phone"))).toBe(false)
  })

  it("without the bot there is no way to prove the phone: it says so and points at «continue without the call»", async () => {
    await render(false)
    expect(container.textContent).toContain(S.liveCallTelegramUnavailable)
    expect(container.querySelector('[data-testid="demo-live-call-telegram"]')).toBeNull()
    expect(arrowAt()?.textContent).toContain(S.liveCallDecline)
  })

  it("picks up after a reload: the code the bot wrote can still be typed", async () => {
    linkIssued = true
    codeSent = true
    await render(true)
    expect(codeBox()).not.toBeNull()
    expect(container.textContent).toContain(S.liveCallCodeArrived)
    // Only the hash is stored, so no link can be shown again.
    expect(container.querySelector('[data-testid="demo-live-call-telegram-link"] a')).toBeNull()
    // Restored, not just done: focus does not jump.
    expect(document.activeElement).toBe(document.body)
  })

  it("never strands the prospect when the network drops on the way back from Telegram", async () => {
    await render(true)
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"))
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="demo-live-call-telegram"]')!.click())
    expect(container.textContent).toContain(S.liveCallFailed)
    expect(container.querySelector<HTMLButtonElement>('[data-testid="demo-live-call-telegram"]')!.disabled).toBe(false)
    expect(button(S.liveCallDecline)!.disabled).toBe(false)
  })

  it("keeps the agreement box on screen once ticked, after a reload", async () => {
    linkIssued = true
    await render(true)
    const box = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(box()).not.toBeNull()
    await act(async () => box()!.click())
    expect(box()?.checked).toBe(true)
  })

  it("a dead code sends the prospect back to the bot: the arrow and the QR return to «Telegram-ı açın»", async () => {
    await render(true)
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="demo-live-call-telegram"]')!.click())
    codeSent = true
    await tick()
    expect(arrowAt()).toBe(codeBox())
    expect(container.querySelector('[data-testid="demo-live-call-telegram-link"] img')).toBeNull()

    // The code expired while the prospect was away.
    await type(codeBox()!, "654321")
    verifyAnswer = { status: 410, body: { success: false, code: "expired", error: "Kodun müddəti bitib. Telegram-ı yenidən açın və nömrənizi paylaşın — bot yeni kod yazacaq." } }
    await act(async () => button(S.liveCallVerify)!.click())
    expect(container.textContent).toContain("Telegram-ı yenidən açın")
    expect(codeBox()!.value).toBe("")
    expect(arrowAt()?.getAttribute("href")).toBe(LINK)
    expect(container.querySelector('[data-testid="demo-live-call-telegram-link"] img')).not.toBeNull()
    expect(container.textContent).toContain(S.liveCallTelegramWaiting)
  })

  it("follows the server when a code stops counting, without anything typed", async () => {
    await render(true)
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="demo-live-call-telegram"]')!.click())
    codeSent = true
    await tick()
    expect(container.textContent).toContain(S.liveCallCodeArrived)
    codeSent = false
    await tick()
    expect(container.textContent).not.toContain(S.liveCallCodeArrived)
    expect(arrowAt()?.getAttribute("href")).toBe(LINK)
  })

  it("after a reload asks for the agreement before the code, and the arrow says so", async () => {
    linkIssued = true
    codeSent = true
    await render(true)
    expect(arrowAt()?.getAttribute("data-demo-label")).toBe(S.liveCallConsentHere)
    await type(codeBox()!, "123456")
    // Still the agreement first: «Təsdiqlə» would only refuse.
    expect(arrowAt()?.getAttribute("data-demo-label")).toBe(S.liveCallConsentHere)
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    expect(arrowAt()?.textContent).toContain(S.liveCallVerify)
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1)
  })

  it("when no code and no link are left, it says the call is off and points at «continue without the call»", async () => {
    linkIssued = true
    exhausted = true
    await render(true)
    expect(container.textContent).toContain(S.liveCallProofClosed)
    expect(container.querySelector('[data-testid="demo-live-call-telegram"]')).toBeNull()
    expect(arrowAt()?.textContent).toContain(S.liveCallDecline)
  })
})
