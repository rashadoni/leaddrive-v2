// @vitest-environment jsdom
/**
 * Closing the help-video player goes back to the section's «Video dərslik»
 * card; only the card's own X hides the card (2026-11-09: the player's X hid
 * the card for good, while the first-visit prompt promises the card stays).
 * On the way it flies up into that card (owner, 2026-11-11).
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({ useLocale: () => "az", useTranslations: () => (key: string) => key }))
vi.mock("next/navigation", () => ({ usePathname: () => "/boards" }))
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => createElement("img", { src: props.src as string, alt: "" }) }))
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
  TooltipTrigger: ({ children }: { children: unknown }) => children,
  TooltipContent: () => null,
}))

import { HelpVideoLauncher } from "@/components/help/help-video-launcher"
import { stubFlight } from "./helpers/help-video-flight"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  localStorage.clear()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(createElement(HelpVideoLauncher)))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const card = () => container.querySelector("[data-help-video-widget]")
const player = () => container.querySelector('[role="dialog"]')

describe("the help-video player", () => {
  it("closes back to the card, which stays — after a reload too", () => {
    expect(card()).not.toBeNull()
    act(() => { window.dispatchEvent(new CustomEvent("leaddrive:open-help-video", { detail: { slug: "boards" } })) })
    expect(player()).not.toBeNull()
    act(() => (container.querySelector('[data-testid="help-video-player-close"]') as HTMLButtonElement).click())
    expect(player()).toBeNull()
    expect(card()).not.toBeNull()

    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(createElement(HelpVideoLauncher)))
    expect(card()).not.toBeNull()
  })
  it("flies up into the card it came from — the card stays under the open player", async () => {
    const flight = stubFlight()
    try {
      act(() => { window.dispatchEvent(new CustomEvent("leaddrive:open-help-video", { detail: { slug: "boards" } })) })
      expect(card()).not.toBeNull()
      act(() => (container.querySelector('[data-testid="help-video-player-close"]') as HTMLButtonElement).click())

      expect(player()?.getAttribute("data-flying")).toBe("true")
      expect(flight.lastTransform()).toBe("translate(-90px, -180px) scale(0.75, 0.2)")
      // A second click mid-air starts nothing new.
      act(() => (container.querySelector('[data-testid="help-video-player-close"]') as HTMLButtonElement).click())
      expect(flight.flights()).toBe(1)

      await act(async () => flight.land())
      expect(player()).toBeNull()
      expect(card()).not.toBeNull()
    } finally {
      flight.restore()
    }
  })
})
