// @vitest-environment jsdom
/**
 * The selected employee's links to the other screens, as the dispatcher sees
 * them in the card on the live map (owner, 2026-10-09, of the fleet tracker
 * shown to him as the model: «бери почти всё, чего у нас нет»).
 *
 * Which addresses are offered is tested in lib-mtm-live-map-agent-links. Here:
 * every link is a word that can be read, it opens the address it was given,
 * and the one link that is not about the employee says so.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Messages
const ru = messages("ru")
const KEYS = ["history", "alerts", "period", "tasks", "card", "alertRules", "alertRulesHint", "forEmployee"] as const
/**
 * The Russian words of `mtmMap.links`, for a checkout where the three message
 * files do not carry them yet. The files win as soon as they do, and the last
 * test in this file fails until they do — this table is not a way around it.
 */
const WORDS_NOT_IN_THE_FILES_YET: Record<string, string> = {
  "mtmMap.links.history": "История за день",
  "mtmMap.links.alerts": "Оповещения",
  "mtmMap.links.period": "Отчёт за период",
  "mtmMap.links.tasks": "Задачи",
  "mtmMap.links.card": "Профиль сотрудника",
  "mtmMap.links.alertRules": "Настройки оповещений",
  "mtmMap.links.alertRulesHint": "Правила оповещений общие для всей организации: отдельных правил для одного сотрудника нет",
  "mtmMap.links.forEmployee": "{label}: {name}",
}

vi.mock("next-intl", () => {
  const translators = new Map<string, (key: string, values?: Record<string, unknown>) => string>()
  return {
    useLocale: () => "ru",
    useTranslations: (namespace: string) => {
      let translate = translators.get(namespace)
      if (!translate) {
        translate = (key, values) => {
          let node: unknown = ru
          for (const part of `${namespace}.${key}`.split(".")) node = (node as Messages | undefined)?.[part]
          const raw = typeof node === "string" ? node : WORDS_NOT_IN_THE_FILES_YET[`${namespace}.${key}`] ?? `${namespace}.${key}`
          return raw.replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
        }
        translators.set(namespace, translate)
      }
      return translate
    },
  }
})
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react")
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => h("a", { href, ...rest }, children as never) }
})

import { LiveMapAgentLinks } from "@/components/mtm/live-map-agent-links"
import { liveMapAgentLinks } from "@/lib/mtm/live-map-agent-links"

