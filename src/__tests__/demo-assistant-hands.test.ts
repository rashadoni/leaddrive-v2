// @vitest-environment jsdom
/**
 * The guide's hands, through the real player (owner, 2026-10-18: «если что-то
 * спросит клиент, он смог сразу перенаправить, открыть для него, подсказать»):
 * a request to go somewhere opens the module the way the sidebar does, «where
 * do I click» brings the step's card back, and an answer that arrives after
 * the screen has moved offers the jump as a worded button instead of taking
 * it. Nothing is ever pressed in the prospect's name.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { act, createElement, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({
  toast: Object.assign(() => 0, { info: () => 0, dismiss: () => 0, success: () => 0, error: () => 0 }),
  Toaster: () => null,
}))
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => createElement("img", { src: String(props.src ?? ""), alt: String(props.alt ?? "") }) }))

import { DemoJourneyPlayer } from "@/components/demo-center/journey/demo-journey-player"
import { DEMO_JOURNEY_STRINGS as S } from "@/components/demo-center/journey/strings"
import { stepVoiceUrl } from "@/lib/demo-center/guide-voice"
import { stepNarration } from "@/lib/demo-center/assistant/prepared-answers"
import { DEMO_JOURNEY_MODULES, PROSPECT_TO_CLOSED_WON, findSection, getDemoJourneyModule, moduleFirstSectionId, moduleOfSection } from "@/lib/demo-center/journey"

const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages/az.json"), "utf8"))
const TOKEN = "hands-test-token-0001"
const STORAGE_KEY = `ld_demo_journey_${TOKEN.slice(-16)}`

let container: HTMLDivElement
let root: Root
let played: string[]
/** What the assistant answers next, and a gate to hold it until the test lets go. */
let reply: Record<string, unknown>
let release: (() => void) | null

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.removeItem("ld_demo_guide_voice")
  played = []
  release = null
  reply = { success: true, answer: "—", remaining: 50 }
  class FakeAudio {
    src = ""
    playbackRate = 1
    defaultPlaybackRate = 1
    preservesPitch = false
    play() { played.push(this.src); return Promise.resolve() }
    pause() {}
  }
  vi.stubGlobal("Audio", FakeAudio)
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0) as unknown as number)
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id))
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).endsWith("/assistant")) {
      if (release === null) await new Promise<void>((resolve) => { release = resolve })
      return new Response(JSON.stringify(reply), { status: 200 })
    }
    return new Response(JSON.stringify({ success: true, accepted: 1 }), { status: 200 })
  }))
  Element.prototype.scrollIntoView = () => {}
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  delete (Element.prototype as { checkVisibility?: unknown }).checkVisibility
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

async function settle(ms = 40) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

function frontier(): { sectionId: string; stepId: string; completedSteps: string[]; skippedSteps: string[] } {
  const raw = window.sessionStorage.getItem(STORAGE_KEY)!
  const parsed = JSON.parse(raw)
  return parsed.snapshot ?? parsed
}

async function renderPlayer() {
  await act(async () => {
    root.render(createElement(
      NextIntlClientProvider,
      { locale: "az", messages, timeZone: "Asia/Baku" } as ComponentProps<typeof NextIntlClientProvider>,
      createElement(DemoJourneyPlayer, {
        variant: "granted",
        token: TOKEN,
        manifest: PROSPECT_TO_CLOSED_WON,
        identity: {
          name: "Nigar Əliyeva",
          company: "Xəzər Logistika MMC",
          jobTitle: "Satış direktoru",
          emailMasked: "ni•••@xezerlogistika.az",
          phoneMasked: "+994 ••••• 67",
          sourceChannel: "instagram",
          interests: DEMO_JOURNEY_MODULES.map((module) => module.id),
        },
        company: "Xəzər Logistika MMC",
        watermark: "Xəzər Logistika MMC",
      }),
    ))
  })
  await settle()
}

