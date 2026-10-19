// @vitest-environment jsdom
/**
 * The prospect's side of connecting his own Facebook Page to the demo
 * (src/components/demo-center/journey/demo-live-social.tsx): the offer and the
 * consent line, Meta's dialog in a new tab opened inside the press, the choice
 * between several Pages by name, the connected Page with its code, the
 * Messenger link and «Ayır», the conversation of the one proven sender — and
 * after «Ayır», «ayrılır…» / «ayrıldı» with Meta's own place to remove
 * LeadDrive. Then the real Facebook row on top of the demo inbox. A poll
 * that was on its way when a button was pressed never puts the panel back.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { DemoLiveSocial } from "@/components/demo-center/journey/demo-live-social"
import { demoSocialInboxView, useDemoLiveSocial } from "@/components/demo-center/journey/use-demo-live-social"
import { DEMO_JOURNEY_STRINGS as S } from "@/components/demo-center/journey/strings"
import { DEMO_SOCIAL_CONSENT_TEXT, META_BUSINESS_INTEGRATIONS_URL } from "@/lib/demo-center/demo-social-consent"

const TOKEN = "t".repeat(64)
const DIALOG = "https://www.facebook.com/v21.0/dialog/oauth?client_id=2414060595720618&state=ldd.x.y"
let container: HTMLDivElement
let root: Root
let state: Record<string, unknown>
let postAnswer: Record<string, unknown> | null
const posts: unknown[] = []
let opened: { location: { replace: ReturnType<typeof vi.fn> }; opener: unknown; close: ReturnType<typeof vi.fn> } | null
/** While set, a GET answers only when released — with the state it read when it was asked. */
let holdPolls = false
let heldPolls: Array<() => void> = []

const OFFER = {
  success: true,
  enabled: true,
  phase: "offer",
  released: false,
  pages: [],
  pageName: null,
  code: null,
  until: null,
  proven: false,
  agentActive: false,
  repliesLeft: 0,
  messages: [],
  connectFailed: false,
}

const CONNECTED = {
  ...OFFER,
  phase: "connected",
  pageName: "Xəzər Logistika",
  code: "LD-9F8E7D",
  until: "2026-10-19T19:59:59.999Z",
  repliesLeft: 10,
  agentActive: true,
}

