// @vitest-environment jsdom
/**
 * The routes screens' hints (owner, 2026-10-15: «подсказок в модуле очень
 * мало»): the words exist in all three languages, every word written is used,
 * and a button says under the cursor what it will do.
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

import { MtmRoutesAwaitingPublish } from "@/components/mtm/routes-awaiting-publish"
import type { MtmRouteRecord } from "@/components/mtm/route-types"

const hintsOf = (locale: string, namespace: string) => (((messages(locale)[namespace] as Messages).hint ?? {}) as Record<string, string>)
const blanks = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
const ROUTES_SOURCES = [
  "src/app/(dashboard)/mtm/routes/page.tsx",
  ...["routes-awaiting-publish", "route-travel-panel", "route-calendar", "route-week-plan", "route-approval-queue",
    "customer-request-queue", "customer-location-request-queue", "customer-create-request-panel", "route-builder",
    "route-planning-matrix", "route-builder-inline-assignment-panel"].map((name) => `src/components/mtm/${name}.tsx`),
]
const used = (files: string[]) => {
  const keys = new Set(files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/"hint\.(\w+)"/g)].map((match) => match[1])))
  // The status chips name their hint by the status: `hint.status${s}`.
  if (files.some((file) => readFileSync(file, "utf8").includes("t(`hint.status${s}`)"))) {
    for (const status of ["DRAFT", "PLANNED", "IN_PROGRESS", "COMPLETED", "INCOMPLETE", "CANCELLED"]) keys.add(`status${status}`)
  }
  return keys
}

describe.each([
  ["mtmRoutesPage", ROUTES_SOURCES],
  ["mtmAgentPeriod", ["src/components/mtm/agent-period-view.tsx"]],
] as const)("the hints of %s", (namespace, files) => {
  const keys = used([...files])
  it("are written for every key the screen asks for, in Russian, Azerbaijani and English, with the same blanks", () => {
    expect(keys.size).toBeGreaterThan(4)
    const [r, a, e] = ["ru", "az", "en"].map((locale) => hintsOf(locale, namespace))
    const missing: string[] = []
    for (const key of keys) {
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
    expect(Object.keys(hintsOf("ru", namespace)).filter((key) => !keys.has(key))).toEqual([])
  })
})

describe("a draft waiting to be published", () => {
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

  it("says under the cursor that the employee does not see it until it is published", async () => {
    const route = { id: "r1", version: 1, agentId: "a1", agent: { id: "a1", name: "Agent A" }, date: "2026-10-15T00:00:00.000Z", status: "DRAFT", totalPoints: 2, visitedPoints: 0 } as MtmRouteRecord
    await act(async () => {
      root.render(createElement(MtmRoutesAwaitingPublish, { routes: [route], todayKey: "2026-10-15", canPublish: true, onOpen: () => {}, onPublish: async () => {} }))
    })
    const buttons = [...container.querySelectorAll("button")]
    const publish = buttons.find((button) => button.textContent?.includes("Опубликовать"))
    // The publish button can be disabled while another publishes: the hint sits on a span around it.
    expect(await readHint(publish?.parentElement)).toBe(hintsOf("ru", "mtmRoutesPage").publish)
    expect(await readHint(buttons.find((button) => button.textContent === "Открыть"))).toBe(hintsOf("ru", "mtmRoutesPage").awaitingOpen)
  })
})
