// @vitest-environment jsdom
/**
 * «Tapşırığı verən» where a task is made (Nazrin, Zeytun, 2026-11-18: «bu
 * hissede reporter olmalidir… her defe meni secmesinler»; owner: «у админа на
 * всех задачах»). The board's «Yeni tapşırıq» window and the «Edit Task» form
 * show the organization's default filled in — also when she is not one of the
 * board's people — and leave it to the server unless the person picks another;
 * an edit keeps the task's own reporter untouched. The admin sets the default
 * on «Komandalar və istifadəçilər». Real components, Azerbaijani copy; only the
 * network and the session are stubbed.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const az = JSON.parse(readFileSync("messages/az.json", "utf8")) as Messages
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  return {
    useTranslations: (namespace?: string) => actual.createTranslator({ locale: "az", messages: az as never, namespace: namespace as never }),
    useLocale: () => "az",
  }
})
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "rashida", name: "Rəşidə", organizationId: "org-1", role: "admin", plan: "enterprise", addons: [], hiddenModules: [], modules: { crm: true, boards: true, settings: true } } }, status: "authenticated" }),
}))
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, ...rest }: { href: string; children: unknown; prefetch?: boolean }) => createElement("a", { href, ...rest }, children as never),
}))
vi.mock("@/components/tasks/use-task-types", () => ({
  useTaskTypes: () => ({ types: [], typeMap: new Map() }),
  useEventTypes: () => ({ types: [], typeMap: new Map() }),
}))

const { CreateTaskDialog } = await import("@/components/boards/create-task-dialog")
const { TaskForm } = await import("@/components/task-form")
const { default: TeamsAndUsersPage } = await import("@/app/(dashboard)/boards/teams/page")

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NAZRIN = { id: "nazrin", name: "Nazrin Şirinova" }
let defaultReporter: { id: string; name: string } | null = NAZRIN
let sent: { method: string; url: string; body: Record<string, unknown> }[] = []
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  sent = []
  defaultReporter = NAZRIN
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (method !== "GET") sent.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : {} })
    const json = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status })
    if (url.startsWith("/api/v1/tasks/default-reporter")) return json({ reporter: method === "PUT" ? NAZRIN : defaultReporter, canManage: true })
    // The board's people: Nazrin is an admin, not a member of this board.
    if (url.startsWith("/api/v1/users/assignable")) return json([{ id: "rashida", name: "Rəşidə Məmmədova" }, { id: "aytan", name: "Aytən Müşkürova" }])
    if (url === "/api/v1/users") return json([
      { id: "rashida", name: "Rəşidə Məmmədova", email: "r@z.az", role: "sales", isActive: true },
      { id: "nazrin", name: "Nazrin Şirinova", email: "n@z.az", role: "admin", isActive: true },
      { id: "sabina", name: "Sabina Həsənova", email: "s@z.az", role: "manager", isActive: true },
    ])
    if (url === "/api/v1/tasks/teams") return json({ teams: [], canManage: true })
    if (url === "/api/v1/tasks" && method === "POST") return json({ id: "new-task" }, 201)
    if (url.startsWith("/api/v1/tasks/") && method === "PATCH") return json({ id: "t-1" })
    return json([])
  }))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
const flush = () => act(async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0)) })
const select = (testId: string) => document.querySelector(`[data-testid="${testId}"]`) as HTMLSelectElement
const shown = (el: HTMLSelectElement) => el.options[el.selectedIndex]?.textContent
const pick = async (el: HTMLSelectElement, value: string) => {
  await act(async () => { el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })) })
  await flush()
}
const type = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("the board's «Yeni tapşırıq» window", () => {
  const open = async () => {
    await act(async () => { root.render(createElement(CreateTaskDialog, { divisionId: "b1", taskTypes: [], onClose: () => {}, onCreated: () => {} })) })
    await flush()
    await type(container.querySelector('[data-testid="board-create-title"]') as HTMLInputElement, "Pharmastore 446 banner")
  }
  const create = async () => {
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Yarat") as HTMLButtonElement
    await act(async () => { button.click() })
    await flush()
    return sent.find((s) => s.url === "/api/v1/tasks" && s.method === "POST")!.body
  }

  it("shows the default reporter under «Tapşırığı verən», though she is not one of the board's people", async () => {
    await open()
    const box = select("board-create-reporter")
    expect(container.textContent).toContain("Tapşırığı verən")
    expect(shown(box)).toBe("Nazrin Şirinova")
    // Untouched, the server puts the default on — the window does not send its own copy.
    expect(await create()).not.toHaveProperty("reporterId")
  })

  it("another person, or nobody, picked here goes to the server", async () => {
    await open()
    await pick(select("board-create-reporter"), "aytan")
    expect((await create()).reporterId).toBe("aytan")
    sent = []
    act(() => root.unmount())
    root = createRoot(container)
    await open()
    await pick(select("board-create-reporter"), "")
    expect((await create()).reporterId).toBeNull()
  })

  it("with no default set the box is empty", async () => {
    defaultReporter = null
    await open()
    expect(select("board-create-reporter").value).toBe("")
  })
})

describe("the «Edit Task» form", () => {
  const render = async (initialData?: Record<string, unknown>) => {
    await act(async () => { root.render(createElement(TaskForm, { open: true, onOpenChange: () => {}, onSaved: () => {}, initialData })) })
    await flush()
  }
  const save = async () => {
    const form = document.querySelector("form") as HTMLFormElement
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
    await flush()
    return sent.find((s) => s.method === "POST" || s.method === "PATCH")!
  }

  it("a new task shows the default reporter and leaves it to the server", async () => {
    await render()
    expect(shown(select("task-form-reporter"))).toBe("Nazrin Şirinova")
    await type(document.querySelector('input[name="title"], input') as HTMLInputElement, "Afişa dekabr")
    const call = await save()
    expect(call.method).toBe("POST")
    expect(call.body).not.toHaveProperty("reporterId")
  })

  it("an edited task shows its own reporter and keeps it unless changed", async () => {
    await render({ id: "t-1", title: "Banner", reporterId: "sabina", status: "pending" })
    expect(shown(select("task-form-reporter"))).toBe("Sabina Həsənova")
    expect((await save()).body).not.toHaveProperty("reporterId")
    sent = []
    await pick(select("task-form-reporter"), "nazrin")
    const call = await save()
    expect(call).toMatchObject({ method: "PATCH", url: "/api/v1/tasks/t-1" })
    expect(call.body.reporterId).toBe("nazrin")
  })
})

describe("«Komandalar və istifadəçilər»", () => {
  it("the admin picks the reporter of every new task", async () => {
    defaultReporter = null
    await act(async () => { root.render(createElement(TeamsAndUsersPage)) })
    await flush()
    const box = container.querySelector("#teams-default-reporter-select") as HTMLSelectElement
    expect(container.textContent).toContain("Bütün yeni tapşırıqlarda tapşırığı verən")
    expect(shown(box)).toBe("Heç kim")
    await pick(box, "nazrin")
    expect(sent).toEqual([{ method: "PUT", url: "/api/v1/tasks/default-reporter", body: { reporterId: "nazrin" } }])
    expect(shown(box)).toBe("Nazrin Şirinova")
  })
})
