import { readFileSync } from "node:fs"
import { createElement, type ComponentProps, type ReactElement, type ReactNode } from "react"
import { prerender } from "react-dom/static"
import { useFormatter, useMessages, useTranslations } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The interface catalog is no longer written into every page.
 *
 * Measured on production on 2026-10-26: the HTML of the home page was 1.8 MB
 * (az) and of `/demo` 2.5 MB (ru), of which 2.3 MB was `messages/<locale>.json`,
 * handed by the root layout to next-intl's server provider and serialized into
 * the RSC payload of every page. Now the layout hands a CRM page no messages,
 * and the browser loads the catalog of the page's language as a cached file of
 * its own (src/components/intl-catalog-provider.tsx).
 *
 * What can go wrong is that the words stop being words: a provider without a
 * catalog prints `common.save` where «Сохранить» stood. So the provider is
 * rendered here the way the server renders it — through Next's own app-router
 * `next/dynamic`, waiting for the import like the server does — and asked
 * what the screen says, in each language.
 */

const request = vi.hoisted(() => ({ pathname: null as string | null, locale: "ru" }))

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: (name: string) => (name === "x-request-pathname" ? request.pathname : null) })),
}))
vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => request.locale),
  getMessages: vi.fn(async () => JSON.parse(readFileSync(`messages/${request.locale}.json`, "utf8"))),
  getTimeZone: vi.fn(async () => "Asia/Baku"),
}))
// vitest resolves `next/dynamic` to the pages-router version; a build of the
// app directory uses this one, and so does the test.
vi.mock("next/dynamic", async () => ({
  default: (await vi.importActual<{ default: unknown }>("next/dist/shared/lib/app-dynamic")).default,
}))
vi.mock("@/components/providers", () => ({ Providers: ({ children }: { children: ReactNode }) => children }))
vi.mock("sonner", () => ({ Toaster: () => null }))

import RootLayout from "@/app/layout"
import { IntlCatalogProvider } from "@/components/intl-catalog-provider"

const LOCALES = ["ru", "az", "en"] as const
type Locale = typeof LOCALES[number]
const catalog = (locale: Locale) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Record<string, Record<string, string>>

// 2026-10-27 00:30 UTC is 04:30 in Baku and 17:30 the day before in Los Angeles
// — neither of them the zone of a machine this runs on, so a provider that
// dropped the zone it is given would print a third time.
const MOMENT = new Date(Date.UTC(2026, 9, 27, 0, 30))

/** What a client component of the CRM reads from the provider. */
function Screen() {
  const common = useTranslations("common")
  const auth = useTranslations("auth")
  const format = useFormatter()
  const namespaces = Object.keys(useMessages()).length
  return createElement(
    "p",
    null,
    `${common("save")}|${common("cancel")}|${auth("signIn")}|${format.dateTime(MOMENT, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}|${namespaces}`,
  )
}

/** The HTML the server renders, once everything it waits for has arrived. */
async function rendered(element: ReactElement): Promise<string> {
  const { prelude } = await prerender(element)
  return new Response(prelude).text()
}

beforeEach(() => {
  request.pathname = null
  request.locale = "ru"
})

describe("the catalog a CRM page loads as its own file", () => {
  it("puts every language's own words on the screen, from the whole catalog, in the server's time zone", async () => {
    for (const locale of LOCALES) {
      const html = await rendered(
        createElement(IntlCatalogProvider, { locale, timeZone: "Asia/Baku", messages: null }, createElement(Screen)),
      )
      const words = catalog(locale)
      expect(html, locale).toBe(
        `<p>${words.common.save}|${words.common.cancel}|${words.auth.signIn}|04:30|${Object.keys(words).length}</p>`,
      )
      expect(html, locale).not.toMatch(/common\.|auth\./)
    }
    expect(Object.keys(catalog("ru")).length).toBeGreaterThan(100)
  })

  it("reads the time zone it is given, not one of its own", async () => {
    const html = await rendered(
      createElement(IntlCatalogProvider, { locale: "ru", timeZone: "America/Los_Angeles", messages: null }, createElement(Screen)),
    )
    expect(html).toContain("|17:30|")
  })

  it("speaks only the few sentences a public page is handed, when it is handed them", async () => {
    const auth = catalog("az").auth
    function SignIn() {
      return createElement("p", null, useTranslations("auth")("signIn"))
    }
    const html = await rendered(
      createElement(IntlCatalogProvider, { locale: "az", timeZone: "Asia/Baku", messages: { auth } }, createElement(SignIn)),
    )
    expect(html).toBe(`<p>${auth.signIn}</p>`)
  })
})

describe("what the root layout writes into a CRM page", () => {
  /** The provider the layout renders, with the props that cross into the browser. */
  async function providerOf(pathname: string | null, locale: Locale) {
    request.pathname = pathname
    request.locale = locale
    const found: ReactElement<ComponentProps<typeof IntlCatalogProvider>>[] = []
    const look = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(look)
      if (!node || typeof node !== "object") return
      const element = node as ReactElement<{ children?: unknown }>
      if (!element.props) return
      if (element.type === IntlCatalogProvider) found.push(element as never)
      look(element.props.children)
    }
    look(await RootLayout({ children: null }))
    expect(found).toHaveLength(1)
    return found[0]
  }

  it("writes no sentences into the page: the language and the time zone, a few bytes instead of the catalog", async () => {
    for (const locale of LOCALES) {
      for (const pathname of ["/", "/demo", "/deals", "/mtm/map", null]) {
        const provider = await providerOf(pathname, locale)
        expect(provider.props.messages, `${locale} ${pathname}`).toBeNull()
        expect(provider.props.locale).toBe(locale)
        expect(provider.props.timeZone).toBe("Asia/Baku")
      }
      expect(readFileSync(`messages/${locale}.json`, "utf8").length).toBeGreaterThan(1_000_000)
    }
  })

  it("and the page drawn from it still shows the words of its language", async () => {
    for (const locale of LOCALES) {
      const provider = await providerOf("/deals", locale)
      const html = await rendered(
        createElement(IntlCatalogProvider, { ...provider.props, messages: null }, createElement(Screen)),
      )
      expect(html, locale).toContain(`<p>${catalog(locale).common.save}|`)
    }
  })
})
