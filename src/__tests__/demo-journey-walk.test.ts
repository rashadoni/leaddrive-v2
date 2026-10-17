// @vitest-environment jsdom
/**
 * The whole story, walked the way a prospect walks it: through the real
 * player and scenes, pressing only what the on-screen arrow points at
 * (`data-demo-target`) and «İrəli» on steps that only show something.
 *
 * Why this exists (owner, 2026-09-22): the reducer tests drove the state
 * machine directly and were green while the demo itself could not be
 * finished — on «Öz kartınızı açın» the «Yeni» column was empty, «Zəngsiz
 * davam edin» had no button anywhere, and «Sizin tapşırığınız» had no card.
 * A test of the shape of the story cannot see that; this one can.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { act, createElement, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const toasts = vi.hoisted(() => [] as string[])
// What is on screen right now, by toast id — sonner replaces a toast shown
// again under the same id and removes it on `dismiss`.
const liveToasts = vi.hoisted(() => new Map<string, string>())
vi.mock("sonner", () => ({
  toast: Object.assign((message: string) => toasts.push(String(message)), {
    info: (message: string, options?: { id?: string }) => {
      if (options?.id) liveToasts.set(options.id, String(message))
      return toasts.push(String(message))
    },
    dismiss: (id?: string) => (id === undefined ? liveToasts.clear() : liveToasts.delete(id)),
    success: (message: string) => toasts.push(String(message)),
    error: (message: string) => toasts.push(String(message)),
  }),
  Toaster: () => null,
}))
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => createElement("img", { src: String(props.src ?? ""), alt: String(props.alt ?? "") }) }))

import { DemoJourneyPlayer } from "@/components/demo-center/journey/demo-journey-player"
import { findDemoTarget } from "@/components/demo-center/journey/demo-target"
import { stepVoiceUrl } from "@/lib/demo-center/guide-voice"
import { DEMO_JOURNEY_STRINGS as S } from "@/components/demo-center/journey/strings"
import { DEMO_LIVE_CALL_STEP_ID, PROSPECT_TO_CLOSED_WON, withLiveCall, type DemoJourneyStep } from "@/lib/demo-center/journey"

const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages/az.json"), "utf8"))
const TOKEN = "walk-test-token-0001"
const STORAGE_KEY = `ld_demo_journey_${TOKEN.slice(-16)}`
const steps = new Map<string, DemoJourneyStep>(PROSPECT_TO_CLOSED_WON.sections.flatMap((section) => section.steps.map((step) => [step.id, step] as const)))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  toasts.length = 0
  liveToasts.clear()
  window.sessionStorage.clear()
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0) as unknown as number)
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id))
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 404 })))
  Element.prototype.scrollIntoView = () => {}
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

async function settle(ms = 40) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

function frontier(): { sectionId: string; stepId: string; state: string } {
  const raw = window.sessionStorage.getItem(STORAGE_KEY)
  if (!raw) throw new Error("the player saved no progress")
  const parsed = JSON.parse(raw) as { snapshot?: { sectionId: string; stepId: string; state: string }; sectionId?: string; stepId?: string; state?: string }
  const snapshot = parsed.snapshot ?? parsed
  return { sectionId: snapshot.sectionId!, stepId: snapshot.stepId!, state: snapshot.state! }
}

function buttonWithText(text: string, within: ParentNode = document): HTMLButtonElement | null {
  return Array.from(within.querySelectorAll<HTMLButtonElement>("button")).find((button) => !button.disabled && button.textContent?.includes(text)) ?? null
}

/** What a prospect presses for this step: the arrow's control, or «İrəli». */
function control(step: DemoJourneyStep): HTMLElement | null {
  if (step.action === "observe" || step.action === "wait") {
    const card = document.querySelector('[data-testid="demo-coach-card"]')
    return (card && buttonWithText(S.next, card)) ?? buttonWithText(S.next, document.querySelector('[data-testid="demo-guide"]') ?? document)
  }
  const target = findDemoTarget(step.id)
  if (!target) return null
  // The prospect presses what the arrow shows: the coach mark must ring this very control.
  expect(document.querySelector('[data-testid="demo-coach-ring"]')?.getAttribute("data-target"), `no arrow on «${step.title}»`).toBe("control")
  if (target.matches("button, a, input")) return target
  // A marked region (the product's stage bar): press the part the arrow names.
  const named = /«([^»]+)»/.exec(step.targetLabel ?? "")?.[1]
  return named ? buttonWithText(named, target) : null
}

