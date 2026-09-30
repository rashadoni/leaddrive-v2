// @vitest-environment jsdom
/**
 * The guided demo's coach card can be put away (owner, 2026-09-22: it «does
 * not close» and covered the page on «Sizi gətirən kampaniya»). Putting it
 * away must never complete or skip the step: an action step still closes
 * only when the prospect does the real thing.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DemoCoachMark, clippedSideways } from "@/components/demo-center/journey/demo-coach-mark"

describe("demo coach card", () => {
  let container: HTMLDivElement
  let root: Root
  const handlers = { onNext: vi.fn(), onBack: vi.fn(), onSkip: vi.fn(), onClose: vi.fn(), onMissing: vi.fn() }

  beforeEach(() => {
    Object.values(handlers).forEach((handler) => handler.mockReset())
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
    const anchor = document.createElement("div")
    anchor.setAttribute("data-tour-id", "campaigns-list")
    const campaign = document.createElement("button")
    campaign.setAttribute("data-demo-target", "source-open-campaign")
    campaign.textContent = "Instagram: CRM tanıtımı"
    anchor.appendChild(campaign)
    document.body.appendChild(anchor)
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0) as unknown as number)
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id))
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    document.body.innerHTML = ""
    vi.unstubAllGlobals()
  })

  async function renderAction(extra: Record<string, unknown> = {}) {
    await act(async () => {
      root.render(createElement(DemoCoachMark, {
        stepKey: "source:source-open-campaign",
        anchor: "campaigns-list",
        placement: "top",
        title: "Sizi gətirən kampaniya",
        instruction: "Onu açın.",
        counter: "Addım 2 / 3",
        mode: "action",
        canBack: true,
        canSkip: false,
        ...handlers,
        ...extra,
      }))
    })
    // The anchor is located a tick after mount.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }

  /** jsdom lays nothing out, so the control's box and the viewport are told. */
  function layout(rect: { top: number; left: number; width: number; height: number }, view: { width: number; height: number }) {
    const target = document.querySelector<HTMLElement>('[data-demo-target="source-open-campaign"]')!
    const anchor = document.querySelector<HTMLElement>('[data-tour-id="campaigns-list"]')!
    const box = { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => rect }
    target.getBoundingClientRect = () => box as DOMRect
    anchor.getBoundingClientRect = () => box as DOMRect
    vi.stubGlobal("innerWidth", view.width)
    vi.stubGlobal("innerHeight", view.height)
  }

  function cardBox(): { top: number; height: number } {
    const card = document.querySelector<HTMLElement>('[data-testid="demo-coach-card"]')!
    return { top: Number.parseFloat(card.style.top), height: Number.parseFloat(String(card.style.maxHeight)) }
  }

  it("never lands on the control it points at — it takes the roomier side and shortens itself", async () => {
    // Owner's screens, 2026-09-23: the card sat exactly on the deal card the
    // step said to click, and on the quote row whose quantity it asks to change.
    layout({ top: 380, left: 40, width: 300, height: 120 }, { width: 390, height: 640 })
    await renderAction({ targetStepId: "source-open-campaign", targetLabel: "Kampaniyanı açın" })
    const card = cardBox()
    const ringBottom = 380 + 120
    const above = card.top + card.height <= 380
    const below = card.top >= ringBottom
    expect(above || below, `card at ${card.top}+${card.height} overlaps the control 380..${ringBottom}`).toBe(true)
  })

  it("has a close button that puts the card away without touching the step", async () => {
    await renderAction()
    const close = document.querySelector<HTMLButtonElement>('[data-testid="demo-coach-close"]')
    expect(close, "the card has no close button").not.toBeNull()
    await act(async () => close!.click())
    expect(handlers.onClose).toHaveBeenCalledTimes(1)
    expect(handlers.onNext).not.toHaveBeenCalled()
    expect(handlers.onSkip).not.toHaveBeenCalled()
  })

  it("closes on Escape the same way", async () => {
    await renderAction()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    })
    expect(handlers.onClose).toHaveBeenCalledTimes(1)
    expect(handlers.onNext).not.toHaveBeenCalled()
    expect(handlers.onSkip).not.toHaveBeenCalled()
  })

  it("still offers no «Next» on an action step", async () => {
    await renderAction()
    const card = document.querySelector('[data-testid="demo-coach-card"]')
    expect(card?.textContent).toContain("Hərəkət gözlənilir")
    expect(card?.textContent).not.toContain("İrəli")
  })

  it("points at the exact control and says what to do there", async () => {
    await renderAction({ targetStepId: "source-open-campaign", targetLabel: "Kampaniyanı açın" })
    expect(document.querySelector('[data-testid="demo-coach-ring"]')?.getAttribute("data-target")).toBe("control")
    expect(document.querySelector('[data-testid="demo-coach-card"]')?.textContent).toContain("Kampaniyanı açın")
  })

  it("keeps the ring and the arrow on the control when the card is put away", async () => {
    // Owner, 2026-09-22, with the card closed: «тут должно стрелками показывать, что надо сделать».
    await renderAction({ targetStepId: "source-open-campaign", targetLabel: "Kampaniyanı açın", collapsed: true })
    expect(document.querySelector('[data-testid="demo-coach-card"]')).toBeNull()
    const ring = document.querySelector<HTMLElement>('[data-testid="demo-coach-ring"]')
    expect(ring?.getAttribute("data-target")).toBe("control")
    // No dim: nothing covers the page once the card is away.
    expect(ring?.style.boxShadow).toBe("")
    expect(document.querySelector('[data-testid="demo-coach-arrow"]')?.textContent).toContain("Kampaniyanı açın")
  })

  it("lets Escape alone once the card is away", async () => {
    await renderAction({ targetStepId: "source-open-campaign", collapsed: true })
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    })
    expect(handlers.onClose).not.toHaveBeenCalled()
  })

  it("points at the region too, with the step's name, on a step that just shows something", async () => {
    // Owner, 2026-09-22: «везде нужны стрелки для понимания».
    await renderAction({ mode: "observe", collapsed: true })
    expect(document.querySelector('[data-testid="demo-coach-ring"]')?.getAttribute("data-target")).toBe("region")
    expect(document.querySelector('[data-testid="demo-coach-arrow"]')?.textContent).toContain("Sizi gətirən kampaniya")
  })

  it("puts an arrow on the ring even while the card is open", async () => {
    await renderAction({ targetStepId: "source-open-campaign", targetLabel: "Kampaniyanı açın" })
    expect(document.querySelector('[data-testid="demo-coach-card"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="demo-coach-ring-arrow"]')).not.toBeNull()
  })

  it("lets a control name itself for the arrow, when its job changes as the prospect goes on", async () => {
    document.querySelector('[data-demo-target="source-open-campaign"]')!.setAttribute("data-demo-label", "Kodu buraya yazın")
    await renderAction({ targetStepId: "source-open-campaign", targetLabel: "Kampaniyanı açın", collapsed: true })
    expect(document.querySelector('[data-testid="demo-coach-arrow"]')?.textContent).toContain("Kodu buraya yazın")
  })
})

