// @vitest-environment jsdom
/**
 * «Оценка на совместном визите» in MTM settings (owner-approved mockup,
 * 2026-10-21): the company's questions, each with «Изменить» and «Удалить» in
 * words — the owner, shown a first mockup where a name opened when clicked:
 * «а как редактировать… или хочу удалить?».
 *
 * The real page with the real Russian copy; the network is stubbed and keeps
 * what was written. What is held here: every change goes out with the page's
 * one «Сохранить» and only then, a deleted question waits in its place with
 * «Вернуть» until that save, the last question cannot be deleted, and the
 * sheet beside the list is the list.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { readHint } from "./helpers/hint"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    let node: unknown = ru[namespace]
    for (const part of key.split(".")) node = (node as Messages | undefined)?.[part]
    const raw = typeof node === "string" ? node : `${namespace}.${key}`
    return raw.replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
  },
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { role: "manager" } } }) }))
vi.mock("@/hooks/use-mtm-org-settings", () => ({ notifyMtmSettingsChanged: vi.fn() }))
vi.mock("@/components/page-description", () => ({ PageDescription: () => null }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
const section = vi.hoisted(() => (exportName: string, name: string) => async () => {
  const react = await import("react")
  return { [exportName]: () => react.createElement("div", { "data-section": name }) }
})
vi.mock("@/app/(dashboard)/mtm/settings/contact-card-settings", section("ContactCardSettings", "contact-card"))
vi.mock("@/app/(dashboard)/mtm/settings/contact-dictionary-settings", section("ContactDictionarySettings", "contact-dictionary"))
vi.mock("@/app/(dashboard)/mtm/settings/organization-attribute-package-settings", section("OrganizationAttributePackageSettings", "attribute-packages"))
vi.mock("@/app/(dashboard)/mtm/settings/scoring-formula-settings", section("ScoringFormulaSettings", "scoring"))
vi.mock("@/components/mtm/coverage-policy-admin", section("CoveragePolicyAdmin", "coverage"))
vi.mock("@/components/mtm/kpi-policy-admin", section("KpiPolicyAdmin", "kpi"))

import MtmSettingsPage from "@/app/(dashboard)/mtm/settings/page"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"
import { MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS } from "@/lib/mtm/visit-evaluation-questions"

const page = ru.mtmSettingsPage as Record<string, string> & { hint: Record<string, string> }
const ORIGINAL_RU = MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS.map((question) => question.labels.ru)

let stored: Record<string, unknown> = {}
let writes: Record<string, unknown>[] = []
let root: Root
let container: HTMLDivElement

const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}
const block = () => container.querySelector('[data-testid="visit-evaluation-questions"]') as HTMLElement
const names = () => [...block().querySelectorAll('[data-testid="visit-evaluation-question-name"]')].map((node) => node.textContent)
const preview = () => [...block().querySelectorAll('[data-testid="visit-evaluation-question-preview"] li')].map((node) => node.querySelector("span")?.textContent)
const row = (id: string) => block().querySelector(`[data-testid="visit-evaluation-question-${id}"]`) as HTMLElement
const button = (scope: Element, text: string) => [...scope.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === text) as HTMLButtonElement
const press = async (target: HTMLButtonElement) => { await act(async () => { target.click() }) }
const type = async (value: string) => {
  const input = block().querySelector('[data-testid="visit-evaluation-question-input"]') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const saveBar = () => container.querySelector('[data-testid="mtm-settings-save-bar"]') as HTMLElement
const pressSave = async () => {
  await press(button(saveBar(), page.save))
  await settle()
}

async function open() {
  await act(async () => { root.render(createElement(MtmSettingsPage)) })
  await settle()
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  stored = { ...MTM_SETTING_DEFAULTS }
  writes = []
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: { method?: string; body?: string }) => {
    const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
    const url = String(input)
    if ((init?.method ?? "GET") === "GET") {
      if (url.includes("/visit-policies")) {
        return reply(200, { success: true, data: { policies: [], access: { kind: "admin", canWriteOrganizationWide: true, writableTeamIds: null } } })
      }
      if (url.includes("/mtm/settings")) return reply(200, { success: true, data: stored })
      return reply(200, { success: true, data: { teams: [], agents: [], customers: [] } })
    }
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>
    writes.push(body)
    stored = { ...stored, ...body }
    return reply(200, { success: true, data: { ignoredKeys: [] } })
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("«Оценка на совместном визите» in MTM settings", () => {
  it("stands on the visit tab with the six questions, and the manager's sheet beside them is the same list", async () => {
    await open()
    expect(block().closest('[role="tabpanel"]')?.id).toBe("mtm-settings-panel-visit")
    expect(block().textContent).toContain(page.evalQuestionsTitle)
    expect(names()).toEqual(ORIGINAL_RU)
    expect(preview()).toEqual(ORIGINAL_RU)
    // Every question says what can be done with it, in words.
    for (const question of MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS) {
      expect(button(row(question.id), page.evalQuestionEdit)).toBeTruthy()
      expect(button(row(question.id), page.evalQuestionDelete)).toBeTruthy()
    }
    expect(await readHint(button(row("PREPARATION"), page.evalQuestionDelete).parentElement)).toBe(page.hint.evalQuestionDelete)
  })

  it("renames a question, and the change waits for «Сохранить»", async () => {
    await open()
    await press(button(row("PREPARATION"), page.evalQuestionEdit))
    await type("Подготовка: план визита и материалы")
    // Typing changes nothing yet; «Готово» puts it in the list.
    expect(names()[0]).toBe("Подготовка к визиту")
    await press(button(block(), page.evalQuestionDone))
    expect(names()[0]).toBe("Подготовка: план визита и материалы")
    expect(preview()[0]).toBe("Подготовка: план визита и материалы")
    expect(writes).toEqual([])
    expect(container.querySelector('[data-testid="mtm-settings-tab-mark-visit"]')?.getAttribute("data-mark")).toBe("unsaved")

    await pressSave()
    expect(writes).toHaveLength(1)
    const sent = writes[0].visitEvaluationQuestions as Array<{ id: string; labels: Record<string, string> }>
    expect(Object.keys(writes[0])).toEqual(["visitEvaluationQuestions"])
    // The other languages carried the very same Russian text only if nobody translated them: here they were translated.
    expect(sent[0]).toEqual({ id: "PREPARATION", labels: { az: "Vizitə hazırlıq", ru: "Подготовка: план визита и материалы", en: "Visit preparation" } })
    expect(sent.slice(1)).toEqual(MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS.slice(1))
  })

  it("adds a question at the end, written once for all three languages", async () => {
    await open()
    await press(block().querySelector('[data-testid="visit-evaluation-question-add"]') as HTMLButtonElement)
    const done = block().querySelector('[data-testid="visit-evaluation-question-done"]') as HTMLButtonElement
    expect(done.disabled).toBe(true)
    await type("Работа с образцами")
    await press(done)
    expect(names()).toEqual([...ORIGINAL_RU, "Работа с образцами"])
    expect(preview()).toEqual([...ORIGINAL_RU, "Работа с образцами"])

    await pressSave()
    const sent = writes[0].visitEvaluationQuestions as Array<{ id: string; labels: Record<string, string> }>
    expect(sent).toHaveLength(7)
    expect(sent[6].id).toMatch(/^q-[a-z0-9]+$/)
    expect(sent[6].labels).toEqual({ az: "Работа с образцами", ru: "Работа с образцами", en: "Работа с образцами" })
  })

  it("deletes a question; until «Сохранить» it waits in its place with «Вернуть»", async () => {
    await open()
    await press(button(row("OBJECTIONS"), page.evalQuestionDelete))
    expect(names()).toEqual(ORIGINAL_RU.filter((name) => name !== "Работа с возражениями"))
    expect(preview()).not.toContain("Работа с возражениями")
    const removed = block().querySelector('[data-testid="visit-evaluation-question-removed-OBJECTIONS"]') as HTMLElement
    expect(removed.textContent).toContain("«Работа с возражениями» удалён")
    // In its place: after the question that stood above it.
    expect(removed.previousElementSibling?.getAttribute("data-testid")).toBe("visit-evaluation-question-PRESENTATION")

    await press(button(removed, page.evalQuestionRestore))
    expect(names()).toEqual(ORIGINAL_RU)
    expect(saveBar().hidden).toBe(true)

    await press(button(row("OBJECTIONS"), page.evalQuestionDelete))
    await pressSave()
    expect((writes[0].visitEvaluationQuestions as Array<{ id: string }>).map((question) => question.id))
      .toEqual(["PREPARATION", "RAPPORT", "NEEDS", "PRESENTATION", "CLOSING"])
    // Saved: the line with «Вернуть» is gone with it.
    expect(block().querySelector('[data-testid="visit-evaluation-question-removed-OBJECTIONS"]')).toBeNull()
  })

  it("moves a question with the arrows, and never lets the last one go", async () => {
    await open()
    await press(row("RAPPORT").querySelector(`button[aria-label="${page.evalQuestionMoveUp}"]`) as HTMLButtonElement)
    expect(names().slice(0, 2)).toEqual(["Контакт с клиентом", "Подготовка к визиту"])
    expect(preview().slice(0, 2)).toEqual(["Контакт с клиентом", "Подготовка к визиту"])

    for (const id of ["RAPPORT", "PREPARATION", "NEEDS", "PRESENTATION", "OBJECTIONS"]) {
      await press(button(row(id), page.evalQuestionDelete))
    }
    const last = button(row("CLOSING"), page.evalQuestionDelete)
    expect(last.disabled).toBe(true)
    expect(await readHint(last.parentElement)).toBe(page.hint.evalQuestionDeleteLast)
  })
})
