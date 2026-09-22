// @vitest-environment jsdom
/**
 * Owner, 2026-09-22: «почему другие разделы не активны? и еще призыв
 * посмотреть видео надо сделать — мне в голову не пришло, что там на видео
 * можно смотреть». A section the story has not reached must explain itself
 * when clicked, and the clip card must read as a video at a glance.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("@/components/logo", () => ({ Logo: () => null }))

import { DemoJourneySidebar } from "@/components/demo-center/journey/demo-journey-sidebar"
import { IntroClip } from "@/components/demo-center/journey/demo-journey-guide"
import { DEMO_JOURNEY_STRINGS as S } from "@/components/demo-center/journey/strings"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ""
})

function row(href: string) {
  return container.querySelector<HTMLButtonElement>(`[data-nav-href="${href}"]`)!
}

describe("demo sidebar", () => {
  const onNavigate = vi.fn()
  const onLocked = vi.fn()

  async function render() {
    onNavigate.mockReset()
    onLocked.mockReset()
    await act(async () => {
      root.render(createElement(DemoJourneySidebar, {
        visibleRoutes: ["/campaigns", "/inbox", "/deals"],
        reachableRoutes: ["/campaigns"],
        activeRoute: "/campaigns",
        onNavigate,
        onLocked,
      }))
    })
  }

  it("moves the view for a section the prospect has been to", async () => {
    await render()
    await act(async () => row("/campaigns").click())
    expect(onNavigate).toHaveBeenCalledWith("/campaigns")
    expect(onLocked).not.toHaveBeenCalled()
  })

  it("answers a click on a later section instead of ignoring it", async () => {
    await render()
    const deals = row("/deals")
    expect(deals.disabled, "a disabled row swallows the click and reads as broken").toBe(false)
    expect(deals.getAttribute("aria-disabled")).toBe("true")
    expect(deals.getAttribute("data-nav-locked")).toBe("true")
    expect(deals.querySelector("svg.lucide-lock")).not.toBeNull()
    await act(async () => deals.click())
    expect(onLocked).toHaveBeenCalledWith("deals")
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it("tells the prospect the guide will take them there", () => {
    expect(S.sectionLater("Sövdələşmələr")).toContain("«Sövdələşmələr»")
    expect(S.sectionLater("Sövdələşmələr")).toMatch(/sonra/)
  })
})

describe("the section's clip card", () => {
  it("says in words that there is a video to watch, and plays it on click", async () => {
    const onClipEvent = vi.fn()
    await act(async () => {
      root.render(createElement(IntroClip, {
        slug: "demo-leads",
        caption: "Lid necə yaranır",
        status: "available",
        token: "",
        variant: "open",
        onClipEvent,
      }))
    })
    const play = container.querySelector<HTMLButtonElement>('[data-testid="demo-intro-clip-play"]')
    expect(play, "the open demo has this clip, so the card must offer it").not.toBeNull()
    expect(play!.textContent).toContain(S.clipWatch)
    expect(container.textContent).toContain(S.clipTitle)
    expect(container.querySelector("video")).toBeNull()
    await act(async () => play!.click())
    expect(onClipEvent).toHaveBeenCalledWith("video.started")
    expect(container.querySelector("video")).not.toBeNull()
  })

  it("offers nothing to press when the clip is only planned", async () => {
    await act(async () => {
      root.render(createElement(IntroClip, { slug: "demo-leads", caption: "…", status: "planned", token: "", variant: "open" }))
    })
    expect(container.querySelector('[data-testid="demo-intro-clip-play"]')).toBeNull()
    expect(container.textContent).not.toContain(S.clipWatch)
  })
})
