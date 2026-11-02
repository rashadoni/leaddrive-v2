/**
 * «Ссылка на местоположение» — what the page behind /share/location/<token>
 * is handed by the application around it, and what it is not.
 *
 * Whoever opens such a link has no account. Left alone, the root layout
 * would send his browser the whole interface catalog — every module's
 * labels, a megabyte and a half — because the page is on neither of the two
 * short lists of public pages. No test failed on that for a new path, which
 * is how it would have shipped.
 *
 * So the real layout is run here and asked what it hands to the page, the
 * link the managers' route really builds is what it is asked about, and the
 * sentences the page will show are read as sentences — the Russian plurals
 * through the formatter, not as ICU source.
 *
 * The page, its two components and the page it falls back to when it cannot
 * be drawn are read here as well (model: demo-center-boundary.test.ts): what
 * they may import, the one route they may ask, what the page says of itself
 * to a messenger's link preview, and that every sentence they ask for is in
 * the few they are handed.
 */
import { readFileSync } from "node:fs"
import type { ReactElement } from "react"
import { createTranslator } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"

const request = vi.hoisted(() => ({ pathname: null as string | null, locale: "ru" }))

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: (name: string) => (name === "x-request-pathname" ? request.pathname : null) })),
}))
vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => request.locale),
  getMessages: vi.fn(async () => JSON.parse(readFileSync(`messages/${request.locale}.json`, "utf8"))),
  getTimeZone: vi.fn(async () => "Asia/Baku"),
  // On the server a page reads the whole catalog of the request's language.
  getTranslations: vi.fn(async (namespace: string) => {
    const { createTranslator: create } = await vi.importActual<typeof import("next-intl")>("next-intl")
    return create({
      locale: request.locale,
      messages: JSON.parse(readFileSync(`messages/${request.locale}.json`, "utf8")),
      namespace: namespace as never,
    })
  }),
}))
// The session provider and the toaster are not what is asked about.
vi.mock("@/components/providers", () => ({ Providers: () => null }))
vi.mock("sonner", () => ({ Toaster: () => null }))

import RootLayout from "@/app/layout"
import { IntlCatalogProvider } from "@/components/intl-catalog-provider"
import LocationShareLinkPage, * as pageModule from "@/app/share/location/[token]/page"
import { LocationShareLinkView } from "@/components/mtm/location-share-link-view"
import { LOCATION_SHARE_LINK_PAGE_PATH, buildLocationShareLinkUrl } from "@/lib/mtm/location-share-link"

const NAMESPACE = "mtmLocationShareLink"
const LOCALES = ["ru", "en", "az"] as const
type Locale = typeof LOCALES[number]
const TOKEN = "a".repeat(64)

const catalog = (locale: Locale) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Record<string, unknown>
const translator = (locale: Locale) => createTranslator({ locale, messages: catalog(locale) as never, namespace: NAMESPACE as never }) as unknown as
  (key: string, values?: Record<string, string | number>) => string

/**
 * The messages the root layout writes into the page at `pathname` — `null`
 * when it writes none and the browser loads the whole catalog as its own file.
 */
async function handedTo(pathname: string | null, locale: Locale = "ru"): Promise<Record<string, unknown> | null> {
  request.pathname = pathname
  request.locale = locale
  const found: Array<Record<string, unknown> | null> = []
  const look = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(look)
    if (!node || typeof node !== "object") return
    const element = node as ReactElement<{ messages?: Record<string, unknown> | null; locale?: string; children?: unknown }>
    if (!element.props) return
    if (element.type === IntlCatalogProvider) {
      expect(element.props.locale, "the provider speaks the request's language").toBe(locale)
      found.push(element.props.messages ?? null)
    }
    look(element.props.children)
  }
  look(await RootLayout({ children: null }))
  expect(found, "one provider carries the messages").toHaveLength(1)
  return found[0]
}

/** Every sentence of an object, with the path that leads to it. */
function sentences(node: unknown, path = ""): Array<[string, string]> {
  if (typeof node === "string") return [[path, node]]
  return Object.entries((node ?? {}) as Record<string, unknown>).flatMap(([key, value]) => sentences(value, path ? `${path}.${key}` : key))
}

