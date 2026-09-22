// @vitest-environment jsdom
/**
 * The prospect's side of the demo's real WhatsApp thread
 * (src/components/demo-center/journey/demo-live-whatsapp.tsx): write to us
 * first — WhatsApp lets a business answer in free text only after that — then
 * the thread appears and five answers may go back from our own number. When
 * the fifth is spent the panel says why it stops, instead of a dead button.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DemoLiveWhatsApp } from "@/components/demo-center/journey/demo-live-whatsapp"
import { DEMO_JOURNEY_STRINGS as S } from "@/components/demo-center/journey/strings"

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => createElement("img", { src: String(props.src ?? ""), alt: String(props.alt ?? "") }),
}))

const NUMBER = "+994 10 531 30 65"
let container: HTMLDivElement
let root: Root
let state: Record<string, unknown>
const posts: unknown[] = []

beforeEach(() => {
  vi.useFakeTimers()
  posts.length = 0
  state = {
    success: true,
    enabled: true,
    displayNumber: NUMBER,
    link: "https://wa.me/994105313065?text=LeadDrive%20demo",
    qr: "data:image/png;base64,AAAA",
    windowOpen: false,
    sent: 0,
    left: 5,
    messages: [],
  }
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
    if ((init?.method ?? "GET") === "POST") {
      const body = JSON.parse(init!.body!) as { text: string }
      posts.push(body)
      const sent = Number(state.sent) + 1
      state = {
        ...state,
        sent,
        left: 5 - sent,
        messages: [...(state.messages as unknown[]), { id: `out-${sent}`, direction: "outbound", text: body.text, at: "2026-09-23T09:00:00.000Z" }],
      }
      return new Response(JSON.stringify(state))
    }
    return new Response(JSON.stringify(state))
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

async function render() {
  await act(async () => {
    root.render(createElement(DemoLiveWhatsApp, { token: "t".repeat(64) }))
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
}

const panel = () => container.querySelector('[data-testid="demo-live-whatsapp"]')
const box = () => container.querySelector<HTMLTextAreaElement>("textarea")
const sendButton = () => Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes(S.replySend))

async function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
  await act(async () => {
    setter.call(box()!, value)
    box()!.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("the demo's live WhatsApp thread", () => {
  it("shows nothing at all when this session has no live thread", async () => {
    state = { success: true, enabled: false, displayNumber: null, link: null, windowOpen: false, sent: 0, left: 0, messages: [] }
    await render()
    expect(panel()).toBeNull()
  })

  it("asks the prospect to write first, with the number, a link and a QR", async () => {
    await render()
    expect(panel()!.textContent).toContain(NUMBER)
    expect(panel()!.textContent).toContain(S.whatsappWaiting)
    expect(container.querySelector<HTMLAnchorElement>("a")!.href).toContain("wa.me/994105313065")
    expect(container.querySelector("img")).not.toBeNull()
    // Nothing can be sent before they have written.
    expect(box()).toBeNull()
  })

  it("opens the thread once their message arrives, and answers from our number", async () => {
    await render()
    state = {
      ...state,
      windowOpen: true,
      messages: [{ id: "in-1", direction: "inbound", text: "Salam! Qiymətləri soruşmaq istəyirəm", at: "2026-09-23T08:59:00.000Z" }],
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100) })

    expect(panel()!.textContent).toContain("Qiymətləri soruşmaq istəyirəm")
    await type("Salam! İndi yazıram")
    await act(async () => sendButton()!.click())
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(posts).toEqual([{ text: "Salam! İndi yazıram" }])
    expect(panel()!.textContent).toContain("Salam! İndi yazıram")
    expect(panel()!.textContent).toContain(S.whatsappRealNote(NUMBER))
  })

  it("after the fifth answer says why it stops instead of going quiet", async () => {
    await render()
    state = { ...state, windowOpen: true }
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100) })

    for (let index = 1; index <= 5; index += 1) {
      await type(`cavab ${index}`)
      await act(async () => sendButton()!.click())
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    }
    expect(posts).toHaveLength(5)
    expect(panel()!.textContent).toContain(S.whatsappLimitBody(5))
    expect(box()!.disabled).toBe(true)
  })

  it("says what the server refused rather than swallowing it", async () => {
    await render()
    state = { ...state, windowOpen: true }
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100) })
    vi.mocked(fetch).mockImplementationOnce(async () =>
      new Response(JSON.stringify({ success: false, code: "no_inbound", error: "Əvvəlcə siz bizə WhatsApp-da yazın" }), { status: 409 }),
    )
    await type("Salam")
    await act(async () => sendButton()!.click())
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(panel()!.textContent).toContain("Əvvəlcə siz bizə WhatsApp-da yazın")
  })
})
