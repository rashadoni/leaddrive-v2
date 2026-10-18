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
import { DEMO_JOURNEY_MODULES, DEMO_NEXT_MODULE_STEP_ID, getDemoJourneyModule } from "@/lib/demo-center/journey"
import { LEADDRIVE_AGENT_PROFILE, LEADDRIVE_AGENT_PROMPT_WITH_STYLE } from "@/lib/demo-center/journey/leaddrive-agent-profile"

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
  // A list (the call outcome): choose the option the arrow names.
  if (target instanceof HTMLSelectElement) {
    const option = Array.from(target.options).find((candidate) => candidate.textContent?.trim() === named)
    if (!option) return null
    return { click: () => { target.value = option.value; target.dispatchEvent(new Event("change", { bubbles: true })) } } as unknown as HTMLElement
  }
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
            // Every module asked for, so «what next» suggests them in the story's own order.
            interests: DEMO_JOURNEY_MODULES.map((module) => module.id),
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

const stepsOf = (sectionId: string) => PROSPECT_TO_CLOSED_WON.sections.find((section) => section.id === sectionId)!.steps.map((step) => step.id)

/**
 * What following the arrow walks from the welcome screen: every module in
 * the story's order (all were asked for), each opened from «what next», then
 * «Demonu bitir» there and the last screen (owner, 2026-10-18: the guide asks
 * where to go next instead of crossing a module's edge by itself).
 */
const WALK_BY_MODULES = [
  ...stepsOf("orientation"),
  ...DEMO_JOURNEY_MODULES.flatMap((module) => [DEMO_NEXT_MODULE_STEP_ID, ...module.sections.flatMap(stepsOf)]),
  DEMO_NEXT_MODULE_STEP_ID,
  ...stepsOf("summary"),
]