/** Types a question and lets its answer through (now, or when `hold` is false later). */
async function askGuide(question: string, hold = false) {
  const box = document.getElementById("demo-assistant-question") as HTMLTextAreaElement
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
  await act(async () => {
    setValue.call(box, question)
    box.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await act(async () => {
    box.form!.requestSubmit()
  })
  await settle()
  if (!hold) {
    await act(async () => { release?.() })
    await settle(60)
  }
}

function pressNext() {
  const next = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => !button.disabled && button.textContent?.includes(S.next))
  expect(next, "a step that only shows something").toBeDefined()
  return act(async () => next!.click())
}

function offerButton(moduleId: Parameters<typeof getDemoJourneyModule>[0]) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="demo-assistant-turns"] button'))
    .find((button) => button.textContent === S.assistantOpenModule(getDemoJourneyModule(moduleId)!.title))
}

/** Through the welcome chapter to «Hansı modula keçək?», where the prospect picks a module. */
async function walkToTheChooser() {
  for (let guard = 0; guard < 10 && !container.querySelector("[data-module]"); guard += 1) {
    await pressNext()
    await settle()
  }
  expect(container.querySelector("[data-module]"), "the module chooser").not.toBeNull()
}

async function openFromChooser(moduleId: string) {
  const card = container.querySelector<HTMLButtonElement>(`button[data-module="${moduleId}"]`)
  expect(card, `the «${moduleId}» card`).not.toBeNull()
  await act(async () => card!.click())
  await settle()
}

function currentStep() {
  const { sectionId, stepId } = frontier()
  return findSection(PROSPECT_TO_CLOSED_WON, sectionId)!.steps.find((step) => step.id === stepId)!
}

