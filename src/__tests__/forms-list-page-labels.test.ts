// @vitest-environment jsdom
/**
 * /forms asks for useTranslations("formsListPage"), but the messages nested
 * every label one level deeper (formsListPage.formsListPage.*). Nothing was
 * found, so next-intl printed the keys themselves: the page was titled
 * «formsListPage.title» and its button read «formsListPage.actions.newForm» —
 * in all three languages. check-translations.js could not see it: en, ru and
 * az were nested the same way, so they agreed with each other.
 *
 * Renders the real page through the real NextIntlClientProvider and the real
 * message files, so a namespace that resolves to nothing fails here.
 */
import { act, createElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { readFileSync } from "fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl"
import { TooltipProvider } from "@/components/ui/tooltip"
import FormsListPage from "@/app/(dashboard)/forms/page"

vi.mock("@/components/help/help-drawer", () => ({ HelpDrawer: () => null }))

// createElement's types want the provider's required `children` inside the
// props object, and react/no-children-prop forbids that; the provider takes
// them as the third argument all the same.
const IntlProvider = NextIntlClientProvider as FunctionComponent<
  Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }
>

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface FormsListMessages {
  title: string
  actions: { newForm: string; edit: string }
  col: { name: string; status: string }
  status: { published: string }
}

const FORM = {
  id: "form-1",
  name: "Contact us",
  slug: "contact-us",
  description: null,
  status: "published",
  totalViews: 12,
  totalSubmissions: 3,
  publishedAt: "2026-09-01T09:00:00.000Z",
  createdAt: "2026-09-01T09:00:00.000Z",
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

describe("Forms page labels", () => {
  it.each(["en", "ru", "az"])("shows %s words, not message keys", async (locale) => {
    const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as AbstractIntlMessages
    const own = messages.formsListPage as unknown as FormsListMessages
    const missing: string[] = []
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: { forms: [FORM] } }))))

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        createElement(
          IntlProvider,
          { locale, messages, onError: (error) => { missing.push(error.message) } },
          createElement(TooltipProvider, null, createElement(FormsListPage)),
        ),
      )
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    const text = container.textContent ?? ""
    expect(text).not.toContain("formsListPage.")
    expect(missing).toEqual([])
    expect(container.querySelector("h1")?.textContent).toContain(own.title)
    expect(text).toContain(own.actions.newForm)
    expect(text).toContain(own.col.name)
    expect(text).toContain(own.status.published)
    expect(text).toContain(own.actions.edit)

    act(() => root.unmount())
  })
})
