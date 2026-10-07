// @vitest-environment jsdom
/**
 * Route & Field → Settings → «Кнопки выбора клиентов».
 *
 * Owner, 2026-10-08, looking at five identical forms titled «Тип 1 … Тип 5»,
 * each with three name fields, a «data source», an «organization category» and
 * an «additional exact type»: «это нельзя как-то интерактивнее сделать?
 * переводы какие-то непонятные и сама структура какая-то непонятная».
 *
 * The real editor, with the real Russian copy, held by a parent that keeps
 * what it is given — as the settings page does — so a row and the phone beside
 * it show what was actually stored.
 */
import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    const node = (ru[namespace] as Messages | undefined)?.[key]
    const raw = typeof node === "string" ? node : `${namespace}.${key}`
    return raw.replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
  },
}))

import { RouteTargetTypeSettings } from "@/app/(dashboard)/mtm/settings/route-target-type-settings"
import {
  MTM_ROUTE_TARGET_AUDIENCES,
  MTM_ROUTE_TARGET_TYPE_DEFAULTS,
  parseMtmRouteTargetTypes,
  renameRouteTarget,
  routeTargetAudience,
  routeTargetAudiencePatch,
  type MtmRouteTargetType,
} from "@/lib/mtm/route-target-types"

let root: Root
let container: HTMLDivElement
let stored: MtmRouteTargetType[] = []
const defaults = () => MTM_ROUTE_TARGET_TYPE_DEFAULTS.map((row) => ({ ...row, labels: { ...row.labels } }))

function Holder({ initial }: { initial: MtmRouteTargetType[] }) {
  const [value, setValue] = useState(initial)
  stored = value
  return createElement(RouteTargetTypeSettings, { value, onChange: setValue })
}

async function open(initial: MtmRouteTargetType[] = defaults()) {
  await act(async () => { root.render(createElement(Holder, { initial })) })
}
const row = (id: string) => container.querySelector(`[data-testid="route-target-row-${id}"]`) as HTMLElement
const rowText = (id: string) => row(id).querySelector("[aria-expanded]")?.textContent ?? ""
const expand = async (id: string) => { await act(async () => { (row(id).querySelector("button[aria-expanded]") as HTMLButtonElement).click() }) }
const toggle = async (id: string) => { await act(async () => { (row(id).querySelector('[role="switch"]') as HTMLButtonElement).click() }) }
const preview = () => [...container.querySelectorAll('[data-testid="route-target-preview"] .grid > span')].map((button) => button.textContent)
const setInput = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  await act(async () => { setter?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })) })
}
const choose = async (select: HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
  await act(async () => { setter?.call(select, value); select.dispatchEvent(new Event("change", { bubbles: true })) })
}
const storedRow = (id: string) => stored.find((item) => item.id === id) as MtmRouteTargetType

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

describe("whom a button shows, as one choice", () => {
  it("reads every stored default as a plain choice and writes that choice back as the same storage", () => {
    expect(MTM_ROUTE_TARGET_TYPE_DEFAULTS.map((target) => [target.id, routeTargetAudience(target)])).toEqual([
      ["all-customers", "all"], ["doctors", "doctors"], ["pharmacies", "pharmacies"], ["clinics", "clinics"], ["organizations", "others"],
    ])
    for (const audience of MTM_ROUTE_TARGET_AUDIENCES) {
      const { direction, objectType } = routeTargetAudiencePatch(audience)
      expect([audience, routeTargetAudience({ direction, objectType })]).toEqual([audience, audience])
    }
    // Every choice is something the server accepts.
    const built = MTM_ROUTE_TARGET_AUDIENCES.map((audience, index) => ({
      id: `b${index}`, labels: { az: "a", ru: "b", en: "c" }, organizationKind: null, enabled: true, ...routeTargetAudiencePatch(audience),
    }))
    expect(parseMtmRouteTargetTypes(built).success).toBe(true)
  })

  it("does not pass off a combination the list has no word for as one of its choices", () => {
    expect(routeTargetAudience({ direction: "PHARMACY", objectType: "CLINIC" })).toBe("custom")
    expect(routeTargetAudience({ direction: "ORGANIZATION", objectType: "PHARMACY" })).toBe("pharmacies")
  })

  it("carries a new name into the languages nobody translated, and leaves a real translation alone", () => {
    expect(renameRouteTarget({ az: "Новая кнопка", ru: "Новая кнопка", en: "Новая кнопка" }, "ru", "Больницы"))
      .toEqual({ az: "Больницы", ru: "Больницы", en: "Больницы" })
    expect(renameRouteTarget({ az: "Xəstəxanalar", ru: "Новая кнопка", en: "Новая кнопка" }, "ru", "Больницы"))
      .toEqual({ az: "Xəstəxanalar", ru: "Больницы", en: "Больницы" })
  })
})

