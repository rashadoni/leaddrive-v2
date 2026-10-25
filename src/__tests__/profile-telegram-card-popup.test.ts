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
