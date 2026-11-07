// @vitest-environment jsdom
/**
 * «Təqvim» and «Üzvlər» on a board (owner, 2026-11-06: Bordio's Calendar and
 * Members tools), rendered with the real Russian copy: a task sits on its due
 * day and opens on click, a busy day opens the rest in place, the undated are
 * counted; the members tab grants and revokes exactly what was ticked and
 * shows who comes with the department.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages
const locale = vi.hoisted(() => ({ current: "ru" }))
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  return {
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: "ru", messages: ru as never, namespace: namespace as never }),
    useLocale: () => locale.current,
  }
})

import { BoardCalendar } from "@/components/boards/board-calendar"
import { BoardMembersPanel } from "@/components/boards/board-members-panel"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const flush = () => act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve() })
const click = (el: Element | null | undefined) => act(async () => { (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })) })
const dayCell = (key: string) => container.querySelector(`[data-day="${key}"]`)

describe("Təqvim", () => {
  it("puts tasks on their due day, opens one on click, unfolds a busy day and counts the undated", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(2026, 10, 6, 12, 0, 0))
    const opened: string[] = []
    const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).toISOString()
    const tasks = [
      { id: "t1", title: "Insert Jurnal", status: "todo", dueDate: at(12) },
      ...["a", "b", "c", "d", "e"].map((x) => ({ id: x, title: `Banner ${x}`, status: "done", dueDate: at(20) })),
      { id: "late", title: "Gecikmiş", status: "in_progress", dueDate: at(3) },
      { id: "none", title: "Tarixsiz", status: "todo", dueDate: null },
    ]
    await act(async () => { root.render(createElement(BoardCalendar, { tasks, onOpenTask: (id: string) => opened.push(id) })) })

    expect(container.textContent).toContain("ноябрь 2026")
    expect(container.textContent).not.toMatch(/M11/)
    expect(dayCell("2026-11-12")?.textContent).toContain("Insert Jurnal")
    await click([...dayCell("2026-11-12")!.querySelectorAll("button")].find((b) => b.textContent === "Insert Jurnal"))
    expect(opened).toEqual(["t1"])

    expect(dayCell("2026-11-20")?.querySelectorAll("button")).toHaveLength(4) // three tasks + «ещё 2»
    const more = [...dayCell("2026-11-20")!.querySelectorAll("button")].at(-1)!
    expect(more.textContent).toBe("ещё 2")
    await click(more)
    expect([...dayCell("2026-11-20")!.querySelectorAll("button")].map((b) => b.textContent)).toContain("Banner e")

    const late = [...dayCell("2026-11-03")!.querySelectorAll("button")][0]
    expect(late.className).toContain("text-red-700")
    expect(container.textContent).toContain("У 1 задачи нет срока")
  })
})

describe("Təqvim in Azerbaijani", () => {
  // Chrome without Azerbaijani ICU data printed «2026 M11» and English weekdays (owner's screen, 2026-11-07).
  it("names the month and weekdays in Azerbaijani whatever the browser's ICU data", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(2026, 10, 6, 12, 0, 0))
    locale.current = "az"
    await act(async () => { root.render(createElement(BoardCalendar, { tasks: [], onOpenTask: () => {} })) })
    expect(container.querySelector("h2")?.textContent).toBe("noyabr 2026")
    expect(container.textContent).toContain("b.e.")
    locale.current = "ru"
  })
})

describe("Üzvlər", () => {
  it("grants and revokes exactly what was ticked, and lists who comes with the department", async () => {
    const calls: string[] = []
    let own = [{ userId: "u-gullu", canView: true, user: { id: "u-gullu", name: "Gullu" } }]
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET"
      calls.push(`${method} ${url}${init?.body ? ` ${init.body}` : ""}`)
      if (url === "/api/v1/users/assignable") {
        return new Response(JSON.stringify({ data: [
          { id: "u-gullu", name: "Gullu", email: "gulu@z.az" },
          { id: "u-aytan", name: "Aytan", email: "aytan@z.az" },
          { id: "u-elvira", name: "Elvira", email: "elvira@z.az" },
        ] }))
      }
      if (url.startsWith("/api/v1/board-permissions?divisionId=dig-zey")) return new Response(JSON.stringify({ data: { permissions: own } }))
      if (url.startsWith("/api/v1/board-permissions?divisionId=dig")) {
        return new Response(JSON.stringify({ data: { permissions: [
          { userId: "u-elvira", canView: true, user: { id: "u-elvira", name: "Elvira" } },
        ] } }))
      }
      if (method === "POST") { own = [...own, { userId: "u-aytan", canView: true, user: { id: "u-aytan", name: "Aytan" } }]; return new Response("{}") }
      if (method === "DELETE") { own = own.filter((row) => row.userId !== "u-gullu"); return new Response("{}") }
      return new Response("{}", { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await act(async () => { root.render(createElement(BoardMembersPanel, { divisionId: "dig-zey", parentDivisionId: "dig", parentName: "Digital Marketing" })) })
    await flush()

    expect(container.textContent).toContain("Из отдела «Digital Marketing»")
    expect(container.querySelector("ul")?.textContent).toBe("Elvira")
    const box = (name: string) => [...container.querySelectorAll("label")].find((l) => l.textContent?.includes(name))!.querySelector("input")!
    expect([box("Gullu").checked, box("Aytan").checked]).toEqual([true, false])

    const save = [...container.querySelectorAll("button")].find((b) => b.textContent === "Сохранить")!
    expect(save.disabled).toBe(true)
    await click(box("Aytan"))
    await click(box("Gullu"))
    await click(save)
    await flush()

    const writes = calls.filter((c) => !c.startsWith("GET"))
    expect(writes).toHaveLength(2)
    expect(writes.find((c) => c.startsWith("POST"))).toContain('"userId":"u-aytan","divisionId":"dig-zey","canView":true')
    expect(writes.find((c) => c.startsWith("DELETE"))).toBe("DELETE /api/v1/board-permissions?userId=u-gullu&divisionId=dig-zey")
    expect(container.textContent).toContain("Сохранено")
    expect([box("Gullu").checked, box("Aytan").checked]).toEqual([false, true])
  })
})
