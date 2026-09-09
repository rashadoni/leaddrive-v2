// @vitest-environment jsdom

/**
 * The orb asked for permission before the browser had a session.
 *
 * The owner reported the microphone missing in one CRM section and present in
 * others. It was never the section. `/api/v1/ai/voice/access` calls auth(); a
 * request that leaves before the session cookie is ready gets a truthful
 * {allowed:false}, nothing retries, and the orb stays hidden for the life of
 * that page — so a heavy page loses the race that a light one wins.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const auth = vi.hoisted(() => ({ status: "loading" as "loading" | "authenticated" | "unauthenticated" }))

vi.mock("next-auth/react", () => ({ useSession: () => ({ status: auth.status }) }))
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("next/dynamic", () => ({ default: () => () => null }))

/** One observer instance, driven by hand, so "scrolled away" is testable. */
const observers: Array<(visible: boolean) => void> = []
class FakeIntersectionObserver {
  constructor(private callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
    observers.push((visible) => this.callback([{ isIntersecting: visible }]))
  }
  observe() {}
  disconnect() {}
}

import { VoiceOrb } from "@/components/ai/voice-orb"

const fetchMock = vi.fn()
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  observers.length = 0
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver)
  auth.status = "loading"
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ allowed: true }) })
  vi.stubGlobal("fetch", fetchMock)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render() {
  await act(async () => {
    root.render(createElement(VoiceOrb))
  })
}

describe("voice orb", () => {
  it("does not ask before the session exists", async () => {
    await render()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.querySelector("button")).toBeNull()
  })

  it("asks once the session is ready, and shows the microphone", async () => {
    await render()
    auth.status = "authenticated"
    await render()

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/ai/voice/access", { credentials: "same-origin" })
    expect(container.querySelector("button")).not.toBeNull()
  })

  it("stays hidden when the gate says no", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ allowed: false }) })
    auth.status = "authenticated"
    await render()

    expect(fetchMock).toHaveBeenCalled()
    expect(container.querySelector("button")).toBeNull()
  })

  it("moves back to the corner once the in-flow launcher scrolls off screen", async () => {
    // MTM work surfaces host the microphone inside the AI bar at the top of the
    // content, to keep floating controls off their sticky actions. That bar
    // scrolls away, and with it the only way to start the assistant — which is
    // what the owner saw on a task list of 1531 rows and reported as "this
    // section has no microphone".
    const slot = document.createElement("div")
    slot.id = "dashboard-voice-assistant-slot"
    document.body.appendChild(slot)
    auth.status = "authenticated"

    await act(async () => {
      root.render(createElement(VoiceOrb, { showFloatingLauncher: false, inlineLauncherAvailable: true }))
    })
    await act(async () => { observers.forEach((fire) => fire(true)) })

    expect(slot.querySelector("[data-placement=\"inline\"]")).not.toBeNull()
    expect(container.querySelector("[data-placement=\"floating\"]")).toBeNull()

    await act(async () => { observers.forEach((fire) => fire(false)) })

    expect(slot.querySelector("button")).toBeNull()
    expect(container.querySelector("[data-placement=\"floating\"]")).not.toBeNull()

    slot.remove()
  })
})
