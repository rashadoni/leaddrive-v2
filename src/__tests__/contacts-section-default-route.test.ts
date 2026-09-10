import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * В раздел «Контакты» заходят, чтобы найти человека. Открывалась при этом
 * «Аналитика сегментов» — разбивка по категориям и источникам, у нового
 * тенанта сплошь нули, — а сам список жил на отдельном адресе
 * `/contacts/list`, до которого надо было догадаться дойти кнопкой.
 *
 * Список занял корневой адрес раздела, аналитика уехала на
 * `/contacts/segments`. Тест сторожит и сам обмен, и то, что старый адрес
 * никого не потерял.
 */
const listPage = "src/app/(dashboard)/contacts/page.tsx"
const segmentsPage = "src/app/(dashboard)/contacts/segments/page.tsx"
const legacyPage = "src/app/(dashboard)/contacts/list/page.tsx"

describe("the contacts section opens on the contact list", () => {
  it("puts the list at the section root", () => {
    expect(existsSync(listPage)).toBe(true)
    const source = readFileSync(listPage, "utf8")
    // Список узнаётся по своим якорям тура и по справке именно списка.
    expect(source).toContain('data-tour-id="contacts-stats"')
    expect(source).toContain('slug="contacts-list"')
  })

  it("keeps segment analytics reachable at its own address", () => {
    expect(existsSync(segmentsPage)).toBe(true)
    const source = readFileSync(segmentsPage, "utf8")
    expect(source).toContain('useTranslations("insights")')
    expect(source).toContain('slug="contacts"')
  })

  it("sends the sidebar to the section root", () => {
    const nav = readFileSync("src/lib/nav-items.ts", "utf8")
    expect(nav).toContain('href: "/contacts"')
    expect(nav).not.toContain('href: "/contacts/list"')
  })
})

describe("the old address still lands somewhere useful", () => {
  const redirect = readFileSync(legacyPage, "utf8")

  it("redirects instead of 404ing", () => {
    // На /contacts/list ссылаются уведомления, закладки и справка.
    expect(redirect).toContain('router.replace')
    expect(redirect).toContain('"/contacts"')
  })

  it("carries the query string across", () => {
    // С дашборда сюда приходят с ?category=... — потерять фильтр по дороге
    // значит открыть весь список вместо выбранного сегмента.
    expect(redirect).toContain("searchParams.toString()")
    expect(redirect).toContain("`/contacts?${query}`")
  })
})

describe("nothing still points at the moved routes", () => {
  const sources = [
    "src/components/dashboard/segments-widget.tsx",
    "src/app/(dashboard)/contacts/[id]/page.tsx",
    "src/app/(dashboard)/settings/portal-users/page.tsx",
    "src/content/help/contacts/ru.tsx",
    "src/content/help/contacts-list/ru.tsx",
  ]

  it("has no leftover /contacts/list link outside the redirect itself", () => {
    for (const file of sources) {
      expect(readFileSync(file, "utf8"), file).not.toContain("/contacts/list")
    }
  })

  it("points the analytics entry points at the new address", () => {
    const widget = readFileSync("src/components/dashboard/segments-widget.tsx", "utf8")
    expect(widget).toContain('href="/contacts/segments"')
    expect(readFileSync(listPage, "utf8")).toContain('router.push("/contacts/segments")')
  })
})
