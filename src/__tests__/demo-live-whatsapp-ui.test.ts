// @vitest-environment jsdom
/**
 * The prospect's side of the demo's real WhatsApp thread
 * (src/components/demo-center/journey/demo-live-whatsapp.tsx): our welcome
 * to their own phone on their press with the consent line, or their own
 * first message by link or QR; the session's code in plain sight; and once
 * the code came from that phone, the conversation with the AI agent as it
 * happens. There is no composer: the demo's agent answers on WhatsApp itself.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { DemoLiveWhatsApp } from "@/components/demo-center/journey/demo-live-whatsapp"
import { useDemoLiveWhatsApp } from "@/components/demo-center/journey/use-demo-live-whatsapp"
import { DEMO_JOURNEY_STRINGS as S } from "@/components/demo-center/journey/strings"
import { DEMO_WHATSAPP_CONSENT_TEXT } from "@/lib/demo-center/demo-whatsapp-welcome"

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => createElement("img", { src: String(props.src ?? ""), alt: String(props.alt ?? "") }),
}))

const NUMBER = "+994 10 531 30 65"
let container: HTMLDivElement
let root: Root
let state: Record<string, unknown>
let postAnswer: Record<string, unknown> | null
const posts: unknown[] = []

beforeEach(() => {
  vi.useFakeTimers()
  posts.length = 0
  postAnswer = null
  state = {
    success: true,
    enabled: true,
    displayNumber: NUMBER,
    link: "https://wa.me/994105313065?text=LeadDrive%20demo%20Kod%3A%20LD-1A2B3C",
    code: "LD-1A2B3C",
    phoneMasked: "+994 ** *** 45 67",
    canWelcome: true,
    welcomeSentAt: null,
    proven: false,
    agentActive: false,
    agentRepliesLeft: 10,
    agentEndsAt: null,
    closed: false,
    qr: "data:image/png;base64,AAAA",
    messages: [],
  }
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
    if ((init?.method ?? "GET") === "POST") {
      posts.push(JSON.parse(init!.body!))
      if (postAnswer) return new Response(JSON.stringify(postAnswer))
      state = { ...state, welcomeSentAt: "2026-10-18T11:00:00.000Z" }
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

/** The page reads the thread once (the player); the panel shows it. */
function Panel({ mode }: { mode: "chat" | "ticket" }) {
  return createElement(DemoLiveWhatsApp, { live: useDemoLiveWhatsApp("t".repeat(64), true), mode })
}