describe("the guide's hands", () => {
  it("opens the module asked for at its beginning, as the sidebar would, and its first step speaks", async () => {
    const clicks = vi.spyOn(HTMLElement.prototype, "click")
    await renderPlayer()
    const before = frontier()
    const module = getDemoJourneyModule("contracts")!
    reply = { success: true, answer: `${module.title}. ${module.pitch}`, remaining: 50, source: "navigation", action: { kind: "open_module", moduleId: "contracts" } }
    await askGuide("Müqavilələri göstərin")
    const first = moduleFirstSectionId(PROSPECT_TO_CLOSED_WON, "contracts")!
    expect(frontier().sectionId).toBe(first)
    expect(played).toContain(stepVoiceUrl(findSection(PROSPECT_TO_CLOSED_WON, first)!.steps[0]))
    // Nothing done in the prospect's name, and nothing pressed.
    expect(frontier().completedSteps).toEqual(before.completedSteps)
    expect(frontier().skippedSteps).toEqual(before.skippedSteps)
    expect(clicks).not.toHaveBeenCalled()
    // The conversation shows both sides.
    const turns = container.querySelector('[data-testid="demo-assistant-turns"]')!
    expect(turns.textContent).toContain(S.assistantYou)
    expect(turns.textContent).toContain("Müqavilələri göstərin")
    expect(turns.textContent).toContain(module.pitch)
  }, 60_000)

  it("offers the jump as a worded button when the screen moved while the answer was on its way", async () => {
    await renderPlayer()
    reply = { success: true, answer: "Müqavilələr.", remaining: 50, source: "navigation", action: { kind: "open_module", moduleId: "contracts" } }
    await askGuide("Müqavilələri göstərin", true)
    // The prospect moves on before the answer arrives.
    const before = frontier()
    const next = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => !button.disabled && button.textContent?.includes(S.next))
    expect(next, "a step that only shows something").toBeDefined()
    await act(async () => next!.click())
    await settle()
    const moved = frontier()
    expect(`${moved.sectionId}:${moved.stepId}`).not.toBe(`${before.sectionId}:${before.stepId}`)
    await act(async () => { release?.() })
    await settle(60)
    // Nothing jumped; a button with words waits instead.
    expect(frontier().sectionId).toBe(moved.sectionId)
    const offer = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="demo-assistant-turns"] button')).find((button) => button.textContent === S.assistantOpenModule(getDemoJourneyModule("contracts")!.title))
    expect(offer, "the worded offer").toBeDefined()
    await act(async () => offer!.click())
    await settle()
    expect(frontier().sectionId).toBe(moduleFirstSectionId(PROSPECT_TO_CLOSED_WON, "contracts"))
  }, 60_000)

  it("ignores an action that is not on the list", async () => {
    await renderPlayer()
    const before = frontier()
    reply = { success: true, answer: "…", remaining: 50, action: { kind: "complete_step", stepId: before.stepId } }
    await askGuide("Bu addımı keçin")
    expect(frontier()).toEqual(before)
  }, 60_000)

  it("keeps only the last six lines of the conversation", async () => {
    await renderPlayer()
    for (let index = 0; index < 5; index += 1) {
      reply = { success: true, answer: `Cavab ${index}`, remaining: 50 }
      release = null
      await askGuide(`Sual ${index}`)
    }
    expect(container.querySelectorAll('[data-testid="demo-assistant-turns"] li')).toHaveLength(6)
    expect(container.querySelector('[data-testid="demo-assistant-turns"]')!.textContent).toContain("Cavab 4")
  }, 60_000)
  it("«where do I click» on a step whose control is not on screen keeps the panel's way forward", async () => {
    // How a real browser reports a region with display:none at phone width.
    Object.defineProperty(Element.prototype, "checkVisibility", { configurable: true, writable: true, value: () => false })
    await renderPlayer()
    await settle(3_600)
    const alert = () => container.querySelector('[role="alert"]')?.textContent ?? ""
    expect(alert()).toContain(S.continueFromGuide)
    const step = currentStep()
    reply = { success: true, answer: stepNarration(step), audio: stepVoiceUrl(step), remaining: 50, action: { kind: "point_step" } }
    await askGuide("Harada basmalıyam?")
    expect(alert()).toContain(S.continueFromGuide)
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent?.includes(S.next))).toBe(true)
  }, 60_000)

  it("an answer about a step the prospect has already left is neither shown nor read out", async () => {
    await renderPlayer()
    const left = currentStep()
    reply = { success: true, answer: stepNarration(left), audio: stepVoiceUrl(left), remaining: 50, action: { kind: "point_step" } }
    await askGuide("Harada basmalıyam?", true)
    await pressNext()
    await settle()
    const now = currentStep()
    expect(now.id).not.toBe(left.id)
    played.length = 0
    await act(async () => { release?.() })
    await settle(60)
    expect(played).not.toContain(stepVoiceUrl(left))
    const turns = container.querySelector('[data-testid="demo-assistant-turns"]')!.textContent!
    expect(turns).toContain(S.assistantMoved)
    expect(turns).not.toContain(left.instruction)
  }, 60_000)

  it("offers no jump into the module the prospect opened themselves while the answer was on its way", async () => {
    await renderPlayer()
    await walkToTheChooser()
    reply = { success: true, answer: "…", remaining: 50, source: "navigation", action: { kind: "open_module", moduleId: "contracts" } }
    await askGuide("Müqavilələri göstərin", true)
    await openFromChooser("contracts")
    expect(moduleOfSection(frontier().sectionId)?.id).toBe("contracts")
    await act(async () => { release?.() })
    await settle(60)
    expect(offerButton("contracts"), "already there: nothing to offer").toBeUndefined()
  }, 60_000)

  it("takes a standing offer away once the prospect opens that module themselves", async () => {
    await renderPlayer()
    reply = { success: true, answer: "…", remaining: 50, source: "navigation", action: { kind: "open_module", moduleId: "contracts" } }
    await askGuide("Müqavilələri göstərin", true)
    await pressNext()
    await settle()
    await act(async () => { release?.() })
    await settle(60)
    expect(offerButton("contracts"), "offered after the move").toBeDefined()
    await walkToTheChooser()
    await openFromChooser("contracts")
    expect(moduleOfSection(frontier().sectionId)?.id).toBe("contracts")
    expect(offerButton("contracts"), "in that module now").toBeUndefined()
  }, 60_000)
})