describe("a target cut off sideways", () => {
  const box = (left: number, right: number) => ({ left, right, top: 100, bottom: 140, width: right - left, height: 40, x: left, y: 100, toJSON() {} }) as DOMRect
  const rail = () => {
    // A phone: 390px window, the stage rail scrolls sideways inside 80..374.
    vi.stubGlobal("innerWidth", 390)
    const scroller = document.createElement("div")
    scroller.style.overflowX = "auto"
    scroller.getBoundingClientRect = () => box(80, 374)
    const chevron = document.createElement("button")
    scroller.appendChild(chevron)
    document.body.appendChild(scroller)
    return chevron
  }

  it("counts a stage past the rail's edge as out of view, though the window still shows part of it", () => {
    expect(clippedSideways(rail(), box(350, 388))).toBe(true)
  })

  it("leaves a stage fully inside the rail alone", () => {
    expect(clippedSideways(rail(), box(200, 300))).toBe(false)
  })
})

describe("demo coach card height", () => {
  // The numbers measured on prod on 2026-09-30: the first step's card held
  // 211px of content and was capped at the 160px first guess, «İrəli» hidden.
  const CONTENT = 211

  let container: HTMLDivElement
  let root: Root
  const saved = {
    scroll: Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight"),
    client: Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight"),
    offset: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight"),
  }

  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0) as unknown as number)
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id))
    vi.stubGlobal("innerWidth", 1280)
    vi.stubGlobal("innerHeight", 900)
    const anchor = document.createElement("div")
    anchor.setAttribute("data-tour-id", "demo-sidebar")
    anchor.getBoundingClientRect = () => ({ top: 120, left: 20, width: 40, height: 300, right: 60, bottom: 420, x: 20, y: 120, toJSON: () => ({}) }) as DOMRect
    document.body.appendChild(anchor)
    // jsdom lays nothing out; the card's inner box reports what a browser would.
    const isCardInner = (element: Element) => element.parentElement?.getAttribute("data-testid") === "demo-coach-card"
    Object.defineProperty(Element.prototype, "scrollHeight", { configurable: true, get() { return isCardInner(this) ? CONTENT : 0 } })
    Object.defineProperty(Element.prototype, "clientHeight", { configurable: true, get() { return isCardInner(this) ? 158 : 0 } })
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return isCardInner(this) ? 160 : 0 } })
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    document.body.innerHTML = ""
    vi.unstubAllGlobals()
    if (saved.scroll) Object.defineProperty(Element.prototype, "scrollHeight", saved.scroll)
    if (saved.client) Object.defineProperty(Element.prototype, "clientHeight", saved.client)
    if (saved.offset) Object.defineProperty(HTMLElement.prototype, "offsetHeight", saved.offset)
  })

  it("grows to its content, so the step's own buttons are never scrolled out of sight", async () => {
    const onToggle = vi.fn()
    await act(async () => {
      root.render(createElement(DemoCoachMark, {
        stepKey: "orientation:orientation-sidebar",
        anchor: "demo-sidebar",
        placement: "right",
        title: "Bu demo üçün dörd bölmə",
        instruction: "Bu demo üçün sizə dörd bölmə açılıb: Əsas, Satış, Kommunikasiya və Marketinq. Qalan modullar bilərəkdən gizlədilib ki, hekayəni itirməyəsiniz.",
        counter: "Addım 1 / 3",
        mode: "observe",
        canBack: false,
        canSkip: false,
        onNext: vi.fn(), onBack: vi.fn(), onSkip: vi.fn(), onClose: vi.fn(), onMissing: vi.fn(),
        voice: { on: false, onToggle },
      }))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    const card = document.querySelector<HTMLElement>('[data-testid="demo-coach-card"]')!
    // Content plus the inner box's border: nothing left to scroll.
    expect(parseFloat(card.style.maxHeight)).toBeGreaterThanOrEqual(CONTENT)

    // And the voice switch on it works.
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="demo-coach-voice"]')!.click())
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