async function renderPlayer() {
  await act(async () => {
    root.render(
      createElement(
        NextIntlClientProvider,
        // Children go as the third argument; the props type insists on them too.
        { locale: "az", messages, timeZone: "Asia/Baku" } as ComponentProps<typeof NextIntlClientProvider>,
        createElement(DemoJourneyPlayer, {
          variant: "open",
          token: TOKEN,
          manifest: PROSPECT_TO_CLOSED_WON,
          identity: {
            name: "Nigar Əliyeva",
            company: "Xəzər Logistika MMC",
            jobTitle: "Satış direktoru",
            emailMasked: "ni•••@xezerlogistika.az",
            phoneMasked: "+994 ••••• 67",
            sourceChannel: "instagram",
          },
          company: "Xəzər Logistika MMC",
          watermark: "Xəzər Logistika MMC · Açıq demo",
        }),
      ),
    )
  })
  await settle()
}

/** Walks the story until `stopAt` is the step in hand; the screen is left on it. */
async function walkTo(stopAt: string): Promise<void> {
  await walkToEnd(undefined, stopAt)
  expect(frontier().stepId, `never reached ${stopAt}`).toBe(stopAt)
}

/** Walks from wherever the story is to its end; returns the steps taken.
 *  `detour` runs once before a step is pressed — a prospect wandering off.
 *  `stopAt` stops in front of that step instead of walking to the end. */
async function walkToEnd(detour?: (stepId: string) => Promise<void>, stopAt?: string): Promise<string[]> {
  const walked: string[] = []
  const detoured = new Set<string>()
  for (let guard = 0; guard < 200; guard += 1) {
    const { stepId, state } = frontier()
    if (stepId === stopAt) return walked
    if (state === "COMPLETED") break
    const step = steps.get(stepId)
    expect(step, `unknown frontier step ${stepId}`).toBeDefined()
    if (detour && !detoured.has(stepId)) {
      detoured.add(stepId)
      await detour(stepId)
    }

    let moved = false
    // A step may take a first click that opens its second control (a dialog).
    for (let press = 0; press < 3 && !moved; press += 1) {
      const element = control(step!)
      expect(element, `dead end: nothing to press on «${step!.title}» (${stepId})`).not.toBeNull()
      await act(async () => element!.click())
      await settle()
      const after = frontier()
      moved = after.stepId !== stepId || after.state !== state
    }
    expect(moved, `«${step!.title}» (${stepId}) did not move after pressing its control`).toBe(true)
    walked.push(stepId)
  }
  expect(frontier().state).toBe("COMPLETED")
  // And no click ever landed on the wrong thing.
  expect(toasts.filter((message) => message.startsWith(S.hintFollow("")))).toEqual([])
  return walked
}

function textOf(selector: string): string {
  return document.querySelector(selector)?.textContent ?? ""
}

const stepIdsFrom = (sectionId: string) => {
  const sections = PROSPECT_TO_CLOSED_WON.sections
  return sections.slice(sections.findIndex((section) => section.id === sectionId)).flatMap((section) => section.steps.map((step) => step.id))
}