describe("the guided story, walked through the real screens", () => {
  it("reaches the end pressing only what the arrow points at", async () => {
    await renderPlayer()
    const walked = await walkToEnd()
    // Every step, required or not, was taken in order — none skipped.
    expect(walked).toEqual(WALK_BY_MODULES)
  }, 60_000)

  it("stops at the end of a module and asks where to go next, instead of opening the next one", async () => {
    // Owner, 2026-10-18: «гид сам переходит резко с одного модуля, когда
    // заканчивается, на другой модуль».
    await renderPlayer()
    await walkTo(DEMO_NEXT_MODULE_STEP_ID)
    // The welcome screen ends here first: the prospect picks where to begin.
    expect(textOf('[data-testid="demo-scene-next-module"]')).toContain(S.nextStartTitle)
    // Following the arrow: the campaigns, to their end.
    await walkTo("source-stats")
    await walkTo(DEMO_NEXT_MODULE_STEP_ID)
    const screen = textOf('[data-testid="demo-scene-next-module"]')
    expect(screen).toContain(S.nextAfterTitle(getDemoJourneyModule("marketing")!.title))
    // The arrow is on the module suggested next — the omni-channel — and every other module is offered too.
    const suggested = findDemoTarget(DEMO_NEXT_MODULE_STEP_ID)
    expect(suggested?.getAttribute("data-module")).toBe("omnichannel")
    expect(document.querySelector('[data-testid="demo-coach-arrow"], [data-testid="demo-coach-ring"]')).not.toBeNull()
    for (const { id } of DEMO_JOURNEY_MODULES) expect(document.querySelector(`[data-module="${id}"]`), id).not.toBeNull()
    expect(document.querySelector('[data-module="marketing"]')?.textContent).toContain(S.nextDone)
    // The prospect may choose another one than the suggestion…
    await act(async () => document.querySelector<HTMLButtonElement>('[data-module="contracts"]')!.click())
    await settle()
    expect(frontier()).toMatchObject({ sectionId: "ctr-list", stepId: "ctr-list-figures" })
  }, 60_000)

  it("offers the modules asked for on the request first, and finishes only on «Demonu bitir»", async () => {
    const { demoModuleChoices: choices } = await import("@/lib/demo-center/journey")
    const asked = choices(PROSPECT_TO_CLOSED_WON, {
      completedSteps: [],
      identity: { name: "", company: "", jobTitle: null, emailMasked: "", phoneMasked: null, sourceChannel: "website", interests: ["contracts", "ai-calls"] },
    })
    expect(asked.slice(0, 2).map((choice) => [choice.module.id, choice.chosen])).toEqual([["ai-calls", true], ["contracts", true]])
    expect(asked.slice(2).every((choice) => !choice.chosen)).toBe(true)
    // Nothing asked for: the form's defaults.
    const none = choices(PROSPECT_TO_CLOSED_WON, { completedSteps: [], identity: { name: "", company: "", jobTitle: null, emailMasked: "", phoneMasked: null, sourceChannel: "website" } })
    expect(none.filter((choice) => choice.chosen).map((choice) => choice.module.id)).toEqual(["omnichannel", "ai-calls", "deals"])

    await renderPlayer()
    await walkTo(DEMO_NEXT_MODULE_STEP_ID)
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="demo-next-finish"]')!.click())
    await settle()
    expect(frontier().sectionId).toBe("summary")
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
    expect(walked).toEqual(WALK_BY_MODULES)
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

    // The module runs to its end and stops on «what next» — it does not walk
    // on into the AI call by itself (owner, 2026-10-18).
    const first = await walkToEnd(undefined, DEMO_NEXT_MODULE_STEP_ID)
    expect(first).toEqual(getDemoJourneyModule("omnichannel")!.sections.flatMap(stepsOf))
    expect(textOf('[data-testid="demo-scene-next-module"]')).toContain(S.nextAfterTitle(getDemoJourneyModule("omnichannel")!.title))
    // The campaigns were jumped over, so they are what the arrow offers next.
    expect(findDemoTarget(DEMO_NEXT_MODULE_STEP_ID)?.getAttribute("data-module")).toBe("marketing")

    // Following the arrow walks every module not seen yet, and the last
    // screen comes only after «Demonu bitir».
    const rest = await walkToEnd()
    expect(rest.at(-stepsOf("summary").length - 1)).toBe(DEMO_NEXT_MODULE_STEP_ID)
    expect(new Set([...first, ...rest])).toEqual(new Set(stepIdsFrom("source")))
  }, 60_000)

  it("opens a later section straight from the sidebar and carries on from there", async () => {
    await renderPlayer()
    const deals = document.querySelector<HTMLButtonElement>('[data-testid="demo-sidebar"] [data-nav-href="/deals"]')
    expect(deals?.getAttribute("data-nav-locked")).toBeNull()
    await act(async () => deals!.click())
    await settle()
    expect(frontier().sectionId).toBe("deal")
    // Carried on to the end of the sales module, then «what next», then
    // through every module that was jumped over.
    const walked = await walkToEnd()
    const restOfSales = ["deal", "quote", "closed-won"].flatMap(stepsOf)
    expect(walked.slice(0, restOfSales.length + 1)).toEqual([...restOfSales, DEMO_NEXT_MODULE_STEP_ID])
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
      ...["campaign", "inbox", "ai-agent", "lead", "board", "deal", "quote", "support", "calls", "mtm", "personnel", "contracts", "next-module", "summary"].map((scene) => `src/components/demo-center/journey/scenes/${scene}-scene.tsx`),
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

/**
 * Owner, 2026-10-18: «гид направлял на готовый промт, стиль общения и база
 * знаний, а там уже стояло для LeadDrive CRM». The product's own AI agent
 * screen, with LeadDrive's own agent in it — the one its WhatsApp agent
 * answers with.
 */
describe("the AI agent's setup", () => {
  it("shows LeadDrive's own agent on the product's AI agent screen, and lets one choice be the prospect's", async () => {
    await renderPlayer()
    await walkTo("ai-agent-reply-mode")
    const scene = container.querySelector('[data-testid="demo-scene-ai-agent"]')!
    expect(scene).not.toBeNull()
    // The matrix lists channels this agent answers by the setting today — and no other.
    const matrix = textOf('[data-tour-id="inbox-reply-matrix"]')
    expect(matrix).toContain("Telegram")
    for (const absent of ["WhatsApp", "TikTok", "Facebook", "Instagram", "Da Vinci"]) expect(matrix, absent).not.toContain(absent)

    await act(async () => findDemoTarget("ai-agent-reply-mode")!.click())
    await settle()
    expect(frontier().stepId).toBe("ai-agent-prompt")

    const [prompt, knowledge] = [...scene.querySelectorAll<HTMLTextAreaElement>("textarea")]
    expect(prompt.value).toBe(LEADDRIVE_AGENT_PROMPT_WITH_STYLE)
    expect(prompt.value).toContain("# Ünsiyyət tərzi")
    expect(prompt.value).not.toContain(LEADDRIVE_AGENT_PROFILE.guardWording.split("\n")[1].slice(0, 40))
    expect(prompt.readOnly).toBe(true)
    expect(knowledge.value).toBe(LEADDRIVE_AGENT_PROFILE.knowledgeBase)
    const [model, language] = [...scene.querySelectorAll<HTMLSelectElement>('[data-tour-id="inbox-agent-settings"] select')]
    expect(model.value).toBe(LEADDRIVE_AGENT_PROFILE.model)
    expect(language.value).toBe("")
    // No field shows the product's placeholder — another business's example.
    for (const field of scene.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type=range]):not([type=checkbox])")) {
      expect(field.value, field.outerHTML.slice(0, 80)).toMatch(/\S/)
    }
    // The first five of LeadDrive's articles, and how many there are.
    const sources = textOf('[data-tour-id="inbox-agent-sources"]')
    expect(sources).toContain(`${LEADDRIVE_AGENT_PROFILE.articles.length} ${messages.settings.aiAgentKnowledgePublished}`)
    for (const article of LEADDRIVE_AGENT_PROFILE.articles.slice(0, 5)) expect(sources).toContain(article.title)
    expect(sources).not.toContain(LEADDRIVE_AGENT_PROFILE.articles[5].title)
    // Nothing leaves the demo: no link, no file picker.
    expect(scene.querySelector("a[href]")).toBeNull()
    expect(scene.querySelector('input[type="file"]')).toBeNull()
  }, 60_000)

  it("says the setup is shown, not edited, and the story does not move for it", async () => {
    await renderPlayer()
    await walkTo("ai-agent-prompt")
    const scene = container.querySelector('[data-testid="demo-scene-ai-agent"]')!
    const model = scene.querySelector<HTMLSelectElement>('[data-tour-id="inbox-agent-settings"] select')!
    await act(async () => {
      model.value = "claude-opus-4-8"
      model.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await settle()
    expect(toasts).toContain(S.agentSetupReadOnly)
    await act(async () => buttonWithText(messages.settings.saveBtn, scene)!.click())
    await settle()
    expect(toasts).toContain(S.demoButtonHint)
    expect(frontier().stepId).toBe("ai-agent-prompt")
    expect(steps.get("ai-agent-sources")!.instruction).toContain(String(LEADDRIVE_AGENT_PROFILE.articles.length))
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
  function fakeAudio(options: { refuse?: () => boolean } = {}) {
    const log = { played: [] as string[], rates: [] as number[], pauses: 0, players: 0 }
    class FakeAudio {
      src = ""
      playbackRate = 1
      defaultPlaybackRate = 1
      preservesPitch = false
      constructor() {
        log.players += 1
      }
      play() {
        if (options.refuse?.()) return Promise.reject(Object.assign(new Error("needs a click"), { name: "NotAllowedError" }))
        log.played.push(this.src)
        log.rates.push(this.playbackRate)
        return Promise.resolve()
      }
      pause() {
        log.pauses += 1
      }
    }
    vi.stubGlobal("Audio", FakeAudio)
    window.localStorage.removeItem("ld_demo_guide_voice")
    return log
  }

  it("speaks at once and briskly, reads each step as it opens, and picks up again after a clip", async () => {
    // Owner, 2026-10-18: «сразу не включен звук… как открывается демо сразу
    // гид с ним говорил» and «гид очень медленно разговаривает».
    const log = fakeAudio()
    await renderPlayer()
    await settle()
    const first = steps.get(frontier().stepId)!
    expect(log.played, "the first step speaks without being asked").toEqual([stepVoiceUrl(first)])
    expect(log.rates[0]).toBeGreaterThan(1)

    // On a phone the coach card is what is on screen, so the switch is there —
    // and only there: the panel does not repeat it while the card is up.
    const panelSwitch = () => container.querySelector<HTMLButtonElement>('[data-testid="demo-guide-voice"]')
    expect(panelSwitch()).toBeNull()
    const toggle = () => document.querySelector<HTMLButtonElement>('[data-testid="demo-coach-voice"]')
    expect(toggle()?.textContent).toContain(S.voiceOff)

    // Off stops it; on again says the current step inside the click.
    await act(async () => toggle()!.click())
    await settle()
    expect(toggle()?.textContent).toContain(S.voiceOn)
    await act(async () => toggle()!.click())
    await settle()
    expect(log.played.at(-1)).toBe(stepVoiceUrl(first))

    // With the card put away the panel carries the same switch, already on.
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="demo-coach-close"]')!.click())
    await settle()
    expect(panelSwitch()?.textContent).toContain(S.voiceOff)

    await walkTo("source-stats")
    expect(log.played.at(-1)).toBe(stepVoiceUrl(steps.get("source-stats")!))
    // Two switches, one voice: every recording went through the same player.
    expect(log.players).toBe(1)

    const clip = container.querySelector<HTMLButtonElement>('[data-testid="demo-intro-clip-play"]')
    expect(clip, "the campaigns chapter offers its clip").not.toBeNull()
    const before = log.pauses
    await act(async () => clip!.click())
    await settle()
    expect(log.pauses, "a clip has its own voiceover; the guide falls silent").toBeGreaterThan(before)
    const played = log.played.length
    await act(async () => {
      container.querySelector("video")!.dispatchEvent(new Event("ended"))
    })
    await settle()
    expect(log.played.length, "after the clip the guide says the step again").toBe(played + 1)
    expect(log.played.at(-1)).toBe(stepVoiceUrl(steps.get(frontier().stepId)!))
  }, 60_000)

  it("turns a refused start into the button that starts it, instead of a silent «on»", async () => {
    let refuse = true
    const log = fakeAudio({ refuse: () => refuse })
    await renderPlayer()
    await settle()
    expect(log.played).toEqual([])
    const button = () => document.querySelector<HTMLButtonElement>('[data-testid="demo-coach-voice"]')
    expect(button()?.dataset.blocked).toBe("true")
    expect(button()?.textContent).toContain(S.voiceUnblock)

    refuse = false
    await act(async () => button()!.click())
    await settle()
    expect(log.played).toEqual([stepVoiceUrl(steps.get(frontier().stepId)!)])
    expect(button()?.dataset.blocked).toBeUndefined()
    expect(button()?.textContent).toContain(S.voiceOff)
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
    expect(choice!.textContent).toContain(getDemoJourneyModule("route-field")!.title)
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

  it("records nothing from a break: the map keeps only the point from before it, grey", async () => {
    const { MTM_DEMO_AGENTS, mtmDemoRosterAgents } = await import("@/components/demo-center/journey/scenes/mtm-demo-data")
    const onBreak = MTM_DEMO_AGENTS.filter((agent) => agent.status === "PAUSED")
    expect(onBreak.length).toBeGreaterThan(0)
    for (const agent of onBreak) {
      // No current position, and the only point the roster carries is older than the break.
      expect(agent.latitude, agent.name).toBeUndefined()
      const row = mtmDemoRosterAgents("2026-10-15").find((candidate) => candidate.agentId === agent.id)!
      expect(row).toMatchObject({ workdayState: "PAUSED", freshness: "STALE", fieldStatus: "OFFLINE" })
      expect(Date.parse(row.recordedAt!)).toBeLessThan(Date.parse(row.workdayPausedAt!))
    }
    await renderPlayer()
    await act(async () => document.querySelector<HTMLButtonElement>('[data-start-section="mtm-today"]')!.click())
    await settle()
    await walkTo("mtm-live-roster")
    // The product's own table and its own words for him and for the grey point.
    expect(document.querySelector('[data-tour-id="mtm-live-roster"] [data-testid="live-map-roster"]')).not.toBeNull()
    expect(textOf('[data-testid="live-map-agent-status-agent-rauf"]')).toContain(messages.mtmMap.fieldStatus.offline)
    expect(textOf('[data-testid="mtm-live-last-known"]')).toContain(messages.mtmMap.lastKnownShown.split("{count}")[0].trim())
  }, 60_000)
})

/**
 * Personnel («Kadr uçotu», owner, 2026-10-17): the workday module. Its days
 * are an invented company's phone facts run through the product's own
 * timesheet builder, so the figures on «Bu gün» are the product's arithmetic,
 * and a corrected day shows what it was, what it became and who approved it.
 */
describe("the Personnel module", () => {
  const openPersonnel = async () => {
    await renderPlayer()
    const choice = document.querySelector<HTMLButtonElement>('[data-start-section="prs-today"]')
    expect(choice, "the first screen offers Personnel").not.toBeNull()
    expect(choice!.textContent).toContain(getDemoJourneyModule("personnel")!.title)
    await act(async () => choice!.click())
    await settle()
  }

  it("opens on the morning in four figures, without biometrics and without a place during a break", async () => {
    await openPersonnel()
    expect(frontier()).toMatchObject({ sectionId: "prs-today", state: "STARTED" })
    const kpis = textOf('[data-tour-id="prs-today-kpis"]')
    expect(kpis).toContain(messages.personnel.kpiArrived)
    expect(kpis).toContain(S.personnelPrivacy)
  }, 60_000)

  it("approves a leave in one click, then asks the late ones for an explanation", async () => {
    await openPersonnel()
    await walkTo("prs-today-approve")
    await act(async () => findDemoTarget("prs-today-approve")!.click())
    await settle()
    expect(textOf('[data-tour-id="prs-today-requests"]')).toContain(S.personnelApproved)
    expect(frontier().stepId).toBe("prs-today-explain")
    await act(async () => findDemoTarget("prs-today-explain")!.click())
    await settle()
    expect(frontier().sectionId).toBe("prs-timesheet")
  }, 60_000)

  it("shows a corrected day as before → after, with who approved it", async () => {
    await openPersonnel()
    await walkTo("prs-timesheet-day")
    await act(async () => findDemoTarget("prs-timesheet-day")!.click())
    await settle()
    // The step is done and the guide moves on.
    expect(frontier().sectionId).toBe("prs-risk")
    // What the card printed: the product's own correction line over the product's own timesheet.
    const { personnelDemoPlan, personnelDemoReport } = await import("@/components/demo-center/journey/scenes/personnel-demo-data")
    const { defaultAttendanceDayKinds } = await import("@/lib/mtm/attendance-day-kinds")
    const { attendanceCorrectionText } = await import("@/lib/mtm/attendance-presentation")
    const kinds = defaultAttendanceDayKinds((key) => {
      const name = (messages.mtmAttendance as Record<string, string>)[`dayKindName${key}`]
      return { az: name, ru: name, en: name }
    })
    const plan = personnelDemoPlan("2026-10-15")
    const corrected = personnelDemoReport("2026-10-15", plan.monthStart, plan.lastMonthEnd, kinds).rows.filter((row) => row.corrections?.length)
    expect(corrected).toHaveLength(1)
    const line = attendanceCorrectionText(corrected[0], corrected[0].corrections![0], "az", (key, values) => {
      let text = (messages.mtmAttendance as Record<string, string>)[key]
      for (const [name, value] of Object.entries(values ?? {})) text = text.replace(`{${name}}`, String(value))
      return text
    })
    expect(line).toContain("Orxan Musayev")
    expect(line).toContain("→")
    expect(corrected[0].dayKind?.key).toBe("WORKED")
  }, 60_000)
})

/**
 * Service Desk (owner, 2026-10-13): the support module. The queue's deadlines
 * come from the product's working-hours SLA clock, and what the screens say
 * about a reply is what the product does with one: WhatsApp and the portal,
 * never e-mail; Da Vinci drafts, the agent sends.
 */
describe("the Service Desk module", () => {
  const openServiceDesk = async () => {
    await renderPlayer()
    const choice = document.querySelector<HTMLButtonElement>('[data-start-section="sd-queue"]')
    expect(choice, "the first screen offers Service Desk").not.toBeNull()
    expect(choice!.textContent).toContain(getDemoJourneyModule("service-desk")!.title)
    await act(async () => choice!.click())
    await settle()
  }

  it("opens on the morning queue, counted from its own tickets", async () => {
    await openServiceDesk()
    expect(frontier()).toMatchObject({ sectionId: "sd-queue", stepId: "sd-queue-figures", state: "STARTED" })
    expect(textOf('[data-tour-id="sd-queue-kpis"]')).toContain(messages.tickets.newQueue)
    expect(textOf('[data-testid="sd-queue-new"]')).toBe("2")
    expect(textOf('[data-testid="sd-queue-unassigned"]')).toBe("3")
    expect(textOf('[data-testid="sd-queue-sla"]')).toBe("1")
    // The ticket past its deadline reads as breached, by the working-hours clock.
    expect(document.querySelectorAll('[data-tour-id="sd-queue-list"] [data-sla-state="breached"]').length).toBeGreaterThan(0)
  }, 60_000)

  it("takes the next ticket, lets Da Vinci draft and sends the reply where the product sends it", async () => {
    const { SUPPORT_DEMO_DRAFT } = await import("@/components/demo-center/journey/scenes/support-demo-data")
    await openServiceDesk()
    await walkTo("sd-queue-take")
    await act(async () => findDemoTarget("sd-queue-take")!.click())
    await settle()
    expect(frontier().sectionId).toBe("sd-ticket")
    await walkTo("sd-ticket-draft")
    const composer = () => document.querySelector<HTMLTextAreaElement>('[data-testid="sd-ticket-composer"]')!
    expect(composer().value).toBe("")
    await act(async () => findDemoTarget("sd-ticket-draft")!.click())
    await settle()
    // Drafted, not sent: the text waits in the reply box for the agent.
    expect(composer().value).toBe(SUPPORT_DEMO_DRAFT)
    expect(frontier().stepId).toBe("sd-ticket-send")
    expect(textOf('[data-testid="sd-ticket-audience"]')).toBe(messages.tickets.replyAudienceWhatsapp)
    await act(async () => findDemoTarget("sd-ticket-send")!.click())
    await settle()
    expect(frontier()).toMatchObject({ sectionId: "sd-resolve", stepId: "sd-resolve-close" })
  }, 60_000)

  it("resolving asks the customer on WhatsApp to confirm, and the ticket closes itself after a week of silence", async () => {
    const { SUPPORT_DEMO_TIMES } = await import("@/components/demo-center/journey/scenes/support-demo-data")
    await openServiceDesk()
    await walkTo("sd-resolve-close")
    // The reply and the customer's answer are on the ticket before it is resolved.
    expect(document.querySelector('[data-testid="sd-ticket-reply"]')).not.toBeNull()
    await act(async () => findDemoTarget("sd-resolve-close")!.click())
    await settle()
    expect(frontier().stepId).toBe("sd-resolve-wait")
    const closure = textOf('[data-tour-id="sd-resolve-closure"]')
    expect(closure).toContain(messages.tickets.closureRequestPending)
    expect(closure).toContain(messages.tickets.closureRequestSentDesc)
    expect(closure).toContain("whatsapp")
    // closure-requests.ts: seven days from the moment it was resolved.
    expect(closure).toContain(`${messages.tickets.closureRequestAutoClose}:`)
    expect(closure).toContain(SUPPORT_DEMO_TIMES.resolved)
  }, 60_000)

  it("shows the customer's side — the product's two WhatsApp messages and its closure page — and closes when the customer confirms", async () => {
    const { closureRequestWhatsAppText, ticketStatusWhatsAppText } = await import("@/lib/ticketing/customer-ticket-text")
    const { SUPPORT_DEMO_CLOSURE_LINK } = await import("@/components/demo-center/journey/scenes/support-demo-data")
    await openServiceDesk()
    await walkTo("sd-resolve-close")
    // Nothing reached the customer before the ticket is resolved.
    expect(document.querySelector('[data-tour-id="sd-resolve-customer"]')).toBeNull()
    await act(async () => findDemoTarget("sd-resolve-close")!.click())
    await settle()
    const side = textOf('[data-tour-id="sd-resolve-customer"]')
    expect(side).toContain(ticketStatusWhatsAppText("az", "resolved", "WA-0417")!)
    expect(side).toContain(closureRequestWhatsAppText("az", { ticketNumber: "WA-0417", confirmationUrl: SUPPORT_DEMO_CLOSURE_LINK }))
    expect(side).toContain(messages.portal.closureTitle)
    expect(side).toContain(messages.portal.closureStatus.pending)
    // The customer's messages come from the support line, never with the AI's marker.
    expect(document.querySelector('[data-tour-id="sd-resolve-customer"] svg.lucide-sparkles')).toBeNull()

    // «Dəstəyə qaytar» would reopen it; the demo explains instead of acting.
    await act(async () => document.querySelector<HTMLButtonElement>('[data-tour-id="sd-resolve-customer"] [data-testid="ticket-closure-reject"]')!.click())
    await settle()
    expect(toasts).toContain(S.supportRejectHint)
    expect(frontier().stepId).toBe("sd-resolve-wait")

    await act(async () => findDemoTarget("sd-resolve-wait")!.click())
    await settle()
    // Confirmed, and shown: the ticket reads closed, the request confirmed, the customer thanked.
    expect(frontier().stepId).toBe("sd-resolve-closed")
    expect(textOf('[data-tour-id="sd-ticket-status"]')).toContain(messages.tickets.statusClosed)
    expect(textOf('[data-tour-id="sd-resolve-closure"]')).toContain(messages.tickets.closureRequestConfirmed)
    expect(textOf('[data-tour-id="sd-resolve-customer"]')).toContain(messages.portal.closureConfirmedMessage)
    // The agent's card and the customer's page give one auto-close time, on Baku's clock.
    const { SUPPORT_DEMO_TIMES } = await import("@/components/demo-center/journey/scenes/support-demo-data")
    expect(textOf('[data-tour-id="sd-resolve-customer"]')).toContain(SUPPORT_DEMO_TIMES.resolved)
    await walkTo("sd-rules-sla")
    expect(frontier().sectionId).toBe("sd-rules")
  }, 60_000)

  it("shows the agent's month as the product's own arithmetic", async () => {
    const { supportDemoAgentMetrics } = await import("@/components/demo-center/journey/scenes/support-demo-data")
    const { mtmDemoToday } = await import("@/components/demo-center/journey/scenes/mtm-demo-data")
    await openServiceDesk()
    await walkTo("sd-results-metrics")
    const raw = window.sessionStorage.getItem(STORAGE_KEY)!
    const startedAt = (JSON.parse(raw).snapshot ?? JSON.parse(raw)).startedAt as string
    const metrics = supportDemoAgentMetrics(mtmDemoToday(startedAt))
    expect(textOf('[data-testid="sd-metric-rate"]')).toBe(`${metrics.resolutionRatePct}%`)
    expect(textOf('[data-testid="sd-metric-sla"]')).toBe(`${metrics.slaCompliancePct}%`)
    expect(metrics.csatSample).toBeGreaterThan(10)
  }, 60_000)
})

/**
 * Call Center (owner, 2026-10-13; 2026-10-17: the company's own PBX, and
 * only what every seller has). The log's figures are the call route's own
 * rules over the same filtered calls; a «Geri zəng» outcome asks for a time and becomes the
 * seller's promise, which the escalation ladder and the late-callbacks report
 * then judge.
 */
describe("the Call Center module", () => {
  const openCalls = async () => {
    await renderPlayer()
    const choice = document.querySelector<HTMLButtonElement>('[data-start-section="cc-log"]')
    expect(choice, "the first screen offers Call Center").not.toBeNull()
    expect(choice!.textContent).toContain(getDemoJourneyModule("call-center")!.title)
    await act(async () => choice!.click())
    await settle()
  }
  const demoToday = async () => {
    const { mtmDemoToday } = await import("@/components/demo-center/journey/scenes/mtm-demo-data")
    const raw = window.sessionStorage.getItem(STORAGE_KEY)!
    return mtmDemoToday((JSON.parse(raw).snapshot ?? JSON.parse(raw)).startedAt as string)
  }

  it("counts the month by the call log's rules and recounts it for the filter", async () => {
    const { callsDemoLog, callsDemoSummary } = await import("@/components/demo-center/journey/scenes/calls-demo-data")
    await openCalls()
    expect(frontier()).toMatchObject({ sectionId: "cc-log", stepId: "cc-log-figures", state: "STARTED" })
    const calls = callsDemoLog(await demoToday())
    const all = callsDemoSummary(calls)
    const summary = () => textOf('[data-tour-id="cc-log-summary"]')
    expect(textOf('[data-testid="voip-workspace"]')).toContain(messages.voip.connectionState.configured)
    expect(summary()).toContain(String(all.total))
    expect(all.missed).toBeGreaterThan(0)
    expect(all.total).toBe(all.inbound + all.outbound)
    await walkTo("cc-log-filter")
    await act(async () => findDemoTarget("cc-log-filter")!.click())
    await settle()
    expect(frontier().stepId).toBe("cc-log-missed")
    const inbound = callsDemoSummary(calls.filter((call) => call.direction === "inbound"))
    expect(summary()).toContain(`${messages.voip.totalCalls}${inbound.total}`)
    expect(inbound.outbound).toBe(0)
    // Only customers' calls are left in the list, and the one nobody took is on top.
    const rows = textOf('[data-tour-id="cc-log-timeline"] tbody')
    expect(rows).not.toContain(messages.voip.outbound)
    expect(rows).toContain(messages.voip.statusLabels.noAnswer)
  }, 60_000)

  it("calls from the lead card through the own PBX and files the promised callback with its time", async () => {
    const { CALLS_DEMO_PROVIDER, callsDemoCallbackAt } = await import("@/components/demo-center/journey/scenes/calls-demo-data")
    const { formatDateTime } = await import("@/lib/format-date")
    await openCalls()
    await walkTo("cc-call-dial")
    // The first press asks which service; the only one is already chosen.
    await act(async () => findDemoTarget("cc-call-dial")!.click())
    await settle()
    const picker = document.querySelector<HTMLSelectElement>(`select[aria-label="${messages.voip.chooseCallProvider}"]`)
    expect(picker?.value).toBe(CALLS_DEMO_PROVIDER.id)
    expect(frontier().stepId).toBe("cc-call-dial")
    await act(async () => findDemoTarget("cc-call-dial")!.click())
    await settle()
    const widget = () => textOf('[data-tour-id="cc-call-widget"]')
    expect(widget()).toContain(messages.voip.activeCall)
    // The station rings the customer first: until the answer the window says «started».
    expect(widget()).toContain(messages.voip.statusLabels.initiated)
    await act(async () => findDemoTarget("cc-call-end")!.click())
    await settle()
    expect(widget()).toContain(messages.voip.callEnded)
    expect(frontier().stepId).toBe("cc-call-outcome")
    await act(async () => control(steps.get("cc-call-outcome")!)!.click())
    await settle()
    expect(widget()).toContain(messages.voip.outcomePicker.callbackWhen)
    await act(async () => findDemoTarget("cc-call-callback")!.click())
    await settle()
    // The window confirms it in its own words, with the time it was given.
    expect(frontier().stepId).toBe("cc-call-saved")
    const time = formatDateTime(callsDemoCallbackAt(await demoToday()), "az")
    expect(widget()).toContain(messages.voip.outcomePicker.callbackSaved.replace("{time}", time))
  }, 60_000)

  it("tells the seller when the promise falls due and the managers 45 minutes later, and judges the week by calls made", async () => {
    const { COMMITMENT_ALERT_TITLES, MANAGER_GRACE_MINUTES } = await import("@/lib/commitments/escalation")
    const { callsDemoAlerts, callsDemoCallbackAt, callsDemoLateCallbacks } = await import("@/components/demo-center/journey/scenes/calls-demo-data")
    await openCalls()
    await walkTo("cc-promise-alerts")
    const today = await demoToday()
    const alerts = callsDemoAlerts(callsDemoCallbackAt(today))
    expect(alerts.map((alert) => alert.step)).toEqual(["notify-assignee", "escalate-manager"])
    expect(Date.parse(alerts[1].createdAt) - Date.parse(alerts[0].createdAt)).toBe(MANAGER_GRACE_MINUTES * 60_000)
    const shown = textOf('[data-tour-id="cc-promise-alerts"]')
    expect(shown).toContain(COMMITMENT_ALERT_TITLES.assignee)
    expect(shown).toContain(COMMITMENT_ALERT_TITLES.manager)
    const report = callsDemoLateCallbacks(today)
    expect(report.totals).toEqual({ promises: 6, onTime: 3, late: 2, missed: 1 })
    const table = textOf('[data-tour-id="cc-promise-report"]')
    expect(table).toContain(messages.leads.lateCallbacksTitle)
    expect(table).toContain(messages.leads.lateCallbacksNeverCalled)
  }, 60_000)
})

/**
 * Contracts (owner, 2026-10-13): the draft an accepted quote wrote goes
 * through the approval chain, the product's own e-signature and into the
 * renewal reminders — every figure the product's own arithmetic.
 */
describe("the Contracts module", () => {
  const openContracts = async () => {
    await renderPlayer()
    const choice = document.querySelector<HTMLButtonElement>('[data-start-section="ctr-list"]')
    expect(choice, "the first screen offers Contracts").not.toBeNull()
    expect(choice!.textContent).toContain(getDemoJourneyModule("contracts")!.title)
    await act(async () => choice!.click())
    await settle()
  }
  const demoToday = async () => {
    const { mtmDemoToday } = await import("@/components/demo-center/journey/scenes/mtm-demo-data")
    const raw = window.sessionStorage.getItem(STORAGE_KEY)!
    return mtmDemoToday((JSON.parse(raw).snapshot ?? JSON.parse(raw)).startedAt as string)
  }

  it("lists the portfolio by the list page's arithmetic, with the quote's draft on top", async () => {
    const { contractsDemoList, contractsDemoStats } = await import("@/components/demo-center/journey/scenes/contracts-demo-data")
    await openContracts()
    expect(frontier()).toMatchObject({ sectionId: "ctr-list", stepId: "ctr-list-figures", state: "STARTED" })
    const today = await demoToday()
    const rows = contractsDemoList(today)
    const stats = contractsDemoStats(today, rows)
    const figures = textOf('[data-tour-id="ctr-list-stats"]')
    expect(figures).toContain(`${messages.contracts.statActive}${stats.activeCount}`)
    expect(figures).toContain(`${messages.contracts.statExpiringSoon}${stats.expiringSoon}`)
    // The draft's title is the one accepting the quote writes, in Azerbaijani.
    expect(rows[0].title).toBe("Q-2026-031 təklifinin qəbulu")
    expect(textOf('[data-tour-id="ctr-list-table"]')).toContain(rows[0].title)
  }, 60_000)

  it("sends the draft through both approval levels, then to the signer, and it turns active", async () => {
    await openContracts()
    await walkTo("ctr-approve-submit")
    const status = () => textOf('[data-testid="ctr-status"]')
    expect(status()).toBe(messages.contracts.statusDraft)
    await act(async () => findDemoTarget("ctr-approve-submit")!.click())
    await settle()
    expect(frontier().stepId).toBe("ctr-approve-submit")
    await act(async () => findDemoTarget("ctr-approve-submit")!.click())
    await settle()
    expect(status()).toBe(messages.contracts.statusPendingApproval)
    const chain = () => textOf('[data-tour-id="ctr-approve-chain"]')
    expect(chain()).toContain(messages.contracts.approvalStatusPending)
    expect(chain()).toContain(messages.contracts.approvalRoleManager)
    expect(chain()).not.toMatch(/\bpending\b|\bmanager\b|h SLA/)
    await act(async () => findDemoTarget("ctr-approve-decide")!.click())
    await settle()
    expect(frontier().stepId).toBe("ctr-approve-decide")
    await act(async () => findDemoTarget("ctr-approve-decide")!.click())
    await settle()
    expect(frontier().stepId).toBe("ctr-approve-done")
    expect(status()).toBe(messages.contracts.statusApproved)
    await walkTo("ctr-sign-send")
    await act(async () => findDemoTarget("ctr-sign-send")!.click())
    await settle()
    await act(async () => findDemoTarget("ctr-sign-send")!.click())
    await settle()
    expect(frontier().stepId).toBe("ctr-sign-customer")
    expect(textOf('[data-tour-id="ctr-sign-customer"]')).toContain(messages.signPortal.signButton)
    await act(async () => findDemoTarget("ctr-sign-customer")!.click())
    await settle()
    expect(frontier().stepId).toBe("ctr-sign-active")
    expect(status()).toBe(messages.contracts.statusActive)
    expect(textOf('[data-testid="ctr-envelope-status"]')).toBe(messages.contracts.esignStatusCompleted)
  }, 60_000)

  it("ends on what was done in Contracts, without crediting a deal the prospect never saw", async () => {
    await openContracts()
    // Contracts to their end, then «Demonu bitir» on «what next».
    await walkToEnd(undefined, DEMO_NEXT_MODULE_STEP_ID)
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="demo-next-finish"]')!.click())
    await settle()
    expect(frontier().sectionId).toBe("summary")
    const cards = [...document.querySelectorAll('[data-testid="demo-summary-module"]')]
    expect(cards.map((card) => card.getAttribute("data-module-route"))).toEqual(["/contracts"])
    expect(cards[0].textContent).toContain("Sənəd imzalandı.")
    expect(cards[0].textContent).toContain(S.moduleValue["/contracts"])
    // The lead story was staged to its end on the way, not walked: no source → won card.
    expect(document.querySelector('[data-tour-id="journey-attribution"]')).toBeNull()
  }, 60_000)

  it("keeps the renewals by the product's schedule and writes the alert in the managers' language", async () => {
    const { contractsDemoLifecycle, contractsDemoBell } = await import("@/components/demo-center/journey/scenes/contracts-demo-data")
    await openContracts()
    await walkTo("ctr-control-renewals")
    const today = await demoToday()
    const view = contractsDemoLifecycle(today)
    expect(textOf('[data-testid="ctr-kpi-renewals"]')).toBe(String(view.renewals.total))
    // A reminder that came due was delivered by the morning job and left the page.
    expect(view.renewals.overdueCount).toBe(0)
    expect(view.renewals.items.every((item) => [90, 60, 30, 14, 7].includes(item.daysBeforeExpiry))).toBe(true)
    const bell = contractsDemoBell(today)!
    expect(bell.title).toMatch(/^Müqavilənin müddəti bitir: /)
    expect(textOf('[data-testid="ctr-bell-title"]')).toBe(bell.title)
  }, 60_000)
})
