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
import { DemoCoachMark } from "@/components/demo-center/journey/demo-coach-mark"

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

  it("marks only the region, with no arrow, on a step that just shows something", async () => {
    await renderAction({ mode: "observe", collapsed: true })
    expect(document.querySelector('[data-testid="demo-coach-ring"]')?.getAttribute("data-target")).toBe("region")
    expect(document.querySelector('[data-testid="demo-coach-arrow"]')).toBeNull()
  })
})