describe("the guided story, walked through the real screens", () => {
  it("reaches the end pressing only what the arrow points at", async () => {
    await renderPlayer()
    const walked = await walkToEnd()
    // Every step, required or not, was taken in order — none skipped.
    expect(walked).toEqual(stepIdsFrom("orientation"))
  }, 60_000)

  it("survives a prospect who wanders off: back from the board, the wrong stage on the won step", async () => {
    await renderPlayer()
    const press = async (element: Element | null | undefined, what: string) => {
      expect(element, what).toBeTruthy()
      await act(async () => (element as HTMLElement).click())
      await settle()
    }
    const walked = await walkToEnd(async (stepId) => {
      if (stepId === "task-open") {
        // «←» on the board, then the board's tile: it must open again, not refuse.
        await press(container.querySelector('button[aria-label="Lövhələr"]'), "the board's back arrow")
        await press(findDemoTarget("task-boards"), "the boards tile")
        expect(findDemoTarget("task-open"), "the task card is back").not.toBeNull()
      }
      if (stepId === "closed-won-move") {
        // Back to the pipeline, and into the deal again from its card: the card
        // opens the deal's page, as in the product (there is no quick view).
        await press(container.querySelector('button[aria-label="Satış boru xətti"]'), "the deal card's back arrow")
        await press(container.querySelector('[data-tour-id="deals-card"] button'), "the deal card")
        expect(container.querySelector('[data-testid="demo-scene-deal-card"]'), "the deal's page").not.toBeNull()
        // A stage that is not «won» is not a win: the guide says so instead.
        const before = toasts.length
        await press(buttonWithText("Danışıqlar", container.querySelector('[data-tour-id="deal-stage-progress"]')!), "the negotiation stage")
        expect(frontier().stepId).toBe("closed-won-move")
        expect(toasts.length).toBeGreaterThan(before)
        toasts.length = before
      }
    })
    expect(walked).toEqual(stepIdsFrom("orientation"))
  }, 60_000)

  it("clears a hint once its step is done: it used to stay up over the next step's counter", async () => {
    await renderPlayer()
    await walkToEnd(async (stepId) => {
      if (stepId !== "deal-card") return
      // A quick action the demo does not perform: it says so in a hint.
      const action = container.querySelector<HTMLButtonElement>('[data-tour-id="deal-quick-actions"] button')
      expect(action, "a quick action on the deal card").not.toBeNull()
      await act(async () => action!.click())
      await settle()
      expect([...liveToasts.values()]).toEqual([S.demoButtonHint])
    }, "deal-ai")
    expect([...liveToasts.values()]).toEqual([])
  }, 60_000)

  it("starts where the prospect's interest is: the first screen opens the inbox at once", async () => {
    await renderPlayer()
    const inbox = document.querySelector<HTMLButtonElement>('[data-start-section="conversation"]')
    expect(inbox, "the first screen offers the inbox").not.toBeNull()
    await act(async () => inbox!.click())
    await settle()
    expect(frontier()).toMatchObject({ sectionId: "conversation", stepId: "conversation-channels" })
    // The scene the prospect lands on is the real inbox with their conversation, not an empty shell.
    expect(document.querySelector('[data-demo-target~="conversation-open"]')).not.toBeNull()

    // The story runs to its last screen — and that screen does not say «done»:
    // the campaigns were jumped over, so it offers them, and the guide's arrow
    // is on that offer, not on «Bitir» (owner, 2026-10-13: led straight to
    // «Bitir» at 15 of 27 steps).
    const first = await walkToEnd(undefined, "summary-finish")
    expect(first).toEqual(stepIdsFrom("conversation").filter((id) => id !== "summary-finish"))
    const unseen = document.querySelector('[data-testid="demo-unseen-modules"]')
    expect(unseen?.textContent).toContain(PROSPECT_TO_CLOSED_WON.sections.find((section) => section.id === "source")!.title)
    expect(textOf('[data-testid="demo-scene-summary"]')).not.toContain(S.completedTitle)
    expect(findDemoTarget("summary-finish")?.closest('[data-testid="demo-unseen-modules"]')).not.toBeNull()

    // Following the arrow opens the campaigns with their guide; after them the
    // guide does not walk the seen modules again — it returns to the last
    // screen, which now offers to finish.
    const rest = await walkToEnd()
    const sourceSteps = PROSPECT_TO_CLOSED_WON.sections.find((section) => section.id === "source")!.steps.map((step) => step.id)
    expect(rest).toEqual(["summary-finish", ...sourceSteps, "summary-review", "summary-finish"])
    expect(new Set([...first, ...rest])).toEqual(new Set(stepIdsFrom("source")))
  }, 60_000)

  it("opens a later section straight from the sidebar and carries on from there", async () => {
    await renderPlayer()
    const deals = document.querySelector<HTMLButtonElement>('[data-testid="demo-sidebar"] [data-nav-href="/deals"]')
    expect(deals?.getAttribute("data-nav-locked")).toBeNull()
    await act(async () => deals!.click())
    await settle()
    expect(frontier().sectionId).toBe("deal")
    // Carried on to the end, then through every module that was jumped over:
    // nothing is left unseen by the time the story can be finished.
    const walked = await walkToEnd()
    expect(walked.slice(0, stepIdsFrom("deal").length - 1)).toEqual(stepIdsFrom("deal").filter((id) => id !== "summary-finish"))
    expect(new Set(walked)).toEqual(new Set(stepIdsFrom("source")))
  }, 60_000)

  it("opens a module left behind from the menu with its guide, and ticks the ones walked", async () => {
    await renderPlayer()
    const item = (href: string) => document.querySelector<HTMLButtonElement>(`[data-testid="demo-sidebar"] [data-nav-href="${href}"]`)!
    await act(async () => item("/boards").click())
    await settle()
    expect(frontier().sectionId).toBe("task")

    // The inbox is behind now. It opens on its first step, with the arrow —
    // not «prepared for you, read-only».
    await act(async () => item("/inbox").click())
    await settle()
    expect(frontier()).toMatchObject({ sectionId: "conversation", stepId: "conversation-channels" })
    expect(container.textContent).not.toContain(S.reviewMode)
    expect(document.querySelector('[data-testid="demo-coach-card"]')).not.toBeNull()

    // Walk the inbox module (both its chapters): the menu ticks it, and only it.
    await walkTo("lead-list-stats")
    expect(item("/inbox").querySelector('[data-nav-done="true"]')).not.toBeNull()
    expect(item("/boards").querySelector('[data-nav-done="true"]')).toBeNull()
  }, 60_000)
})