beforeEach(() => {
  request.pathname = null
  request.locale = "ru"
})

describe("what the root layout hands the public page of a location link", () => {
  it("hands it its own few sentences and nothing else of the catalog — in each language", async () => {
    for (const locale of LOCALES) {
      const handed = await handedTo(`${LOCATION_SHARE_LINK_PAGE_PATH}${TOKEN}`, locale)
      if (!handed) throw new Error(`${locale}: the page was handed the whole catalog`)
      expect(Object.keys(handed), locale).toEqual([NAMESPACE])
      expect(handed[NAMESPACE], locale).toEqual(catalog(locale)[NAMESPACE])
      // A few sentences, not a megabyte: the whole of what a stranger's browser is sent.
      expect(JSON.stringify(handed).length, locale).toBeLessThan(4_000)
      expect(JSON.stringify(catalog(locale)).length, locale).toBeGreaterThan(1_000_000)
    }
  })

  it("does so for the very link the managers' route builds, and for the same address written with a slash at the end", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test")
    try {
      const pathname = new URL(buildLocationShareLinkUrl(TOKEN, "az")).pathname
      expect(Object.keys(await handedTo(pathname) ?? {})).toEqual([NAMESPACE])
      expect(Object.keys(await handedTo(`${pathname}/`) ?? {})).toEqual([NAMESPACE])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("hands a page that merely sounds alike what every CRM page gets: no sentences in the page, the whole catalog as its own file", async () => {
    for (const pathname of ["/share/locations", `/share/locations/${TOKEN}`, `/shared/location/${TOKEN}`, `/mtm/share/location/${TOKEN}`, "/mtm/map", null]) {
      expect(await handedTo(pathname), String(pathname)).toBeNull()
    }
  })

  it("leaves its neighbours as they were: a sign-in page still gets the sign-in sentences alone", async () => {
    expect(Object.keys(await handedTo("/login") ?? {})).toEqual(["auth"])
    expect(Object.keys(await handedTo("/portal/login") ?? {})).toEqual(["portal"])
  })

  it("holds nothing in those sentences that belongs behind a login", () => {
    for (const locale of LOCALES) {
      const text = JSON.stringify(catalog(locale)[NAMESPACE])
      expect(text, locale).not.toMatch(/superadmin|role_|password|token/i)
    }
  })
})

describe("the sentences the page shows", () => {
  it("are the same set in all three languages", () => {
    const paths = (locale: Locale) => sentences(catalog(locale)[NAMESPACE]).map(([path]) => path).sort()
    expect(paths("ru").length).toBeGreaterThan(15)
    expect(paths("en")).toEqual(paths("ru"))
    expect(paths("az")).toEqual(paths("ru"))
  })

  it("say when the coordinate was recorded and until when the link works, as decided", () => {
    const t = translator("ru")
    expect(t("recordedAt", { time: "14:05", ago: t("ago.minutes", { count: 3 }) })).toBe("Обновлено в 14:05 · 3 минуты назад")
    expect(t("expiresAt", { time: "18:00" })).toBe("Ссылка действует до 18:00")
    expect(t("expiresAtEndOfDay")).toBe("Ссылка действует до конца дня")
    // The zone as a person says it, in brackets after the sentence it explains.
    expect(t("timezoneNote", { timezone: "GMT+4" })).toBe("Время указано по времени организации (GMT+4)")
    expect(t("unavailable.title")).toBe("Сейчас местоположение недоступно")
    expect(t("gone.title")).toBe("Ссылка больше не работает")
    expect(t("pageTitle")).toBe("Местоположение сотрудника")
    expect(t("refresh")).toBe("Обновить")
  })

  it("decline «N минут назад» in Russian by the number", () => {
    const t = translator("ru")
    expect([1, 2, 4, 5, 11, 14, 15, 21, 22, 25].map((count) => t("ago.minutes", { count }))).toEqual([
      "1 минуту назад", "2 минуты назад", "4 минуты назад", "5 минут назад", "11 минут назад",
      "14 минут назад", "15 минут назад", "21 минуту назад", "22 минуты назад", "25 минут назад",
    ])
    expect([1, 3, 5, 21].map((count) => t("ago.hours", { count }))).toEqual(["1 час назад", "3 часа назад", "5 часов назад", "21 час назад"])
    expect(t("ago.justNow")).toBe("только что")
  })

  it("count the same in English and in Azerbaijani", () => {
    const en = translator("en")
    expect([1, 2, 15].map((count) => en("ago.minutes", { count }))).toEqual(["1 minute ago", "2 minutes ago", "15 minutes ago"])
    expect(en("recordedAt", { time: "14:05", ago: en("ago.minutes", { count: 3 }) })).toBe("Updated at 14:05 · 3 minutes ago")
    const az = translator("az")
    expect([1, 2, 15].map((count) => az("ago.minutes", { count }))).toEqual(["1 dəqiqə əvvəl", "2 dəqiqə əvvəl", "15 dəqiqə əvvəl"])
    expect(az("expiresAt", { time: "18:00" })).toBe("Link bu vaxta qədər işləyir: 18:00")
  })

  it("leave no placeholder unfilled when given what the answer holds", () => {
    const values = { time: "14:05", ago: "…", organization: "Example LLC", timezone: "Asia/Baku", count: 3 }
    for (const locale of LOCALES) {
      const t = translator(locale)
      for (const [path] of sentences(catalog(locale)[NAMESPACE])) {
        expect(t(path, values), `${locale} ${path}`).not.toMatch(/[{}]/)
      }
    }
  })

  it("glue no ending onto a name or a time in Azerbaijani, where the ending would have to change with the word", () => {
    for (const [path, sentence] of sentences(catalog("az")[NAMESPACE])) {
      expect(sentence, path).not.toMatch(/\{[a-zA-Z]+\}[-'’\p{L}]/u)
    }
  })

  it("name nobody in the page's title: a messenger shows the title of a pasted link to everybody in the chat", () => {
    for (const locale of LOCALES) {
      const title = (catalog(locale)[NAMESPACE] as { pageTitle: string }).pageTitle
      expect(title, locale).not.toMatch(/[{}]/)
    }
  })

  it("give no reason why a position is not shown: a break or a closed day is the employee's business", () => {
    const about = /перерыв|смен|рабоч|выходн|break|shift|workday|day off|fasilə|növbə|iş günü|istirahət/i
    for (const locale of LOCALES) {
      const namespace = catalog(locale)[NAMESPACE] as { unavailable: Record<string, string>; gone: Record<string, string> }
      for (const [path, sentence] of [...sentences(namespace.unavailable, "unavailable"), ...sentences(namespace.gone, "gone")]) {
        expect(sentence, `${locale} ${path}`).not.toMatch(about)
      }
    }
  })
})

describe("one address, written in three places", () => {
  it("is the same in the link builder, in the layout and in the proxy", () => {
    expect(LOCATION_SHARE_LINK_PAGE_PATH).toBe("/share/location/")
    // The layout and the proxy cannot import the library (the proxy is the
    // edge bundle), so each carries the path as a literal.
    const layout = readFileSync("src/app/layout.tsx", "utf8")
    expect(layout).toContain(`const PUBLIC_LOCATION_SHARE_LINK_PATH = "${LOCATION_SHARE_LINK_PAGE_PATH.replace(/\/$/, "")}"`)
    const proxy = readFileSync("src/proxy.ts", "utf8")
    const publicLine = proxy.split("\n").find((line) => line.startsWith("const publicPaths"))
    expect(publicLine).toContain(`"${LOCATION_SHARE_LINK_PAGE_PATH}"`)
    expect(proxy).toContain(`matchesPublicPath(pathname, "${LOCATION_SHARE_LINK_PAGE_PATH}")`)
    expect(proxy).toContain(`pathname.startsWith("${LOCATION_SHARE_LINK_PAGE_PATH}")`)
  })
})

describe("the page behind the link, its two components and the page shown when it cannot be drawn", () => {
  const PAGE = "src/app/share/location/[token]/page.tsx"
  const VIEW = "src/components/mtm/location-share-link-view.tsx"
  const MAP = "src/components/mtm/location-share-link-map.tsx"
  // Next draws this one in the page's place when the page throws — a map chunk that did not arrive, most often.
  const ERROR = "src/app/share/location/[token]/error.tsx"
  const FILES = [PAGE, VIEW, MAP, ERROR]
  const source = (file: string) => readFileSync(file, "utf8")

  function importSpecifiers(text: string): string[] {
    const specifiers: string[] = []
    const pattern = /(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text))) specifiers.push(match[1] ?? match[2] ?? match[3])
    return specifiers
  }

  it("import nothing that reads the database, a session or a tenant", () => {
    const forbidden = ["@/lib/prisma", "@/lib/api-auth", "@/lib/rls-context", "@/lib/auth", "next-auth", "@/lib/session", "@/lib/mtm-settings", "@/lib/mtm/location-share-access"]
    for (const file of FILES) {
      const specifiers = importSpecifiers(source(file))
      // The fallback page imports its sentences and nothing else.
      expect(specifiers.length, file).toBeGreaterThan(file === ERROR ? 0 : 2)
      for (const specifier of specifiers) {
        for (const refused of forbidden) {
          expect(specifier === refused || specifier.startsWith(`${refused}/`), `${file} imports ${specifier}`).toBe(false)
        }
      }
    }
  })

  it("ask one route only — the public answer of the link — and nothing of the managers' side", () => {
    const paths = FILES.flatMap((file) => Array.from(source(file).matchAll(/\/api\/[A-Za-z0-9/_\-$\[\]{}.]*/g), (match) => `${file}: ${match[0]}`))
    // The view asks it; the page only names it in a comment.
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) expect(path).toMatch(/: \/api\/v1\/public\/location-share\//)
    expect(source(VIEW)).toContain("fetch(`/api/v1/public/location-share/${encodeURIComponent(token)}`")
    // One question, in one place: neither the page, nor the map, nor the fallback asks anything.
    expect(source(PAGE)).not.toMatch(/\bfetch\(/)
    expect(source(MAP)).not.toMatch(/\bfetch\(/)
    expect(source(ERROR)).not.toMatch(/\bfetch\(/)
  })

  it("the page is never a stored copy, and hands the view the link and nothing else", async () => {
    expect(pageModule.dynamic).toBe("force-dynamic")
    expect(pageModule.revalidate).toBe(0)
    const element = await LocationShareLinkPage({ params: Promise.resolve({ token: TOKEN }) }) as ReactElement<Record<string, unknown>>
    expect(element.type).toBe(LocationShareLinkView)
    expect(element.props).toEqual({ token: TOKEN })
    // Keyed by the link, so that nothing one link showed is carried over to another.
    expect(element.key).toBe(TOKEN)
  })

  it("the page says the same of every link to a messenger's preview — nobody is named — and asks not to be indexed", async () => {
    const titles: string[] = []
    for (const locale of LOCALES) {
      request.locale = locale
      const metadata = await pageModule.generateMetadata()
      const namespace = catalog(locale)[NAMESPACE] as { pageTitle: string; scopeNote: string }
      expect(metadata.title, locale).toBe(namespace.pageTitle)
      expect(metadata.description, locale).toBe(namespace.scopeNote)
      expect(metadata.robots, locale).toEqual({ index: false, follow: false, nocache: true })
      // The map's background is admitted by the address of the page that asks for it: no «no-referrer» here.
      expect(metadata, locale).not.toHaveProperty("referrer")
      // Nothing of a preview is taken from the link, the employee or the organization.
      expect(Object.keys(metadata).sort(), locale).toEqual(["description", "robots", "title"])
      titles.push(String(metadata.title))
    }
    expect(titles).toEqual(["Местоположение сотрудника", "Employee location", "Əməkdaşın olduğu yer"])
    expect(pageModule.generateMetadata.length).toBe(0)
  })

  it("a link that does not work is said on the page itself, never handed to the application's own 404", () => {
    for (const file of FILES) {
      expect(source(file), file).not.toMatch(/notFound\s*\(|redirect\s*\(|from\s*["']next\/navigation["']/)
    }
  })

  it("read no namespace but their own: the layout hands this page nothing else, and a second one would print its key on screen", () => {
    const namespaces = FILES.flatMap((file) => Array.from(source(file).matchAll(/(?:useTranslations|getTranslations)\(\s*["']([^"']+)["']\s*\)/g), (match) => match[1]))
    // The page's metadata; the view and its «загружаем» in the map's place; the fallback page.
    expect(namespaces).toEqual([NAMESPACE, NAMESPACE, NAMESPACE, NAMESPACE])
    // Every translator in those files names its namespace as a literal — none slips past the line above.
    expect(FILES.flatMap((file) => source(file).match(/(?:useTranslations|getTranslations)\(/g) ?? [])).toHaveLength(4)
    // The map draws no words at all.
    expect(source(MAP)).not.toMatch(/useTranslations|next-intl/)
  })

  it("ask for sentences that are all there, in each language — and leave none of the page's sentences unused", () => {
    const view = source(VIEW)
    const literal = [PAGE, VIEW, ERROR].flatMap((file) => [...source(file).matchAll(/\bt\(\s*"([\w.]+)"/g)]).map((match) => match[1])
    const families = [...view.matchAll(/\bt\(\s*`([\w.]+)\.\$\{/g)].map((match) => match[1])
    expect(literal).toContain("recordedAt")
    expect(families).toEqual(["ago"])
    for (const locale of LOCALES) {
      const have = sentences(catalog(locale)[NAMESPACE]).map(([path]) => path)
      for (const key of literal) expect(have, `${locale}: ${key}`).toContain(key)
      const unused = have.filter((path) => !literal.includes(path) && !families.some((family) => path.startsWith(`${family}.`)))
      expect(unused, locale).toEqual([])
    }
    // The units the page counts an age in are exactly the ones it has words for.
    expect(Object.keys((catalog("ru")[NAMESPACE] as { ago: Record<string, string> }).ago).sort()).toEqual(["hours", "justNow", "minutes"])
  })

  it("the fallback page is the link's own: a worded button that loads the page anew, and no way out to the marketing site", () => {
    const fallback = source(ERROR)
    expect(fallback.startsWith('"use client"')).toBe(true)
    // The application's own error page — Azerbaijani only, with «Ana səhifə» — is not what a visitor lands on.
    expect(fallback).toContain('t("pageFailed")')
    expect(fallback).toContain('t("refresh")')
    // Loaded anew: drawing the same tree again brings the same failed import straight back.
    expect(fallback).toContain("window.location.reload()")
    expect(fallback).not.toMatch(/\breset\b\s*[(,}]/)
    expect(fallback).not.toMatch(/<a\b|href=|next\/link|\/home|leaddrivecrm/)
    // The sentence tells the visitor what to do, and does not promise what this page will not do by itself.
    expect(translator("ru")("pageFailed")).toBe("Не удалось показать страницу. Проверьте интернет и нажмите «Обновить».")
    for (const locale of LOCALES) {
      const t = translator(locale)
      expect(t("pageFailed"), locale).toContain(t("refresh"))
    }
    // There is exactly one such page for the link, beside the page itself.
    expect(source(PAGE)).not.toMatch(/notFound|error\.tsx/)
  })

  it("the map's code is loaded in the browser only, with the page's «загружаем» in its place meanwhile", () => {
    const view = source(VIEW)
    expect(view).toMatch(/dynamic\(\(\) => import\("\.\/location-share-link-map"\), \{ ssr: false, loading: \(\) => <MapLoading \/> \}\)/)
  })

  it("the map takes a point and a name — never the colour a manager gave the employee", () => {
    const map = source(MAP)
    expect(map).toContain('from "./carto-basemap"')
    expect(map).not.toMatch(/mapColor|<Popup|<Polyline|<Circle|<TileLayer/)
    expect(map).toContain('liveMapAgentMarker({ name, freshness: "ONLINE", focused: true })')
  })
})
