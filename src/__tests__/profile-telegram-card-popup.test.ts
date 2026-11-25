// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"

vi.mock("next-intl", () => {
  const t = (key: string) => key
  return { useTranslations: () => t }
})

import { TooltipProvider } from "@/components/ui/tooltip"
import { ProfileTelegramCard } from "@/components/telegram-staff/profile-telegram-card"

const LINK = "https://t.me/Leaddrivetaskbot?start=one-time-token"
const view = { botConnected: true, botUsername: "Leaddrivetaskbot", linked: false, telegramUsername: null }

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

async function renderCard(postResponse: Promise<unknown>) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const payload = init?.method === "POST" ? await postResponse : { success: true, data: view }
    return { json: async () => payload } as Response
  }))
  const el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => {
    root!.render(React.createElement(TooltipProvider, null, React.createElement(ProfileTelegramCard)))
  })
  await act(async () => {})
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("link"))
  if (!button) throw new Error("link button not rendered")
  return button
}

describe("Profile → Telegram: the bot link opens on a phone", () => {
  it("opens the tab inside the tap, before the server answers, and then points it at the link", async () => {
    const tab = { opener: {} as unknown, location: { href: "" }, close: vi.fn() }
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window)
    let answer!: (v: unknown) => void
    const button = await renderCard(new Promise((r) => { answer = r }))

    act(() => button.click())
    // The server has not answered yet: a window opened only after the answer
    // has lost the tap, and the phone's browser blocks it (owner, 2026-10-25).
    expect(open).toHaveBeenCalledTimes(1)
    expect(tab.location.href).toBe("")

    await act(async () => answer({ success: true, data: { url: LINK } }))
    expect(tab.location.href).toBe(LINK)
    expect(tab.opener).toBeNull()
    expect(tab.close).not.toHaveBeenCalled()
    expect(document.querySelector(`a[href="${LINK}"]`)).not.toBeNull()
  })

  it("closes the empty tab when the link could not be made", async () => {
    const tab = { opener: {} as unknown, location: { href: "" }, close: vi.fn() }
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window)
    const button = await renderCard(Promise.resolve({ success: false }))

    await act(async () => button.click())
    expect(tab.close).toHaveBeenCalledTimes(1)
    expect(tab.location.href).toBe("")
  })

  it("still offers the link when the browser blocks the tab anyway", async () => {
    vi.spyOn(window, "open").mockReturnValue(null)
    const button = await renderCard(Promise.resolve({ success: true, data: { url: LINK } }))

    await act(async () => button.click())
    expect(document.querySelector(`a[href="${LINK}"]`)).not.toBeNull()
  })
})

// Owner 2026-11-25: on a Mac without the Telegram app, t.me's «START BOT» did nothing — «я не буду делать
// кустарно». On a computer the link is a QR code for the phone, and the card notices the «Start» by itself.
describe("Profile → Telegram: on a computer the link is a QR code for the phone", () => {
  it("opens no tab, draws the code for the link, and turns into «linked» once the phone pressed Start", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] })
    try {
      vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: fine)", media: query, addEventListener() {}, removeEventListener() {} }))
      const open = vi.spyOn(window, "open")
      let linked = false
      ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
      vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
        const payload = init?.method === "POST"
          ? { success: true, data: { url: LINK } }
          : { success: true, data: { ...view, linked, telegramUsername: linked ? "rashad" : null } }
        return { json: async () => payload } as Response
      }))
      const el = document.createElement("div")
      document.body.appendChild(el)
      root = createRoot(el)
      await act(async () => {
        root!.render(React.createElement(TooltipProvider, null, React.createElement(ProfileTelegramCard)))
      })
      const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("link"))!
      await act(async () => button.click())
      await act(async () => {})

      expect(open).not.toHaveBeenCalled()
      const img = document.querySelector("img[alt='qrAlt']") as HTMLImageElement | null
      expect(img?.src.startsWith("data:image/png")).toBe(true)
      expect(document.body.textContent).toContain("scanQr")
      expect(document.querySelector(`a[href="${LINK}"]`)?.textContent).toBe("openHere")

      linked = true
      await act(async () => { vi.advanceTimersByTime(3100) })
      await act(async () => {})
      expect(document.querySelector("img[alt='qrAlt']")).toBeNull()
      expect(document.body.textContent).toContain("linkedAs")
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
