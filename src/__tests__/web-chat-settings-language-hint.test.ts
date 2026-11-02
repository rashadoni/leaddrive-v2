// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl"

/**
 * The web-chat settings say which language the chat speaks to visitors (the
 * organization's). Since 2026-10-17 that language is «Язык общения с
 * клиентами» in Settings → Organization, so the hint links there — in the
 * words the navigation and the card itself use, or an admin following it
 * looks for a name that is not on the screen.
 */

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { organizationId: "org-1" } } }) }))
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string; [key: string]: unknown }) => createElement("a", { href, ...props }, children),
}))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
vi.mock("@/components/tour/tour-replay-button", () => ({ TourReplayButton: () => null }))
vi.mock("@/components/tour/tour-provider", () => ({ useAutoTour: () => undefined }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const Intl = NextIntlClientProvider as FunctionComponent<Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }>
type Messages = { nav: { groups: { Settings: string }; organizationSettings: string }; settings: { orgCustomerLanguage: string } }

const widget = {
  id: "w1", enabled: true, publicKey: "pk_test", title: "", greeting: "", primaryColor: "#f97316", position: "bottom-right",
  showLauncher: true, aiEnabled: true, aiDraftMode: false, aiThreshold: null, aiRolloutPercent: null, escalateToTicket: true,
  allowedOrigins: [], offlineMessage: null, workingHours: null, preChatForm: null, uiOptions: null,
}

afterEach(() => {
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

async function renderHint(locale: "ru" | "en" | "az") {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: widget, language: "az" }), { status: 200 })))
  const { default: Page } = await import("@/app/(dashboard)/settings/web-chat/page")
  const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as AbstractIntlMessages & Messages
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(createElement(Intl, { locale, messages, onError: () => undefined }, createElement(Page))) })
  for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  const link = container.querySelector<HTMLAnchorElement>('a[href="/settings/organization"]')
  const out = { link, hint: link?.closest("p")?.textContent ?? "", page: container.textContent ?? "", messages }
  await act(async () => { root.unmount() })
  return out
}

describe("web-chat settings: where the chat's language is changed", () => {
  it.each(["ru", "en", "az"] as const)("links to the Organization page by the names on screen (%s)", async (locale) => {
    const { link, hint, messages } = await renderHint(locale)
    expect(link).not.toBeNull()
    expect(link!.textContent).toBe(
      [messages.nav.groups.Settings, messages.nav.organizationSettings, messages.settings.orgCustomerLanguage].join(" → "),
    )
    // The same line still says which language the chat speaks now.
    expect(hint).not.toContain("{lang}")
  })

  it("says the current language in words", async () => {
    const { page } = await renderHint("ru")
    expect(page).toContain("сейчас азербайджанский")
  })
})
