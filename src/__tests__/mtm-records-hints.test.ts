// @vitest-environment jsdom
/**
 * The hints of the visits, employees, clients and institutions screens (owner,
 * 2026-10-15: «подсказок в модуле очень мало»): words in all three languages,
 * none unused, and a visit's place verdict says what it means.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { readHint } from "./helpers/hint"

type Messages = { [key: string]: string | Messages }
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Messages
const ru = messages("ru")

vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    let node: unknown = ru
    for (const part of `${namespace}.${key}`.split(".")) node = (node as Messages | undefined)?.[part]
    return (typeof node === "string" ? node : `${namespace}.${key}`).replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
  },
}))

import { VisitPlaceBadge } from "@/components/mtm/visit-place-badge"

const at = (path: string, locale: string) => {
  let node: unknown = messages(locale)
  for (const part of path.split(".")) node = (node as Messages | undefined)?.[part]
  return ((node as Messages | undefined) ?? {}) as Record<string, string>
}
const blanks = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
const keysIn = (files: string[], prefix: string) => new Set(files.flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(new RegExp(`"${prefix.replace(/\./g, "\\.")}(\\w+)"`, "g"))].map((match) => match[1])))

const SCREENS = [
  ["mtmVisitsPage.hint", ["src/app/(dashboard)/mtm/visits/page.tsx"], "hint."],
  ["mtmAgents.hint", ["src/app/(dashboard)/mtm/agents/page.tsx"], "hint."],
  ["mtmContactExplorer.hint", ["contact-explorer", "contact-transfer-dialog", "contact-assignment-dialog"].map((name) => `src/components/mtm/${name}.tsx`), "hint."],
  ["mtmCustomers.explorer.hint", ["src/components/mtm/organization-explorer.tsx"], "explorer.hint."],
] as const

describe.each(SCREENS)("the hints of %s", (path, files, prefix) => {
  const used = keysIn([...files], prefix)
  if (path === "mtmCustomers.explorer.hint") {
    // The column headings name their hint through COLUMN_HINT.
    for (const match of readFileSync(files[0], "utf8").matchAll(/^\s+\w+: "(col\w+)",$/gm)) used.add(match[1])
  }
  it("are written for every key the screen asks for, in Russian, Azerbaijani and English, with the same blanks", () => {
    expect(used.size).toBeGreaterThan(3)
    const [r, a, e] = ["ru", "az", "en"].map((locale) => at(path, locale))
    const missing: string[] = []
    for (const key of used) {
      for (const [locale, texts] of [["ru", r], ["az", a], ["en", e]] as const) {
        if (typeof texts[key] !== "string" || texts[key].trim().length < 8) missing.push(`${locale}.${key}`)
      }
      if (typeof r[key] === "string") {
        expect(blanks(a[key] ?? ""), `az.${key}`).toEqual(blanks(r[key]))
        expect(blanks(e[key] ?? ""), `en.${key}`).toEqual(blanks(r[key]))
      }
    }
    expect(missing).toEqual([])
  })
  it("has no words the screen never shows", () => {
    expect(Object.keys(at(path, "ru")).filter((key) => !used.has(key))).toEqual([])
  })
})

describe("a visit's place verdict", () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => { root.unmount() })
    container.remove()
  })

  it("says under the cursor what each verdict means, in every language", async () => {
    const verdicts = ["at_point", "outside", "checkout_gps_missing", "checkin_gps_missing", "no_gps", "no_pin"] as const
    for (const locale of ["ru", "az", "en"]) {
      const texts = at("mtmPlaceCheck.hint", locale)
      for (const verdict of verdicts) expect(typeof texts[verdict] === "string" && texts[verdict].length > 20, `${locale}.${verdict}`).toBe(true)
      expect(typeof texts.locationHidden).toBe("string")
    }
    const place = { verdict: "checkout_gps_missing", distanceMeters: 40, radiusMeters: 100, checkIn: { state: "at_point", distanceMeters: 40, radiusMeters: 100 }, checkOut: { state: "no_gps", distanceMeters: null, radiusMeters: 100 }, checkOutSkipped: null }
    await act(async () => { root.render(createElement(VisitPlaceBadge, { place: place as never })) })
    expect(container.textContent).toContain("Нет GPS на выходе")
    expect(await readHint(container.querySelector("[data-hint-value]"))).toBe(at("mtmPlaceCheck.hint", "ru").checkout_gps_missing)
  })
})