/**
 * What the owner asked for on 22.09.2026, looking at the demo on his own
 * screen: the campaign chapter must show the CRM's own work and not invent an
 * Instagram open rate; the customer card must carry the phone from the
 * request; and the composer must work — with a limit that says why it stops.
 */
describe("what each chapter actually shows", () => {
  it("opens on a working team's campaigns, not a row of zeros", async () => {
    await renderPlayer()
    await walkTo("source-stats")
    const stats = [...container.querySelectorAll('[data-tour-id="campaigns-stats"] > *')].map((card) => card.textContent ?? "")
    // Draft, scheduled, sending, sent, cancelled — counted from the list itself.
    expect(stats.map((card) => /(\d+)/.exec(card)?.[1])).toEqual(["1", "1", "0", "4", "1"])
    const list = textOf('[data-tour-id="campaigns-list"]')
    for (const type of ["typeEmail", "typeSms", "typeWhatsapp", "typeTelegram"] as const) expect(list).toContain(messages.campaigns[type])
    expect(list).not.toContain("Instagram")
    expect(list).not.toContain("Veb-çat")
  }, 60_000)

  it("records opens and clicks for the e-mail campaign that brought the prospect", async () => {
    await renderPlayer()
    await walkTo("source-analytics")
    // 468 and 97 of 1,240: the e-mail counters the product does record.
    const rates = textOf('[data-tour-id="campaigns-analytics"]')
    expect(rates).toContain("38%")
    expect(rates).toContain("8%")
    // The «e-mail only» sentence is for the other campaign types.
    expect(textOf('[data-testid="demo-scene-campaign-detail"]')).not.toContain(messages.campaigns.detailEngagementEmailOnly)
  }, 60_000)

  it("counts what the campaign brought: the product's funnel, without a «leads» step, and the money", async () => {
    await renderPlayer()
    await walkTo("source-funnel")
    const funnel = textOf('[data-tour-id="campaign-funnel"]')
    // The campaign ROI screen's own funnel: no lead carries a campaign, a deal does.
    expect(funnel).not.toContain(messages.campaignRoi.leads)
    for (const label of [messages.campaignRoi.opened, messages.campaignRoi.clicked, messages.campaignRoi.deals, messages.campaignRoi.wonDeals]) {
      expect(funnel).toContain(label)
    }
    const money = textOf('[data-tour-id="campaign-roi"]')
    expect(money).toContain("2,400 ₼")
    expect(money).toContain("9,600 ₼")
    expect(money).toContain("+300%")
  }, 60_000)

  it("shows the phone from the request on the customer card, and WhatsApp beside the channel it came from", async () => {
    await renderPlayer()
    await walkTo("conversation-contact")
    const panel = textOf('[data-tour-id="inbox-contact-panel"]')
    expect(panel).toContain("+994 ••••• 67")
    expect(panel).toContain(S.contactPhoneFromRequest)
    expect(panel).toContain("WhatsApp")
    // An Instagram ad's prospect writes from the site: Direct is not offered to customers yet.
    expect(panel).toContain("Web Chat")
    expect(panel).not.toContain("Instagram")
  }, 60_000)

  it("lets the prospect write, and after five messages says why it stops", async () => {
    await renderPlayer()
    await walkTo("ai-reply-composer")
    const composer = () => document.querySelector<HTMLDivElement>('[data-tour-id="inbox-composer"]')!
    const write = async (text: string) => {
      const box = composer().querySelector<HTMLTextAreaElement>("textarea")!
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!
      await act(async () => {
        setter.call(box, text)
        box.dispatchEvent(new Event("input", { bubbles: true }))
      })
      const send = buttonWithText(S.replySend, composer())
      if (!send) return false
      await act(async () => send.click())
      await settle(0)
      return true
    }

    for (let index = 1; index <= 5; index += 1) {
      expect(await write(`Sualım var — ${index}`), `message ${index} could not be sent`).toBe(true)
    }
    const thread = textOf('[data-tour-id="inbox-thread"]') || container.textContent || ""
    expect(thread).toContain("Sualım var — 5")

    // The sixth is refused, and the screen says why rather than going quiet.
    expect(await write("Altıncı")).toBe(false)
    expect(textOf('[data-tour-id="inbox-composer"]')).toContain(S.replyLimitBody(5))
    expect(composer().querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true)
  }, 60_000)
})

