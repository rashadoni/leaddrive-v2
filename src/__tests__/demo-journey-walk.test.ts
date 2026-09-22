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
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const toasts = vi.hoisted(() => [] as string[])
vi.mock("sonner", () => ({
  toast: Object.assign((message: string) => toasts.push(String(message)), {
    info: (message: string) => toasts.push(String(message)),
    success: (message: string) => toasts.push(String(message)),
    error: (message: string) => toasts.push(String(message)),
  }),
  Toaster: () => null,
}))
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => createElement("img", { src: String(props.src ?? ""), alt: String(props.alt ?? "") }) }))

import { DemoJourneyPlayer } from "@/components/demo-center/journey/demo-journey-player"
import { findDemoTarget } from "@/components/demo-center/journey/demo-target"
import { DEMO_JOURNEY_STRINGS as S } from "@/components/demo-center/journey/strings"
import { PROSPECT_TO_CLOSED_WON, type DemoJourneyStep } from "@/lib/demo-center/journey"

const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages/az.json"), "utf8"))
const TOKEN = "walk-test-token-0001"
const STORAGE_KEY = `ld_demo_journey_${TOKEN.slice(-16)}`
const steps = new Map<string, DemoJourneyStep>(PROSPECT_TO_CLOSED_WON.sections.flatMap((section) => section.steps.map((step) => [step.id, step] as const)))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  toasts.length = 0
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
  if (target.matches("button, a, input")) return target
  // A marked region (the product's stage bar): press the part the arrow names.
  const named = /«([^»]+)»/.exec(step.targetLabel ?? "")?.[1]
  return named ? buttonWithText(named, target) : null
}

async function renderPlayer() {
  await act(async () => {
    root.render(
      createElement(NextIntlClientProvider, {
        locale: "az",
        messages,
        timeZone: "Asia/Baku",
        children: createElement(DemoJourneyPlayer, {
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
      }),
    )
  })
  await settle()
}

/** Walks from wherever the story is to its end; returns the steps taken. */
async function walkToEnd(): Promise<string[]> {
  const walked: string[] = []
  for (let guard = 0; guard < 200; guard += 1) {
    const { stepId, state } = frontier()
    if (state === "COMPLETED") break
    const step = steps.get(stepId)
    expect(step, `unknown frontier step ${stepId}`).toBeDefined()

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

  it("starts where the prospect's interest is: the first screen opens the inbox at once", async () => {
    await renderPlayer()
    const inbox = document.querySelector<HTMLButtonElement>('[data-start-section="conversation"]')
    expect(inbox, "the first screen offers the inbox").not.toBeNull()
    await act(async () => inbox!.click())
    await settle()
    expect(frontier()).toMatchObject({ sectionId: "conversation", stepId: "conversation-views" })
    // The scene the prospect lands on is the real inbox with their conversation, not an empty shell.
    expect(document.querySelector('[data-demo-target~="conversation-open"]')).not.toBeNull()
    expect(await walkToEnd()).toEqual(stepIdsFrom("conversation"))
  }, 60_000)

  it("opens a later section straight from the sidebar and carries on from there", async () => {
    await renderPlayer()
    const deals = document.querySelector<HTMLButtonElement>('[data-testid="demo-sidebar"] [data-nav-href="/deals"]')
    expect(deals?.getAttribute("data-nav-locked")).toBeNull()
    await act(async () => deals!.click())
    await settle()
    expect(frontier().sectionId).toBe("deal")
    expect(await walkToEnd()).toEqual(stepIdsFrom("deal"))
  }, 60_000)
})

describe("the arrow's controls", () => {
  it("every step the prospect acts on names what to do and marks a real control", () => {
    const sources = [
      "src/components/demo-center/journey/demo-journey-guide.tsx",
      ...["campaign", "inbox", "lead", "board", "deal", "quote", "summary"].map((scene) => `src/components/demo-center/journey/scenes/${scene}-scene.tsx`),
    ].map((file) => readFileSync(path.join(process.cwd(), file), "utf8")).join("\n")
    for (const step of steps.values()) {
      if (step.action === "observe" || step.action === "wait") continue
      expect(step.targetLabel, `${step.id} has no words for the arrow`).toMatch(/\S/)
      // The guide marks its own step button with the step's id at run time.
      if (step.anchor === "demo-guide-panel") continue
      expect(sources.includes(`"${step.id}"`), `${step.id}: no control marks demoTarget("${step.id}")`).toBe(true)
    }
  })
})