let root: Root
let container: HTMLDivElement
const show = async (links: ReturnType<typeof liveMapAgentLinks>, agentName = "Северов Тимур") => {
  await act(async () => { root.render(createElement(LiveMapAgentLinks, { links, agentName })) })
}
const pill = (id: string) => container.querySelector(`[data-testid="live-map-agent-link-${id}"]`) as HTMLAnchorElement | null
const pills = () => [...container.querySelectorAll('[data-testid^="live-map-agent-link-"]')] as HTMLAnchorElement[]
const everyLink = () => liveMapAgentLinks({ agentId: "agent-7", tenantToday: "2026-10-09", fieldContactsEnabled: true })

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("the selected employee's links to the other screens", () => {
  it("are words a dispatcher reads, each opening the screen already narrowed to the employee", async () => {
    await show(everyLink())
    expect(pills().map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["История за день", "/mtm/map?mode=history&agentId=agent-7&date=2026-10-09"],
      ["Оповещения", "/mtm/alerts?agentId=agent-7"],
      ["Отчёт за период", "/mtm/calendar?view=agent&agentId=agent-7"],
      ["Задачи", "/mtm/tasks?agentId=agent-7"],
      ["Профиль сотрудника", "/mtm/agents/agent-7"],
      ["Настройки оповещений", "/mtm/settings?tab=alerts"],
    ])
    // Links, not buttons: a middle click or «open in a new tab» keeps the map open.
    expect(pills().every((link) => link.tagName === "A")).toBe(true)
    // The picture beside the word is decoration; the word is the name.
    for (const link of pills()) expect(link.querySelector("svg")?.getAttribute("aria-hidden"), link.textContent ?? "").toBe("true")
  })

  it("say whose screen each one opens when the links are read out as a list", async () => {
    await show(everyLink(), "Северов Тимур")
    expect(["history", "alerts", "period", "tasks", "card"].map((id) => pill(id)?.getAttribute("aria-label"))).toEqual([
      "История за день: Северов Тимур",
      "Оповещения: Северов Тимур",
      "Отчёт за период: Северов Тимур",
      "Задачи: Северов Тимур",
      "Профиль сотрудника: Северов Тимур",
    ])
    // What is read out begins with what is written on the pill.
    for (const link of pills()) expect(link.getAttribute("aria-label") ?? link.textContent).toContain(link.textContent ?? "")

    // An employee whose name has not arrived is not read out as «Оповещения: » and a pause.
    await show(everyLink(), " ")
    expect(pills().filter((link) => link.hasAttribute("aria-label"))).toEqual([])
    expect(pills().map((link) => link.textContent)).toContain("Оповещения")
  })

  it("say that the alert rules are the whole organization's, and do not name the employee on that link", async () => {
    await show(everyLink(), "Северов Тимур")
    const rules = pill("alertRules")
    expect(rules?.getAttribute("title")).toBe("Правила оповещений общие для всей организации: отдельных правил для одного сотрудника нет")
    expect(rules?.getAttribute("aria-label")).toBeNull()
    expect(rules?.getAttribute("href")).not.toContain("agent-7")
    // The hint belongs to that link alone.
    expect(pills().filter((link) => link.hasAttribute("title")).map((link) => link.dataset.testid)).toEqual(["live-map-agent-link-alertRules"])
  })

  it("show the links they were given, in that order, and nothing in their place when one is not offered", async () => {
    // The organization's day is not known yet, and it keeps no employee sections.
    await show(liveMapAgentLinks({ agentId: "agent-7", tenantToday: null, fieldContactsEnabled: false }))
    expect(pill("history")).toBeNull()
    expect(pills().map((link) => link.dataset.testid?.replace("live-map-agent-link-", ""))).toEqual(["alerts", "period", "tasks", "card", "alertRules"])
    expect(pill("card")?.getAttribute("href")).toBe("/mtm/agents?agentId=agent-7")
  })

  it("leave no empty row behind when there is nothing to link to", async () => {
    await show([])
    expect(container.innerHTML).toBe("")
  })

  it("are large enough for a finger on a tablet", async () => {
    await show(everyLink())
    for (const link of pills()) expect(link.className, link.textContent ?? "").toContain("[@media(pointer:coarse)]:min-h-11")
  })

  // The words live in the three message files. This is the test that fails
  // while they are missing from any of them: a key without words is drawn on
  // screen as «mtmMap.links.alerts».
  it("have their words in Russian, English and Azerbaijani, with the same blanks to fill in", () => {
    const wordsOf = (locale: string) => ((messages(locale).mtmMap as Messages | undefined)?.links ?? {}) as Messages
    for (const locale of ["ru", "en", "az"]) {
      const links = wordsOf(locale)
      for (const key of KEYS) {
        expect(typeof links[key] === "string" && (links[key] as string).trim().length > 0, `${locale}: mtmMap.links.${key}`).toBe(true)
      }
      // A key present in one language only is a key path on screen in the other two.
      expect(Object.keys(links).sort(), locale).toEqual(Object.keys(wordsOf("ru")).sort())
      const blanks = String(links.forEmployee).match(/\{\w+\}/g)?.sort()
      expect(blanks, `${locale}: mtmMap.links.forEmployee`).toEqual(["{label}", "{name}"])
      // A case ending glued to a name nobody knows in advance («{name}-dən») is wrong for half the names.
      for (const key of KEYS) expect(String(links[key]), `${locale}: mtmMap.links.${key}`).not.toMatch(/\}[-‑']?\p{L}/u)
    }
  })
})