describe("the arrow's controls", () => {
  it("every step the prospect acts on names what to do and marks a real control", () => {
    const sources = [
      "src/components/demo-center/journey/demo-journey-guide.tsx",
      "src/components/demo-center/journey/demo-live-call.tsx",
      ...["campaign", "inbox", "lead", "board", "deal", "quote", "mtm", "summary"].map((scene) => `src/components/demo-center/journey/scenes/${scene}-scene.tsx`),
    ].map((file) => readFileSync(path.join(process.cwd(), file), "utf8")).join("\n")
    const withCall = withLiveCall(PROSPECT_TO_CLOSED_WON).sections.flatMap((section) => section.steps)
    for (const step of new Map([...steps, ...withCall.map((candidate) => [candidate.id, candidate] as const)]).values()) {
      if (step.action === "observe" || step.action === "wait") continue
      expect(step.targetLabel, `${step.id} has no words for the arrow`).toMatch(/\S/)
      // The guide marks its own step button with the step's id at run time.
      if (step.anchor === "demo-guide-panel" && step.completion.kind === "transition") continue
      // The marker call itself, not any mention of the id (scenes also name steps in their guards).
      const marked = new RegExp(`demoTarget\\([^)]*"${step.id}"`).test(sources) || (step.id === DEMO_LIVE_CALL_STEP_ID && sources.includes("demoTarget(DEMO_LIVE_CALL_STEP_ID)"))
      expect(marked, `${step.id}: no control marks demoTarget("${step.id}")`).toBe(true)
    }
  })
})