async function render(mode: "chat" | "ticket" = "chat") {
  await act(async () => {
    root.render(createElement(Panel, { mode }))
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
}

const panel = () => container.querySelector('[data-testid="demo-live-whatsapp"]')
const welcomeButton = () => container.querySelector<HTMLButtonElement>('[data-testid="demo-whatsapp-welcome"]')
const consentBox = () => container.querySelector<HTMLInputElement>('[data-testid="demo-whatsapp-consent"]')

it("shows nothing at all when this session has no live thread", async () => {
  state = { success: true, enabled: false, displayNumber: null, link: null, messages: [] }
  await render()
  expect(panel()).toBeNull()
})

it("offers our message to the request's phone only after the consent line is ticked, and says exactly what will happen", async () => {
  await render()
  expect(panel()!.textContent).toContain("+994 ** *** 45 67")
  expect(panel()!.textContent).toContain(DEMO_WHATSAPP_CONSENT_TEXT)
  expect(welcomeButton()!.disabled).toBe(true)

  await act(async () => consentBox()!.click())
  expect(welcomeButton()!.disabled).toBe(false)
  await act(async () => welcomeButton()!.click())
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  expect(posts).toEqual([{ action: "welcome", consent: true }])
  // Then: look at the phone, and add the code to the reply.
  expect(container.querySelector('[data-testid="demo-whatsapp-welcome-sent"]')).not.toBeNull()
  expect(container.querySelector('[data-testid="demo-whatsapp-code"]')!.textContent).toContain(S.whatsappReplyWithCode("LD-1A2B3C"))
})

it("where the owner has not switched the request on, the way in is writing first — from the request's phone, with the code", async () => {
  state = { ...state, canWelcome: false }
  await render()
  expect(welcomeButton()).toBeNull()
  expect(consentBox()).toBeNull()
  const writeFirst = container.querySelector('[data-testid="demo-whatsapp-write-first"]')!
  expect(writeFirst.closest("details")).toBeNull()
  expect(writeFirst.textContent).toContain("+994 ** *** 45 67")
  expect(writeFirst.querySelector<HTMLAnchorElement>("a")!.href).toContain("wa.me/994105313065")
  expect(container.querySelector('[data-testid="demo-whatsapp-code"]')!.textContent).toContain("LD-1A2B3C")
})

it("keeps the way to write first: the number, a link with the code and a QR", async () => {
  await render()
  expect(panel()!.textContent).toContain(NUMBER)
  expect(container.querySelector<HTMLAnchorElement>("a")!.href).toContain("wa.me/994105313065")
  expect(container.querySelector("img")).not.toBeNull()
  expect(container.querySelector('[data-testid="demo-whatsapp-code"]')!.textContent).toContain("LD-1A2B3C")
  // There is no composer: the prospect is not the operator any more.
  expect(container.querySelector("textarea")).toBeNull()
})

it("says what the server refused rather than swallowing it", async () => {
  postAnswer = { success: false, error: "Mesaj hazırda göndərilə bilmir. Aşağıdakı düymə ilə özünüz yazın." }
  await render()
  await act(async () => consentBox()!.click())
  await act(async () => welcomeButton()!.click())
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  expect(panel()!.textContent).toContain("Aşağıdakı düymə ilə özünüz yazın")
})

it("forgets a failed press once the thread moved on", async () => {
  postAnswer = { success: false, error: "Mesaj göndərilmədi. Aşağıdakı düymə ilə özünüz yazın." }
  await render()
  await act(async () => consentBox()!.click())
  await act(async () => welcomeButton()!.click())
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  expect(panel()!.textContent).toContain("Mesaj göndərilmədi")
  state = { ...state, proven: true, agentActive: true, agentEndsAt: "2026-10-18T19:59:59.999Z", messages: [] }
  await act(async () => { await vi.advanceTimersByTimeAsync(5_100) })
  expect(panel()!.textContent).not.toContain("Mesaj göndərilmədi")
})

it("once the code came from that phone, shows the conversation with the AI agent as it happens", async () => {
  state = {
    ...state,
    proven: true,
    agentActive: true,
    agentRepliesLeft: 8,
    agentEndsAt: "2026-10-18T19:59:59.999Z",
    messages: [
      { id: "in", direction: "inbound", by: "prospect", text: "Salam! Kod: LD-1A2B3C", at: "2026-10-18T11:00:00.000Z" },
      { id: "ai", direction: "outbound", by: "ai", text: "Salam! Komandanızda neçə nəfər var?", at: "2026-10-18T11:00:05.000Z" },
    ],
  }
  await render()
  expect(panel()!.textContent).toContain("Komandanızda neçə nəfər var?")
  expect(panel()!.textContent).toContain(S.whatsappAiBadge)
  expect(container.querySelector('[data-testid="demo-whatsapp-agent"]')!.textContent).toContain(S.whatsappAgentActive(8, "23:59"))
  expect(welcomeButton()).toBeNull()
})

it("says the agent is done when the day or the answers ran out", async () => {
  state = { ...state, proven: true, agentActive: false, closed: true, messages: [] }
  await render()
  expect(container.querySelector('[data-testid="demo-whatsapp-agent"]')!.textContent).toContain(S.whatsappAgentDone)
})

/** In the Service Desk chapters the same thread can open a real ticket — on the prospect's own press. */
const PROVEN = {
  proven: true,
  agentActive: true,
  agentRepliesLeft: 8,
  agentEndsAt: "2026-10-18T19:59:59.999Z",
  messages: [{ id: "in", direction: "inbound", by: "prospect", text: "Salam! Kod: LD-1A2B3C", at: "2026-10-18T11:00:00.000Z" }],
  ticketMode: false,
  ticketModeEnded: false,
  ticket: null,
}

it("offers no ticket in the conversation chapters", async () => {
  state = { ...state, ...PROVEN }
  await render("chat")
  expect(container.querySelector('[data-testid="demo-whatsapp-ticket"]')).toBeNull()
})

it("in Service Desk, asks for the code first, then offers a ticket from the next message — and says what it will hold", async () => {
  await render("ticket")
  expect(panel()!.textContent).toContain(S.whatsappTicketBeforeProof)
  expect(container.querySelector('[data-testid="demo-whatsapp-ticket-start"]')).toBeNull()

  state = { ...state, ...PROVEN }
  await act(async () => { await vi.advanceTimersByTimeAsync(5_100) })
  expect(panel()!.textContent).toContain(S.whatsappTicketOffer)
  postAnswer = { ...state, success: true, ticketMode: true }
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="demo-whatsapp-ticket-start"]')!.click())
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  expect(posts).toEqual([{ action: "ticket" }])
  expect(container.querySelector('[data-testid="demo-whatsapp-ticket-waiting"]')!.textContent).toContain(S.whatsappTicketWaiting)
})

it("names the ticket once it opened, and says so when the agent's day ended before it could", async () => {
  state = { ...state, ...PROVEN, ticketMode: true, ticket: { number: "WA-0031", subject: "Kassa çeki çap etmir", status: "open", createdAt: "2026-10-18T11:01:00.000Z", sla: { kind: "none" }, messageCount: 1, messages: [] } }
  await render("ticket")
  expect(container.querySelector('[data-testid="demo-whatsapp-ticket-opened"]')!.textContent).toBe(S.whatsappTicketOpened("WA-0031"))

  state = { ...state, ...PROVEN, agentActive: false, ticketMode: true, ticketModeEnded: true, ticket: null }
  await act(async () => { await vi.advanceTimersByTimeAsync(5_100) })
  expect(container.querySelector('[data-testid="demo-whatsapp-ticket"]')!.textContent).toContain(S.whatsappTicketEnded)
})