describe("«Кнопки выбора клиентов»", () => {
  it("lists the buttons by their name and by whom they show, not as numbered forms", async () => {
    await open()
    expect(container.textContent).toContain("Кнопки выбора клиентов")
    expect(container.textContent).not.toMatch(/Тип \d/)
    expect(["all-customers", "doctors", "pharmacies", "clinics", "organizations"].map(rowText)).toEqual([
      "Все клиентыПоказывает: все клиенты",
      "ВрачиПоказывает: врачи",
      "АптекиПоказывает: аптеки",
      "КлиникиПоказывает: клиники",
      "Другие организацииПоказывает: другие организации",
    ])
    // Closed rows carry no form at all.
    expect(container.querySelectorAll("input, select")).toHaveLength(0)
  })

  it("draws the picker the agent sees from the same rows, and takes a switched-off button out of it", async () => {
    await open()
    expect(preview()).toEqual(["Все клиенты", "Врачи", "Аптеки", "Клиники", "Другие организации"])
    await toggle("pharmacies")
    expect(storedRow("pharmacies").enabled).toBe(false)
    expect(preview()).toEqual(["Все клиенты", "Врачи", "Клиники", "Другие организации"])
  })

  it("follows a change of order in the picker", async () => {
    await open()
    await act(async () => { (row("clinics").querySelector('[aria-label="Переместить выше"]') as HTMLButtonElement).click() })
    expect(stored.map((item) => item.id)).toEqual(["all-customers", "doctors", "clinics", "pharmacies", "organizations"])
    expect(preview().slice(1, 4)).toEqual(["Врачи", "Клиники", "Аптеки"])
  })

  it("opens a row to its name and one question — whom it shows — and stores the answer", async () => {
    await open()
    await expand("organizations")
    const fields = [...row("organizations").querySelectorAll("label")].map((label) => label.querySelector("span")?.textContent)
    expect(fields.slice(0, 2)).toEqual(["Название кнопки", "Кого показывает"])
    const select = row("organizations").querySelector("select") as HTMLSelectElement
    expect([...select.options].map((option) => option.textContent)).toEqual(["Все клиенты", "Врачи", "Аптеки", "Клиники", "Магазины", "Другие организации"])

    await choose(select, "stores")
    expect(storedRow("organizations")).toMatchObject({ direction: "ORGANIZATION", objectType: "STORE" })
    expect(rowText("organizations")).toContain("Показывает: магазины")
  })

  it("renames a button in the language on screen, and the picker shows the new name", async () => {
    await open()
    await expand("clinics")
    await setInput(row("clinics").querySelector("input") as HTMLInputElement, "Больницы")
    expect(storedRow("clinics").labels).toEqual({ az: "Klinikalar", ru: "Больницы", en: "Clinics" })
    expect(preview()).toContain("Больницы")
  })

  it("keeps the other languages one click away instead of three fields on every card", async () => {
    await open()
    await expand("doctors")
    expect(row("doctors").querySelectorAll("input")).toHaveLength(1)
    const more = [...row("doctors").querySelectorAll("button")].find((button) => button.textContent === "Названия на других языках") as HTMLButtonElement
    await act(async () => { more.click() })
    expect([...row("doctors").querySelectorAll("label")].map((label) => label.querySelector("span")?.textContent).slice(-2))
      .toEqual(["По-азербайджански", "По-английски"])
  })

  it("adds a button already open for naming, and it appears in the picker", async () => {
    await open()
    const add = [...container.querySelectorAll("button")].find((button) => button.textContent === "Добавить кнопку") as HTMLButtonElement
    await act(async () => { add.click() })
    expect(stored).toHaveLength(6)
    const added = stored[5]
    expect(added.labels).toEqual({ az: "Новая кнопка", ru: "Новая кнопка", en: "Новая кнопка" })
    // Not a second «all clients»: the unfiltered button already exists.
    expect(routeTargetAudience(added)).toBe("others")
    expect(row(added.id).querySelectorAll("input").length).toBeGreaterThan(0)
    expect(preview()).toContain("Новая кнопка")
  })

  it("leaves the always-present button its name only: no switching off, no other audience, no delete", async () => {
    await open()
    await toggle("all-customers")
    expect(storedRow("all-customers").enabled).toBe(true)
    await expand("all-customers")
    expect((row("all-customers").querySelector("select") as HTMLSelectElement).disabled).toBe(true)
    expect(row("all-customers").textContent).toContain("Эта кнопка есть всегда")
    expect([...row("all-customers").querySelectorAll("button")].some((button) => button.textContent === "Удалить кнопку")).toBe(false)
  })

  it("deletes any other button from its open row", async () => {
    await open()
    await expand("clinics")
    const remove = [...row("clinics").querySelectorAll("button")].find((button) => button.textContent === "Удалить кнопку") as HTMLButtonElement
    await act(async () => { remove.click() })
    expect(stored.map((item) => item.id)).toEqual(["all-customers", "doctors", "pharmacies", "organizations"])
    expect(preview()).not.toContain("Клиники")
  })

  it("shows a stored combination it has no word for as it is, and changes it only when a choice is made", async () => {
    const odd = defaults()
    odd[2] = { ...odd[2], direction: "PHARMACY", objectType: "CLINIC" }
    await open(odd)
    expect(rowText("pharmacies")).toContain("Показывает: особая выборка")
    await expand("pharmacies")
    expect(storedRow("pharmacies")).toMatchObject({ direction: "PHARMACY", objectType: "CLINIC" })
    await choose(row("pharmacies").querySelector("select") as HTMLSelectElement, "pharmacies")
    expect(storedRow("pharmacies")).toMatchObject({ direction: "PHARMACY", objectType: "PHARMACY" })
  })
})