/**
 * Omni Channel is the product the owner advertises, and its demo showed one
 * Instagram conversation in an empty list (2026-10-13). The inbox is now
 * filled like a working company's, and the module's steps are the things that
 * sell it: every channel in one list, the AI draft a person approves, a note
 * the customer never sees, a hand-over to a colleague.
 */
describe("the Omni Channel module", () => {
  const rows = () => [...container.querySelectorAll<HTMLElement>("[data-inbox-row]")]
  const rail = (channel: string) => container.querySelector<HTMLButtonElement>(`[data-inbox-channel="${channel}"]`)!

  it("opens on an inbox with conversations from many channels, and filters them by one click", async () => {
    await renderPlayer()
    await walkTo("conversation-channels")
    // The prospect's own request and the company's other conversations.
    expect(rows().length).toBeGreaterThanOrEqual(8)
    expect(rows()[0].getAttribute("data-inbox-row")).toBe("own")
    const channels = ["whatsapp", "telegram", "email", "facebook", "web-chat", "tiktok"]
    for (const channel of channels) expect(rail(channel).textContent, channel).toMatch(/\d/)
    expect(container.textContent).toContain(S.unanswered)

    // The step's own control: WhatsApp. Only WhatsApp conversations stay, and the story moves on.
    await act(async () => findDemoTarget("conversation-channels")!.click())
    await settle()
    expect(rail("whatsapp").getAttribute("aria-pressed")).toBe("true")
    expect(rows().map((row) => row.getAttribute("data-inbox-row"))).toEqual(["wa-delivery", "wa-payment"])
    expect(frontier().stepId).toBe("conversation-views")
  }, 60_000)

  it("lets any conversation be read: who wrote, on which channel, where the AI agent answered", async () => {
    await renderPlayer()
    await walkTo("conversation-channels")
    await act(async () => container.querySelector<HTMLElement>('[data-inbox-row="tg-price"]')!.click())
    await settle()
    const thread = container.querySelector('[data-testid="demo-inbox-sample-thread"]')!
    expect(thread.textContent).toContain("Telegram")
    expect(thread.textContent).toContain(messages.inboxV2.messageAuthorAi)
    // Reading it is not a step: the story has not moved, and nothing was scolded.
    expect(frontier().stepId).toBe("conversation-channels")
    expect(toasts).toEqual([])
    // The internal note sits between the messages, marked as the team's.
    await act(async () => container.querySelector<HTMLElement>('[data-inbox-row="tg-contract"]')!.click())
    await settle()
    expect(container.querySelector('[data-testid="demo-inbox-sample-thread"]')!.textContent).toContain(messages.inboxV2.composer_note)
  }, 60_000)

  it("finds the prospect's own conversation again when its step comes, and gives the whole list back after", async () => {
    await renderPlayer()
    await walkTo("conversation-open")
    // WhatsApp was picked two steps ago; the request came from another channel.
    expect(findDemoTarget("conversation-open"), "the own conversation is in the list").not.toBeNull()

    // Opened, it sits in the full list again — in this chapter and the next:
    // the WhatsApp filter used to follow the prospect and hide all but two rows.
    await walkTo("conversation-contact")
    expect(rows().length).toBeGreaterThanOrEqual(8)
    expect(rail("whatsapp").getAttribute("aria-pressed")).toBe("false")
    await walkTo("ai-reply-draft")
    expect(rows().length).toBeGreaterThanOrEqual(8)
    expect(rows()[0].getAttribute("data-inbox-row")).toBe("own")
  }, 60_000)

  it("writes to the team without the customer seeing it, then hands the conversation over", async () => {
    await renderPlayer()
    await walkTo("ai-reply-note")
    await act(async () => findDemoTarget("ai-reply-note")!.click())
    await settle()
    expect(textOf('[data-tour-id="inbox-composer"]')).toContain(messages.inboxV2.teamBannerInternal)
    expect(frontier().stepId).toBe("ai-reply-assign")

    // The assign control opens the colleagues; picking one moves the story on.
    await act(async () => findDemoTarget("ai-reply-assign")!.click())
    await settle()
    const colleague = findDemoTarget("ai-reply-assign")!
    const name = colleague.textContent!.trim()
    await act(async () => colleague.click())
    await settle()
    expect(textOf('[data-tour-id="inbox-assign"]')).toContain(name)
    expect(frontier().stepId).toBe("ai-reply-composer")
  }, 60_000)
})