beforeEach(() => {
  vi.useFakeTimers()
  posts.length = 0
  postAnswer = null
  holdPolls = false
  heldPolls = []
  state = { ...OFFER }
  opened = { location: { replace: vi.fn() }, opener: {}, close: vi.fn() }
  vi.stubGlobal("open", vi.fn(() => opened))
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    expect(url).toBe(`/api/v1/public/demo-access/${TOKEN}/social`)
    if ((init?.method ?? "GET") === "POST") {
      const body = JSON.parse(init!.body!)
      posts.push(body)
      if (postAnswer) return new Response(JSON.stringify(postAnswer))
      if (body.action === "start") state = { ...OFFER, phase: "waiting" }
      if (body.action === "disconnect") state = { ...OFFER, phase: "releasing" }
      return new Response(JSON.stringify({ ...state, ...(body.action === "start" ? { url: DIALOG } : {}) }))
    }
    const read = JSON.stringify(state)
    if (holdPolls) return await new Promise<Response>((resolve) => { heldPolls.push(() => resolve(new Response(read))) })
    return new Response(read)
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

function Panel() {
  return createElement(DemoLiveSocial, { live: useDemoLiveSocial(TOKEN, true) })
}

async function render() {
  await act(async () => {
    root.render(createElement(Panel))
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
}

const panel = () => container.querySelector<HTMLElement>('[data-testid="demo-live-social"]')
const byTest = <T extends Element = HTMLElement>(id: string) => container.querySelector<T>(`[data-testid="${id}"]`)
const press = async (element: Element | null) => {
  await act(async () => (element as HTMLElement).click())
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
}

it("shows nothing at all when this session has no Facebook Page feature", async () => {
  state = { ...OFFER, enabled: false }
  await render()
  expect(panel()).toBeNull()
})

it("offers the connect with every promise in words, and opens Meta only after the consent line is ticked", async () => {
  await render()
  const text = panel()!.textContent!
  expect(text).toContain(S.socialOffer)
  for (const point of S.socialOfferPoints) expect(text).toContain(point)
  expect(text).toContain(S.socialMetaAiNote)
  expect(text).toContain(DEMO_SOCIAL_CONSENT_TEXT)
  const connect = byTest<HTMLButtonElement>("demo-social-connect")!
  expect(connect.textContent).toContain(S.socialConnect)
  expect(connect.disabled).toBe(true)

  await press(byTest("demo-social-consent"))
  expect(connect.disabled).toBe(false)
  await press(connect)

  expect(posts).toEqual([{ action: "start", consent: true }])
  // The tab was opened inside the press, cut off from this page, then sent to Meta's dialog.
  expect(window.open).toHaveBeenCalledWith("", "_blank")
  expect(opened!.opener).toBeNull()
  expect(opened!.location.replace).toHaveBeenCalledWith(DIALOG)
  expect(panel()!.dataset.phase).toBe("waiting")
  expect(panel()!.textContent).toContain(S.socialWaiting)
})

it("offers Meta's dialog as a link when the browser would not open a tab", async () => {
  opened = null
  await render()
  await press(byTest("demo-social-consent"))
  await press(byTest("demo-social-connect"))
  expect(byTest<HTMLAnchorElement>("demo-social-open-facebook")!.href).toBe(DIALOG)
  expect(byTest<HTMLAnchorElement>("demo-social-open-facebook")!.target).toBe("_blank")
})

it("says what the server refused, and closes the tab it opened for nothing", async () => {
  postAnswer = { success: false, error: "Hazırda çox səhifə qoşulub. Bir az sonra yenidən cəhd edin." }
  await render()
  await press(byTest("demo-social-consent"))
  await press(byTest("demo-social-connect"))
  expect(panel()!.textContent).toContain("Hazırda çox səhifə qoşulub")
  expect(opened!.close).toHaveBeenCalled()
})

it("asks which Page by name when several were granted, and sends only its place in the list", async () => {
  state = { ...OFFER, phase: "choose", pages: ["Birinci Səhifə", "İkinci Səhifə"] }
  await render()
  const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid="demo-social-choose-page"]')
  expect([...buttons].map((button) => button.textContent)).toEqual([S.socialChoosePage("Birinci Səhifə"), S.socialChoosePage("İkinci Səhifə")])
  state = { ...CONNECTED }
  await press(buttons[1])
  expect(posts).toEqual([{ action: "choose", page: 1 }])
  expect(panel()!.dataset.phase).toBe("connected")
})

it("says a Page could not be connected and offers the connect again", async () => {
  state = { ...OFFER, phase: "refused" }
  await render()
  expect(byTest("demo-social-refused")!.textContent).toBe(S.socialRefused)
  expect(byTest("demo-social-connect")!.textContent).toContain(S.socialReconnect)
})

it("says only what is true of every way an attempt lands on «refused»: a cancelled dialog, a Meta answer that never came, a Page LeadDrive already serves", () => {
  // It did not connect, and trying again is the way on — true of all three.
  expect(S.socialRefused).toMatch(/^Səhifə qoşulmadı\. Yenidən qoşun/)
  // The dialog: choose the Page and allow it.
  expect(S.socialRefused).toContain("səhifəni seçib icazə verdiyinizə əmin olun")
  // A Page LeadDrive already serves: then another one.
  expect(S.socialRefused).toContain("artıq LeadDrive-a qoşulubsa, başqa səhifə seçin")
  // Never that this Page cannot be connected: after a Meta timeout the same Page works on the next try.
  expect(S.socialRefused).not.toContain("qoşmaq olmur")
})

it("once connected: the Page, the end of the day, the code, a Messenger link of ours and «Ayır»", async () => {
  state = { ...CONNECTED }
  await render()
  const text = byTest("demo-social-connected")!.textContent!
  expect(text).toContain(S.socialConnected("Xəzər Logistika", "23:59"))
  expect(byTest("demo-social-code")!.textContent).toBe(S.socialCode("LD-9F8E7D"))
  expect(text).toContain(S.socialOthersNote)
  expect(text).toContain(S.socialWaitingMessage)
  // The link goes through our redirect: the Page id never reaches the page.
  expect(byTest<HTMLAnchorElement>("demo-social-messenger")!.getAttribute("href")).toBe(`/api/v1/public/demo-access/${TOKEN}/social/messenger`)
  expect(byTest("demo-social-disconnect")!.textContent).toContain(S.socialDisconnect)
})

it("shows the proven sender's conversation with the demo agent as it happens", async () => {
  state = {
    ...CONNECTED,
    proven: true,
    repliesLeft: 9,
    messages: [
      { direction: "inbound", by: "prospect", text: "Salam, LD-9F8E7D", at: "2026-10-19T10:00:00.000Z" },
      { direction: "outbound", by: "ai", text: "Salam! Mən LeadDrive-ın demo AI agentiyəm.", at: "2026-10-19T10:00:04.000Z" },
    ],
  }
  await render()
  expect(panel()!.textContent).toContain("Mən LeadDrive-ın demo AI agentiyəm")
  expect(panel()!.textContent).toContain(S.socialAiBadge)
  expect(byTest("demo-social-agent")!.textContent).toBe(S.socialAgentActive(9))
})

it("«Ayır» asks for the release, then says it is being released and where in Meta to remove LeadDrive", async () => {
  state = { ...CONNECTED }
  await render()
  await press(byTest("demo-social-disconnect"))
  expect(posts).toEqual([{ action: "disconnect" }])
  expect(byTest("demo-social-releasing")!.textContent).toContain(S.socialReleasing)
  expect(byTest<HTMLAnchorElement>("demo-social-business-integrations")!.href).toBe(META_BUSINESS_INTEGRATIONS_URL)

  // The cron unbound it: «ayrıldı», the same link, and the offer again.
  state = { ...OFFER, released: true }
  await act(async () => { await vi.advanceTimersByTimeAsync(5_100) })
  expect(byTest("demo-social-released")!.textContent).toContain(S.socialReleased)
  expect(byTest<HTMLAnchorElement>("demo-social-business-integrations")!.href).toBe(META_BUSINESS_INTEGRATIONS_URL)
  expect(byTest("demo-social-connect")).not.toBeNull()
})

it("a poll that was on its way when «Ayır» was pressed does not bring «connected» back, and polling goes on", async () => {
  state = { ...CONNECTED }
  await render()
  // The next poll sets out and reads the connected row…
  holdPolls = true
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
  expect(heldPolls).toHaveLength(1)
  // …«Ayır» is pressed and answered while it is still on its way…
  await press(byTest("demo-social-disconnect"))
  expect(panel()!.dataset.phase).toBe("releasing")
  // …and its stale answer lands last.
  holdPolls = false
  await act(async () => { heldPolls.splice(0).forEach((answer) => answer()) })
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  expect(panel()!.dataset.phase).toBe("releasing")
  expect(byTest("demo-social-disconnect")).toBeNull()

  const asked = vi.mocked(fetch).mock.calls.length
  state = { ...OFFER, released: true }
  await act(async () => { await vi.advanceTimersByTimeAsync(5_100) })
  expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(asked)
  expect(byTest("demo-social-released")).not.toBeNull()
})

it("a poll that was on its way when the connect was pressed does not take away the dialog link the browser would not open", async () => {
  opened = null
  await render()
  await press(byTest("demo-social-consent"))
  holdPolls = true
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
  expect(heldPolls).toHaveLength(1)
  await press(byTest("demo-social-connect"))
  expect(byTest<HTMLAnchorElement>("demo-social-open-facebook")!.href).toBe(DIALOG)

  // The stale «offer» lands after the start's «waiting».
  holdPolls = false
  await act(async () => { heldPolls.splice(0).forEach((answer) => answer()) })
  await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  expect(panel()!.dataset.phase).toBe("waiting")
  expect(byTest<HTMLAnchorElement>("demo-social-open-facebook")!.href).toBe(DIALOG)
  // The next poll reads «waiting» and keeps it.
  await act(async () => { await vi.advanceTimersByTimeAsync(5_100) })
  expect(byTest<HTMLAnchorElement>("demo-social-open-facebook")!.href).toBe(DIALOG)
})

it("a button's error goes once a poll shows the phase has moved on", async () => {
  state = { ...CONNECTED }
  await render()
  postAnswer = { success: false, error: "Qoşulmuş səhifə yoxdur." }
  await press(byTest("demo-social-disconnect"))
  expect(panel()!.textContent).toContain("Qoşulmuş səhifə yoxdur.")
  state = { ...OFFER, phase: "releasing" }
  await act(async () => { await vi.advanceTimersByTimeAsync(5_100) })
  expect(panel()!.dataset.phase).toBe("releasing")
  expect(panel()!.textContent).not.toContain("Qoşulmuş səhifə yoxdur.")
})

it("a connect Meta did not confirm says so while it is undone", async () => {
  state = { ...OFFER, phase: "releasing", connectFailed: true }
  await render()
  expect(byTest("demo-social-releasing")!.textContent).toContain(S.socialConnectFailed)
})

it("stops asking once the session says the feature is not there", async () => {
  state = { ...OFFER, enabled: false }
  await render()
  const calls = vi.mocked(fetch).mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
  expect(vi.mocked(fetch).mock.calls.length).toBe(calls)
})

it("gives the inbox a real Facebook row only for a connected Page", () => {
  expect(demoSocialInboxView(null)).toBeNull()
  expect(demoSocialInboxView({ ...OFFER, phase: "waiting" } as never)).toBeNull()
  expect(demoSocialInboxView({ ...CONNECTED } as never)).toEqual({ pageName: "Xəzər Logistika", code: "LD-9F8E7D", proven: false, messages: [] })
})
