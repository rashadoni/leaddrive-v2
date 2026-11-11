// @vitest-environment jsdom
/**
 * First visit to a section with a video → one «watch the video?» window
 * (owner, 2026-11-09). Rendered with the real tour and preferences providers:
 * only the network, the session and the address are stand-ins.
 */
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const az = JSON.parse(readFileSync("messages/az.json", "utf8")) as Messages
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  return {
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: "az", messages: az as never, namespace: namespace as never }),
    useLocale: () => "az",
  }
})
let pathname = "/boards"
vi.mock("next/navigation", () => ({ usePathname: () => pathname }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u-1" } }, status: "authenticated" }) }))
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => createElement("img", { src: props.src as string, alt: "" }) }))

import { TourProvider, useAutoTour, useTour } from "@/components/tour/tour-provider"
import { LauncherPrefsProvider } from "@/contexts/launcher-prefs-context"
import { HelpVideoFirstVisitPrompt, firstVisitPromptState } from "@/components/help/help-video-first-visit"
import { stubFlight } from "./helpers/help-video-flight"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root | undefined
let puts: unknown[]
let activeTour: string | null

function TourProbe() {
  useAutoTour("boardsTour")
  activeTour = useTour().activeTour
  return null
}

function mount(seen: string[] | "fail") {
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "PUT") {
      puts.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ success: true, data: {} }))
    }
    if (seen === "fail") return new Response("{}", { status: 500 })
    return new Response(JSON.stringify({ success: true, data: { favorites: [], recents: [], helpVideoSeen: seen } }))
  }) as typeof fetch
  const tree = (children: ReactNode) => createElement(TourProvider, null, createElement(LauncherPrefsProvider, null, children))
  const r = createRoot(container)
  root = r
  act(() => {
    r.render(tree([createElement(HelpVideoFirstVisitPrompt, { key: "p" }), createElement(TourProbe, { key: "t" })]))
  })
}

const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
const prompt = () => container.querySelector('[data-testid="help-video-first-visit"]')

beforeEach(() => {
  localStorage.clear()
  pathname = "/boards"
  puts = []
  activeTour = null
  container = document.createElement("div")
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  container.remove()
})

describe("firstVisitPromptState", () => {
  it("waits for the server, then shows once, never for an offered or videoless section", () => {
    expect(firstVisitPromptState("boards", null, null, false)).toBe("wait")
    expect(firstVisitPromptState("boards", new Set(), null, false)).toBe("show")
    expect(firstVisitPromptState("boards", new Set(["boards"]), null, false)).toBe("none")
    expect(firstVisitPromptState("boards", new Set(), "boards", false)).toBe("none")
    expect(firstVisitPromptState(null, new Set(), null, false)).toBe("none")
    expect(firstVisitPromptState("boards", null, null, true)).toBe("none")
  })
})

describe("the first-visit prompt", () => {
  it("offers the section's video once, holds the page tour until «Sonra», then lets the tour run", async () => {
    mount([])
    await wait(50)
    expect(prompt()).not.toBeNull()
    expect(container.textContent).toContain("ilk dəfəsiniz")
    await wait(900)
    expect(activeTour).toBeNull()

    act(() => (container.querySelector('[data-testid="help-video-first-visit-later"]') as HTMLButtonElement).click())
    expect(prompt()).toBeNull()
    expect(puts).toContainEqual({ helpVideoSeen: ["boards"] })
    expect(activeTour).toBe("boardsTour")
  })

  it("«Sonra» flies the window up into the section's card, holding the tour until it lands", async () => {
    const card = document.createElement("div")
    card.setAttribute("data-help-video-widget", "")
    document.body.appendChild(card)
    const flight = stubFlight()
    try {
      mount([])
      await wait(900)
      act(() => (container.querySelector('[data-testid="help-video-first-visit-later"]') as HTMLButtonElement).click())

      // In the air: still on screen, not clickable, aimed at the card, tour held.
      expect(prompt()?.getAttribute("data-flying")).toBe("true")
      expect(prompt()?.className).toContain("pointer-events-none")
      expect(flight.lastTransform()).toBe("translate(-90px, -180px) scale(0.75, 0.2)")
      expect(puts).toContainEqual({ helpVideoSeen: ["boards"] })
      expect(activeTour).toBeNull()

      await act(async () => flight.land())
      expect(prompt()).toBeNull()
      expect(activeTour).toBe("boardsTour")
    } finally {
      flight.restore()
      card.remove()
    }
  })

  it("«Videoya bax» opens this section's player and marks it offered", async () => {
    const opened: unknown[] = []
    const listener = (event: Event) => opened.push((event as CustomEvent).detail)
    window.addEventListener("leaddrive:open-help-video", listener)
    mount([])
    await wait(50)
    act(() => (container.querySelector('[data-testid="help-video-first-visit-watch"]') as HTMLButtonElement).click())
    window.removeEventListener("leaddrive:open-help-video", listener)
    expect(opened).toEqual([{ slug: "boards" }])
    expect(puts).toContainEqual({ helpVideoSeen: ["boards"] })
    expect(prompt()).toBeNull()
  })

  it("stays away from a section already offered — and the tour starts as before", async () => {
    mount(["boards"])
    await wait(900)
    expect(prompt()).toBeNull()
    expect(activeTour).toBe("boardsTour")
    expect(puts).toEqual([])
  })

  it("shows nothing when the server cannot say what was offered, and does not hold the tour", async () => {
    mount("fail")
    await wait(50)
    expect(prompt()).toBeNull()
    await wait(6100)
    expect(prompt()).toBeNull()
    expect(activeTour).toBe("boardsTour")
  }, 10000)
})