describe("a chapter's clip", () => {
  it("opens the chapter at the top of the product screen, not down the guide's column", async () => {
    // Owner, 2026-10-13: the video sat «at the bottom, on the right, where
    // nobody looks» — a 300px thumbnail under the step card.
    await renderPlayer()
    await walkTo("source-stats")
    const scene = container.querySelector("#demo-scene")!
    const clip = scene.querySelector('[data-testid="demo-intro-clip"]')
    expect(clip, "the campaigns chapter opens with its clip").not.toBeNull()
    // Before the screen it introduces, with the poster and the button in words.
    expect(scene.firstElementChild).toBe(clip)
    expect(clip!.querySelector("img")).not.toBeNull()
    expect(clip!.textContent).toContain(S.clipWatch)
    expect(container.querySelector('[data-testid="demo-guide"] [data-testid="demo-intro-clip-play"]')).toBeNull()

    // A step later it is one line: the product screen has the room back.
    await walkTo("source-open-campaign")
    const line = scene.querySelector('[data-testid="demo-intro-clip-play"]')
    expect(line?.textContent).toContain(S.clipWatch)
    expect(scene.querySelector('[data-testid="demo-intro-clip"]')).toBeNull()

    // The next chapter brings its own clip — and only its own: the campaigns'
    // line used to stay on screen above it.
    const inbox = PROSPECT_TO_CLOSED_WON.sections.find((section) => section.id === "conversation")!
    await walkTo(inbox.steps[0].id)
    const offers = [...scene.querySelectorAll('[data-testid="demo-intro-clip-play"]')]
    expect(offers).toHaveLength(1)
    expect(scene.textContent).toContain(inbox.intro!.caption)
    expect(scene.textContent).not.toContain(PROSPECT_TO_CLOSED_WON.sections.find((section) => section.id === "source")!.intro!.caption)
  }, 60_000)
})

describe("the talking guide", () => {
  it("is silent until asked, then reads each step as it opens, and stops for a clip", async () => {
    const played: string[] = []
    let pauses = 0
    let players = 0
    class FakeAudio {
      src = ""
      constructor() {
        players += 1
      }
      play() {
        played.push(this.src)
        return Promise.resolve()
      }
      pause() {
        pauses += 1
      }
    }
    vi.stubGlobal("Audio", FakeAudio)
    window.localStorage.removeItem("ld_demo_guide_voice")

    await renderPlayer()
    const first = steps.get(frontier().stepId)!
    expect(played, "no sound before the prospect asks for it").toEqual([])

    // On a phone the coach card is what is on screen, so the switch is there —
    // and only there: the panel does not repeat it while the card is up.
    const panelSwitch = () => container.querySelector<HTMLButtonElement>('[data-testid="demo-guide-voice"]')
    expect(panelSwitch()).toBeNull()
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="demo-coach-voice"]')
    expect(toggle?.textContent).toContain(S.voiceOn)
    await act(async () => toggle!.click())
    await settle()
    // The click itself starts the current step — the browser allows sound inside it.
    expect(played).toEqual([stepVoiceUrl(first)])
    expect(document.querySelector('[data-testid="demo-coach-voice"]')?.textContent).toContain(S.voiceOff)

    // With the card put away the panel carries the same switch, already on.
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="demo-coach-close"]')!.click())
    await settle()
    expect(panelSwitch()?.textContent).toContain(S.voiceOff)

    await walkTo("source-stats")
    expect(played.at(-1)).toBe(stepVoiceUrl(steps.get("source-stats")!))
    // Two switches, one voice: every recording went through the same player.
    expect(players).toBe(1)

    const clip = container.querySelector<HTMLButtonElement>('[data-testid="demo-intro-clip-play"]')
    expect(clip, "the campaigns chapter offers its clip").not.toBeNull()
    const before = pauses
    await act(async () => clip!.click())
    await settle()
    expect(pauses, "a clip has its own voiceover; the guide falls silent").toBeGreaterThan(before)
  }, 60_000)
})

