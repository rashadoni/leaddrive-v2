// @vitest-environment jsdom
/**
 * «Названия в вашей компании», the screen where a salon stops being a salon.
 *
 * The owner asked for the setting and, in the same breath, for it to be
 * understandable without being explained (2026-11-12: «чтоб было интуитивно и
 * дизайн не делай как на коленках, максимально понятно»). So what is checked
 * here is not that the fields exist — it is the three things that make them
 * readable:
 *
 *   1. ready-made pairs, one tap each, so most organisations never type;
 *   2. «nobody does it» empties and disables the second field rather than
 *      leaving an empty box that looks unfinished;
 *   3. a preview of the client's own form, in the words just chosen — the
 *      only place these words are read by somebody who is not staff.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  return {
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: "ru", messages: ru as never, namespace: namespace as never }),
    useLocale: () => "ru",
  }
})

import { BookingVocabularyCard } from "@/components/booking/booking-vocabulary-card"

// React needs to be told it is inside a test, or every act() warns.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
/** What the screen last sent to the server. */
let saved: Record<string, unknown> | null = null

beforeEach(async () => {
  saved = null
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "PUT") {
      saved = JSON.parse(init.body ?? "{}")
      return { ok: true, json: async () => ({ success: true, data: { vocabulary: saved } }) }
    }
    return { ok: true, json: async () => ({ success: true, data: { vocabulary: { item: null, host: null, noHost: false } } }) }
  }))
  container = document.createElement("div")
  document.body.append(container)
  await act(async () => {
    root = createRoot(container)
    root.render(createElement(BookingVocabularyCard))
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const buttonSaying = (text: string) => [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(text))
const field = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!

describe("naming what you book", () => {
  it("offers ready-made pairs before it offers fields", () => {
    // A coworking taps «Комната · без мастера» and is done.
    expect(buttonSaying("Услуга · Мастер")).toBeTruthy()
    expect(buttonSaying("Приём · Врач")).toBeTruthy()
    expect(buttonSaying("Встреча · Комната")).toBeTruthy()
  })

  it("fills both words from a pair, and says which one is chosen", async () => {
    await act(async () => buttonSaying("Приём · Врач")!.click())

    expect(field("vocab-item").value).toBe("Приём")
    expect(field("vocab-host").value).toBe("Врач")
    expect(buttonSaying("Приём · Врач")!.getAttribute("aria-pressed")).toBe("true")
    expect(buttonSaying("Встреча · Комната")!.getAttribute("aria-pressed")).toBe("false")
  })

  it("empties and closes the second field when nobody is on the other side", async () => {
    // The checkbox, not a pair: a coworking books a meeting IN a room, so the
    // room is the second word. «Nobody» is for the rarer case where there is
    // nothing on the other side at all.
    await act(async () => buttonSaying("Встреча · Комната")!.click())
    const nobody = [...container.querySelectorAll("label")].find((item) => item.textContent?.includes("Никто"))!
    await act(async () => nobody.querySelector<HTMLElement>("button, input")!.click())

    expect(field("vocab-item").value).toBe("Встреча")
    expect(field("vocab-host").value).toBe("")
    expect(field("vocab-host").disabled).toBe(true)
    // And the client's preview loses that row with it: a room books itself.
    const preview = container.querySelector(".bg-muted\\/30")?.textContent ?? ""
    expect(preview).toContain("Встреча")
    expect(preview).not.toContain("Комната")
  })

  it("shows the client's own form in the words just chosen", async () => {
    await act(async () => buttonSaying("Приём · Врач")!.click())

    const preview = container.querySelector(".bg-muted\\/30")?.textContent ?? ""
    expect(preview).toContain("Приём")
    expect(preview).toContain("Врач")
    expect(preview).toContain("День")
    expect(preview).toContain("Время")
  })

  it("saves exactly what is on screen, and only once it differs", async () => {
    const save = () => buttonSaying("Сохранить")!
    // Nothing chosen yet: there is nothing to save.
    expect(save().disabled).toBe(true)

    await act(async () => buttonSaying("Встреча · Комната")!.click())
    expect(save().disabled).toBe(false)
    await act(async () => save().click())

    expect(saved).toEqual({ item: "Встреча", host: "Комната", noHost: false })
    expect(save().disabled).toBe(true)
  })
})
