// @vitest-environment jsdom
/**
 * «Обучение ИИ»: the sticky section bar (owner, 2026-11-24, screenshot «исправь ui»).
 *
 * The page scrolls inside the dashboard's <main>, which has its own padding. The bar used to stick
 * at that padding's inner edge — cards showed through the band above it — and its translucent,
 * blurred background showed the white cards beneath as a shifted grey box. Its «Hazırlıq» tab
 * scrolled the window, which never scrolls, and on a phone (two-row bar) a section landed under it.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  const { default: messages } = await import("../../messages/az.json")
  const translators = new Map<string, unknown>()
  return {
    ...actual,
    useLocale: () => "az",
    useTranslations: (namespace: string) => {
      if (!translators.has(namespace)) {
        translators.set(namespace, actual.createTranslator({ locale: "az", messages: messages as never, namespace: namespace as never }))
      }
      return translators.get(namespace)
    },
  }
})
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))

import { AiTrainingScreen } from "@/components/inbox-learning/ai-training-screen"
import { TooltipProvider } from "@/components/ui/tooltip"

const channel = {
  id: "c1", channelType: "instagram", name: "@leaddrive.az", mode: "learning", startedAt: "2026-11-20T00:00:00Z",
  readiness: { compared: 14, percent: 62, topicPercent: 50, topicsKnown: 3, topicsTotal: 6 }, waiting: 0, knowledge: 1,
}
const item = (id: string, kind: "knowledge" | "trait", type: string) => ({
  id, kind, type, title: `Qeyd ${id}`, body: "Mətn", status: "active", alternatives: [], source: "learned",
  seenCount: 1, lastSeenAt: "2026-11-23T10:00:00Z", edited: false, approvedAt: null, from: null,
})
const detail = {
  channel,
  readiness: { compared: 14, same: 8, almost: 3, different: 2, handoff: 1, percent: 62, trend: [], topics: [], topicsKnown: 3, topicPercent: 50 },
  progress: { since: null, answersTotal: 4, answersRead: 4, conversationsTotal: 2, conversationsRead: 2, compared: 14, minQuestions: 10, lastRunAt: null, stopped: null, state: "listening" },
  differences: [], conversations: 2,
  items: [item("t1", "trait", "tone"), item("k1", "knowledge", "qa")],
}

let container: HTMLDivElement
let main: HTMLElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
    String(url).endsWith("/inbox-learning") ? { data: { channels: [channel] } } : { data: detail },
  ), { status: 200 })))
  main = document.createElement("main")
  container = document.createElement("div")
  main.appendChild(container)
  document.body.appendChild(main)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  main.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function render() {
  await act(async () => { root.render(createElement(TooltipProvider, null, createElement(AiTrainingScreen))) })
  for (let turn = 0; turn < 20 && !container.querySelector('[data-testid="learning-section-bar"]'); turn += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
  const bar = container.querySelector<HTMLElement>('[data-testid="learning-section-bar"]')
  expect(bar).not.toBeNull()
  return bar!
}

const tab = (bar: HTMLElement, label: string) =>
  [...bar.querySelectorAll("button")].find((b) => b.textContent?.startsWith(label))!

describe("«Обучение ИИ» section bar", () => {
  it("sticks flush with the top of <main>, opaque, as wide as the cards", async () => {
    const bar = await render()
    const classes = bar.className.split(/\s+/)
    // The offsets are <main>'s own padding (p-3 / sm:p-4 / lg:p-8).
    expect(readFileSync("src/app/(dashboard)/layout.tsx", "utf8")).toMatch(/<main className=\{`[^`]*overflow-y-auto[^`]* p-3 sm:p-4 lg:p-8 /)
    expect(classes).toEqual(expect.arrayContaining(["sticky", "-top-3", "sm:-top-4", "lg:-top-8", "bg-background", "z-20"]))
    expect(classes.filter((c) => /^bg-background\/|^backdrop-blur|^-?mx-|^px-/.test(c))).toEqual([])
  })

  it("«Hazırlıq» scrolls <main> back to the top, not the window", async () => {
    const bar = await render()
    const mainScroll = vi.fn()
    main.scrollTo = mainScroll as never
    const windowScroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {})
    await act(async () => { tab(bar, "Hazırlıq").click() })
    expect(mainScroll).toHaveBeenCalledWith({ top: 0, behavior: "smooth" })
    expect(windowScroll).not.toHaveBeenCalled()
  })

  it("«Xarakter» and «Biliklər» land their section just under the bar, however tall it is", async () => {
    const bar = await render()
    Object.defineProperty(bar, "offsetHeight", { configurable: true, value: 94 }) // two rows on a phone
    const scrolled: string[] = []
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) { scrolled.push(`${this.id} ${this.style.scrollMarginTop}`) }
    await act(async () => { tab(bar, "Xarakter").click() })
    await act(async () => { tab(bar, "Biliklər").click() })
    expect(scrolled).toEqual(["learning-character 110px", "learning-knowledge 110px"])
  })
})