/**
 * Route & Field (owner, 2026-10-17: the modules in demand need a demo of
 * their own). It opens from the first screen as a module of its own, draws an
 * invented field team with the product's MTM components, and keeps the
 * owner's field rules on screen: nobody's place is shown during a break.
 */
describe("the Route & Field module", () => {
  it("opens from the first screen and leaves the lead story where it was", async () => {
    await renderPlayer()
    const choice = document.querySelector<HTMLButtonElement>('[data-start-section="mtm-today"]')
    expect(choice, "the first screen offers Route & Field").not.toBeNull()
    expect(choice!.textContent).toContain(messages.nav.groups["Route & Field"])
    await act(async () => choice!.click())
    await settle()
    expect(frontier()).toMatchObject({ sectionId: "mtm-today", stepId: "mtm-today-figures", state: "STARTED" })
    expect(textOf('[data-tour-id="mtm-home-kpis"]')).toContain(messages.mtmDashboardPage.home.kpiInField)
  }, 60_000)

  it("suggests a day of nearby clients and publishes it", async () => {
    await renderPlayer()
    await act(async () => document.querySelector<HTMLButtonElement>('[data-start-section="mtm-today"]')!.click())
    await settle()
    await walkTo("mtm-plan-suggest")
    const stops = () => document.querySelectorAll('[data-tour-id="mtm-plan-route"] ol > li')
    expect(stops()).toHaveLength(0)
    await act(async () => findDemoTarget("mtm-plan-suggest")!.click())
    await settle()
    // The product's own «suggest»: up to six clients not seen this month, nearest next.
    expect(stops()).toHaveLength(6)
    expect(frontier().stepId).toBe("mtm-plan-publish")
    await act(async () => findDemoTarget("mtm-plan-publish")!.click())
    await settle()
    // Published: the guide goes on to the live map.
    expect(frontier().sectionId).toBe("mtm-live")
  }, 60_000)

  it("shows nobody's place during a break, in the list and on the map", async () => {
    const { MTM_DEMO_AGENTS, mtmDemoLiveAgents } = await import("@/components/demo-center/journey/scenes/mtm-demo-data")
    const onBreak = MTM_DEMO_AGENTS.filter((agent) => agent.status === "PAUSED")
    expect(onBreak.length).toBeGreaterThan(0)
    for (const agent of onBreak) {
      expect(agent.latitude, agent.name).toBeUndefined()
      expect(mtmDemoLiveAgents("2026-10-20").map((marker) => marker.agentId)).not.toContain(agent.id)
    }
    await renderPlayer()
    await act(async () => document.querySelector<HTMLButtonElement>('[data-start-section="mtm-today"]')!.click())
    await settle()
    await walkTo("mtm-live-roster")
    expect(textOf('[data-tour-id="mtm-live-roster"]')).toContain(S.mtmOnBreak)
  }, 60_000)
})
